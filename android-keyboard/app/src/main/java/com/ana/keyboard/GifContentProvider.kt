package com.ana.keyboard

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Stores short-lived KLIPY media URLs behind random local tokens so a target app
 * never receives Ana's provider/API configuration. The provider streams the
 * original HTTPS media URL directly into Android's rich-content pipe.
 */
object GifSourceStore {
    private const val STORE = "ana_gif_sources"
    private const val MAX_AGE_MS = 30 * 60 * 1000L

    fun put(context: Context, token: String, url: String) {
        cleanup(context)
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .edit()
            .putString("url_$token", url)
            .putLong("time_$token", System.currentTimeMillis())
            .apply()
    }

    fun get(context: Context, token: String): String? {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val created = prefs.getLong("time_$token", 0L)
        if (created <= 0L || System.currentTimeMillis() - created > MAX_AGE_MS) {
            prefs.edit().remove("url_$token").remove("time_$token").apply()
            return null
        }
        return prefs.getString("url_$token", null)
    }

    private fun cleanup(context: Context) {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val editor = prefs.edit()
        prefs.all.keys.filter { it.startsWith("time_") }.forEach { key ->
            val token = key.removePrefix("time_")
            val created = prefs.getLong(key, 0L)
            if (created <= 0L || now - created > MAX_AGE_MS) {
                editor.remove(key).remove("url_$token")
            }
        }
        editor.apply()
    }
}

class GifContentProvider : ContentProvider() {
    private val io = Executors.newCachedThreadPool()

    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String = "image/gif"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        if (!mode.startsWith("r")) throw SecurityException("GIF content is read-only")
        val ctx = context ?: return null
        val token = uri.pathSegments.firstOrNull()?.takeIf { it.matches(Regex("[A-Za-z0-9]{12,80}")) }
            ?: return null
        val remote = GifSourceStore.get(ctx, token) ?: return null
        val parsed = Uri.parse(remote)
        if (parsed.scheme != "https") return null

        val pipe = ParcelFileDescriptor.createPipe()
        val readSide = pipe[0]
        val writeSide = pipe[1]
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(remote).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = true
                connection.connectTimeout = 10_000
                connection.readTimeout = 25_000
                connection.setRequestProperty("Accept", "image/gif,image/*;q=0.8")
                connection.inputStream.use { input ->
                    FileOutputStream(writeSide.fileDescriptor).use { output ->
                        input.copyTo(output, 32 * 1024)
                    }
                }
            } catch (_: Exception) {
                try { writeSide.close() } catch (_: Exception) { }
            } finally {
                try { writeSide.close() } catch (_: Exception) { }
                connection?.disconnect()
            }
        }
        return readSide
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun shutdown() {
        io.shutdownNow()
        super.shutdown()
    }
}
