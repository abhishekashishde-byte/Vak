package com.ana.keyboard

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object AnaUpdateChecker {
    data class UpdateInfo(
        val versionCode: Int,
        val versionName: String,
        val downloadUrl: String,
        val notes: String,
        val updateAvailable: Boolean
    )

    fun check(context: Context): UpdateInfo {
        val endpoint = KeyboardPrefs.baseUrl(context).trimEnd('/') + "/ana-keyboard-version.json"
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.setRequestProperty("Accept", "application/json")
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("Update service returned " + connection.responseCode)
            }
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val code = json.optInt("versionCode", 0)
            return UpdateInfo(
                versionCode = code,
                versionName = json.optString("versionName", ""),
                downloadUrl = json.optString("downloadUrl", KeyboardPrefs.baseUrl(context)),
                notes = json.optString("notes", ""),
                updateAvailable = code > BuildConfig.VERSION_CODE
            )
        } finally {
            connection.disconnect()
        }
    }
}
