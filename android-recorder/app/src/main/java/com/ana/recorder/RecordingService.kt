package com.ana.recorder

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.*
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class RecordingService : Service() {
    companion object {
        const val ACTION_START = "com.ana.recorder.START"
        const val ACTION_STOP = "com.ana.recorder.STOP"
        const val ACTION_STATUS = "com.ana.recorder.STATUS"
        const val EXTRA_ACTIVE = "active"
        const val EXTRA_PATH = "path"
        const val EXTRA_ERROR = "error"
        const val PREFS = "recording_state"
        const val CHANNEL = "ana_recorder_active"
        const val MAX_DURATION_MS = 120 * 60 * 1000L
    }
    private var recorder: MediaRecorder? = null
    private var outputPath: String? = null
    private var startingRecorder: MediaRecorder? = null
    private val handler = Handler(Looper.getMainLooper())
    private val stopTask = Runnable { stopRecording() }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopRecording()
            ACTION_START -> if (recorder == null) startRecording()
        }
        return START_NOT_STICKY
    }
    private fun startRecording() {
        val channel = NotificationChannel(CHANNEL, "Meeting recording", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        val stopIntent = Intent(this, RecordingService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(this, 2, stopIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val openPending = PendingIntent.getActivity(this, 3, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Ana is recording")
            .setContentText("Saved locally · Auto-stops after 2 hours")
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(Notification.Action.Builder(null, "Stop", stopPending).build())
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(11, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(11, notification)
            val directory = File(getExternalFilesDir(null), "Meetings").apply { mkdirs() }
            val name = "Ana_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".m4a"
            val file = File(directory, name)
            @Suppress("DEPRECATION")
            val next = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else MediaRecorder()
            startingRecorder = next
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioEncodingBitRate(96000)
            next.setAudioSamplingRate(44100)
            next.setOutputFile(file.absolutePath)
            next.prepare()
            next.start()
            recorder = next
            startingRecorder = null
            outputPath = file.absolutePath
            handler.postDelayed(stopTask, MAX_DURATION_MS)
            sendStatus(true)
        } catch (e: Exception) {
            try { startingRecorder?.release() } catch (_: Exception) {}
            try { recorder?.release() } catch (_: Exception) {}
            startingRecorder = null
            recorder = null
            outputPath = null
            sendStatus(false, "Recording failed: ${e.localizedMessage ?: e.javaClass.simpleName}")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }
    private fun sendStatus(active: Boolean, error: String = "") {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(EXTRA_ACTIVE, active)
            .putString(EXTRA_ERROR, error).apply()
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_ACTIVE, active)
            .putExtra(EXTRA_PATH, outputPath).putExtra(EXTRA_ERROR, error))
    }
    private fun stopRecording() {
        handler.removeCallbacks(stopTask)
        val current = recorder
        recorder = null
        var error = ""
        try { current?.stop() } catch (e: Exception) {
            outputPath?.let { File(it).delete() }
            error = "Could not save recording: ${e.localizedMessage ?: "recording too short"}"
        }
        try { current?.release() } catch (_: Exception) {}
        outputPath = null
        sendStatus(false, error)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onDestroy() {
        handler.removeCallbacks(stopTask)
        if (recorder != null) stopRecording()
        super.onDestroy()
    }
}
