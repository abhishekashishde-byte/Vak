package com.ana.recorder

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.*
import java.io.File

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var recordings: LinearLayout
    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            status.text = if (intent?.getBooleanExtra(RecordingService.EXTRA_ACTIVE, false) == true)
                "Recording in background · maximum 2 hours" else "Recording stopped · saved locally"
            showFiles()
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 56, 36, 24)
        }
        root.addView(TextView(this).apply { text = "Ana Recorder"; textSize = 27f })
        root.addView(TextView(this).apply {
            text = "Records locally, including with the screen locked. No audio is uploaded or sent to AI automatically."
            textSize = 15f
        })
        status = TextView(this).apply { text = "Ready to record"; textSize = 18f; setPadding(0, 30, 0, 20) }
        root.addView(status)
        root.addView(Button(this).apply {
            text = "Start recording"
            setOnClickListener { startWithPermission() }
        })
        root.addView(Button(this).apply {
            text = "Stop and save"
            setOnClickListener { startService(Intent(this@MainActivity, RecordingService::class.java).setAction(RecordingService.ACTION_STOP)) }
        })
        root.addView(TextView(this).apply {
            text = "Auto-stop: 2 hours. The persistent Android notification has a Stop button. Keep the phone charged."
        })
        root.addView(TextView(this).apply { text = "Saved recordings"; textSize = 21f; setPadding(0, 28, 0, 8) })
        recordings = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(recordings) })
        setContentView(root)
        showFiles()
    }
    private fun startWithPermission() {
        val needed = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), 8)
        } else {
            startForegroundService(Intent(this, RecordingService::class.java).setAction(RecordingService.ACTION_START))
            status.text = "Starting recording..."
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 8 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startWithPermission()
        else Toast.makeText(this, "Microphone permission is required", Toast.LENGTH_LONG).show()
    }
    private fun showFiles() {
        recordings.removeAllViews()
        val files = File(getExternalFilesDir(null), "Meetings").listFiles()?.filter { it.extension == "m4a" }?.sortedByDescending { it.lastModified() }.orEmpty()
        if (files.isEmpty()) recordings.addView(TextView(this).apply { text = "No recordings yet" })
        files.forEach { file ->
            recordings.addView(Button(this).apply {
                text = file.name + " · " + (file.length() / 1024) + " KB · Share"
                setOnClickListener {
                    val uri = androidx.core.content.FileProvider.getUriForFile(this@MainActivity, packageName + ".files", file)
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "audio/mp4"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, "Share recording"))
                }
            })
        }
    }
    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(RecordingService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(statusReceiver, filter)
        showFiles()
    }
    override fun onStop() { unregisterReceiver(statusReceiver); super.onStop() }
}
