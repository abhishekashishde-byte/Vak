package com.ana.recorder

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.core.content.FileProvider
import java.io.File
import java.util.Date

class MainActivity : Activity() {
    private val ink = Color.rgb(24, 28, 42)
    private val muted = Color.rgb(111, 118, 136)
    private val purple = Color.rgb(91, 70, 214)
    private lateinit var status: TextView
    private lateinit var filesList: LinearLayout
    private lateinit var startButton: Button
    private var player: MediaPlayer? = null
    private var playingFile: String? = null
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val active = intent?.getBooleanExtra(RecordingService.EXTRA_ACTIVE, false) == true
            status.text = if (active) "Recording in progress · screen can be locked" else "Ready · recordings saved on this device"
            startButton.isEnabled = !active
            showFiles()
        }
    }
    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
    private fun shape(color: Int, radius: Int = 18) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
    }
    private fun text(value: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color)
        if (bold) setTypeface(null, Typeface.BOLD)
    }
    private fun action(value: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = value; isAllCaps = false; textSize = 15f
        setTextColor(if (primary) Color.WHITE else purple)
        background = shape(if (primary) purple else Color.rgb(240, 237, 255), 14)
        setOnClickListener { onClick() }
    }
    private fun section(title: String) = text(title, 20f, ink, true).apply {
        setPadding(0, dp(25), 0, dp(12))
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(248, 249, 253)
        window.navigationBarColor = Color.rgb(248, 249, 253)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        val scroll = ScrollView(this).apply { fillViewport = true; setBackgroundColor(Color.rgb(248, 249, 253)) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(28), dp(22), dp(32))
        }
        scroll.addView(root)
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.ana_recorder_icon)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(dp(52), dp(52)))
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
            addView(text("ana", 27f, ink, true))
            addView(text("RECORDER", 11f, purple, true))
        })
        root.addView(header)
        root.addView(text("Every meeting, remembered.", 25f, ink, true).apply {
            setPadding(0, dp(26), 0, dp(8))
        })
        root.addView(text("Capture meetings even when your phone is locked. Recordings stay private on your device until you choose to share them.", 15f, muted))
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(18))
            background = shape(Color.WHITE)
            elevation = dp(2).toFloat()
        }
        root.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(24) })
        panel.addView(text("MEETING RECORDER", 12f, purple, true))
        status = text("Ready to record", 17f, ink, true).apply { setPadding(0, dp(14), 0, dp(16)) }
        panel.addView(status)
        startButton = action("●  Start recording", true) { startWithPermission() }
        panel.addView(startButton, LinearLayout.LayoutParams(-1, dp(52)))
        panel.addView(action("■  Stop & save") {
            startService(Intent(this, RecordingService::class.java).setAction(RecordingService.ACTION_STOP))
        }, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) })
        panel.addView(text("Maximum 2 hours · AAC audio · Works with screen locked", 12f, muted).apply {
            setPadding(0, dp(15), 0, 0)
        })
        root.addView(section("My meetings"))
        filesList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(filesList)
        root.addView(section("Continue in Ana"))
        val syncPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = shape(Color.WHITE)
        }
        root.addView(syncPanel)
        syncPanel.addView(text("Ana account & workboard", 17f, ink, true))
        syncPanel.addView(text("Open Ana to sign in and access your existing meeting workspace. Automatic recorder sync is not connected yet.", 13f, muted).apply {
            setPadding(0, dp(8), 0, dp(12))
        })
        syncPanel.addView(action("Open Ana →", true) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://ana-translate.vercel.app/")))
        }, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(text("Transcription, MoM and Ask Ana require an explicit upload in Ana. Nothing is uploaded or processed automatically.", 12f, muted).apply {
            setPadding(0, dp(20), 0, 0)
        })
        setContentView(scroll)
        showFiles()
    }
    private fun startWithPermission() {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 8)
        else {
            startForegroundService(Intent(this, RecordingService::class.java).setAction(RecordingService.ACTION_START))
            status.text = "Starting recording…"
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 8 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startWithPermission()
        else Toast.makeText(this, "Microphone permission is required", Toast.LENGTH_LONG).show()
    }
    private fun showFiles() {
        filesList.removeAllViews()
        val files = File(getExternalFilesDir(null), "Meetings").listFiles()
            ?.filter { it.extension.equals("m4a", true) }
            ?.sortedByDescending { it.lastModified() }.orEmpty()
        if (files.isEmpty()) {
            filesList.addView(text("No recordings yet. Your saved meetings will appear here.", 14f, muted).apply {
                setPadding(dp(4), dp(12), 0, dp(12))
            })
        }
        files.forEach { file ->
            val panel = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(14), dp(14), dp(12))
                background = shape(Color.WHITE, 14)
            }
            filesList.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            panel.addView(text(DateFormat.format("EEE, dd MMM yyyy · HH:mm", Date(file.lastModified())).toString(), 15f, ink, true))
            panel.addView(text("${file.name} · ${file.length() / 1024} KB", 12f, muted))
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            panel.addView(actions)
            actions.addView(action(if (playingFile == file.absolutePath) "Stop playback" else "▶ Play") {
                if (playingFile == file.absolutePath) {
                    player?.release(); player = null; playingFile = null; showFiles()
                } else {
                    try {
                        player?.release()
                        player = MediaPlayer().apply {
                            setDataSource(file.absolutePath); prepare()
                            setOnCompletionListener { player?.release(); player = null; playingFile = null; showFiles() }
                            start()
                        }
                        playingFile = file.absolutePath; showFiles()
                    } catch (e: Exception) {
                        Toast.makeText(this, "Cannot play this recording", Toast.LENGTH_LONG).show()
                    }
                }
            }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { topMargin = dp(12) })
            actions.addView(action("↗ Share") {
                val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "audio/mp4"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, "Share with Ana or another app"))
            }, LinearLayout.LayoutParams(0, dp(44), 1f).apply {
                topMargin = dp(12); marginStart = dp(8)
            })
        }
    }
    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(RecordingService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(receiver, filter)
        showFiles()
    }
    override fun onStop() { unregisterReceiver(receiver); super.onStop() }
    override fun onDestroy() { player?.release(); player = null; super.onDestroy() }
}
