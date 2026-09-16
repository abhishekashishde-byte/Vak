package com.ana.keyboard

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle

class MicrophonePermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            finish()
            return
        }
        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_MIC) finish()
    }

    companion object {
        private const val REQUEST_MIC = 71
    }
}
