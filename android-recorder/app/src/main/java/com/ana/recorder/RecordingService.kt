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
        const val CHANNEL = "ana_recorder_active"
        const val MAX_DURATION_MS = 120 * 60 * 1000L
    }
    private var recorder: MediaRecorder? = null
    private var outputPath: String? = null
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
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioEncodingBitRate(96000)
            next.setAudioSamplingRate(44100)
            next.setOutputFile(file.absolutePath)
            next.prepare()
            next.start()
            recorder = next
            outputPath = file.absolutePath
            handler.postDelayed(stopTask, MAX_DURATION_MS)
            sendStatus(true)
        } catch (e: Exception) {
            try { recorder?.release() } catch (_: Exception) {}
            recorder = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }
    private fun sendStatus(active: Boolean) {
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_ACTIVE, active).putExtra(EXTRA_PATH, outputPath))
    }
    private fun stopRecording() {
        handler.removeCallbacks(stopTask)
        val current = recorder
        recorder = null
        try { current?.stop() } catch (_: Exception) { outputPath?.let { File(it).delete() } }
        try { current?.release() } catch (_: Exception) {}
        sendStatus(false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onDestroy() {
        handler.removeCallbacks(stopTask)
        if (recorder != null) stopRecording()
        super.onDestroy()
    }
}
