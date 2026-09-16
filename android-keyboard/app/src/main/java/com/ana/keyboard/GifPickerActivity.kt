package com.ana.keyboard

import android.app.Activity
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors

class GifPickerActivity : Activity() {
    private data class GifItem(val previewUrl: String, val shareUrl: String, val title: String)

    private val io = Executors.newFixedThreadPool(4)
    private lateinit var results: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var search: EditText
    private var requestId = 0

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(22, 22, 24)
        window.navigationBarColor = Color.rgb(18, 18, 20)
        setContentView(buildUi())
        loadGifs("")
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(24, 24, 26))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        root.addView(TextView(this).apply {
            text = "GIFs"
            textSize = 23f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        val searchRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        search = EditText(this).apply {
            hint = "Search KLIPY"
            setHintTextColor(Color.rgb(155, 155, 160))
            setTextColor(Color.WHITE)
            setSingleLine(true)
            textSize = 16f
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setBackgroundColor(Color.rgb(48, 48, 52))
            setPadding(dp(14), 0, dp(14), 0)
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEARCH) { runSearch(); true } else false
            }
        }
        searchRow.addView(search, LinearLayout.LayoutParams(0, dp(48), 1f))
        searchRow.addView(Button(this).apply {
            text = "Search"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(58, 58, 62))
            setOnClickListener { runSearch() }
        }, LinearLayout.LayoutParams(dp(92), dp(48)).apply { marginStart = dp(8) })
        root.addView(searchRow)

        val stateRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        status = TextView(this).apply {
            text = "Trending GIFs"
            textSize = 13f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
        }
        progress = ProgressBar(this).apply { visibility = View.GONE }
        stateRow.addView(status, LinearLayout.LayoutParams(0, dp(42), 1f))
        stateRow.addView(progress, LinearLayout.LayoutParams(dp(30), dp(30)))
        root.addView(stateRow)

        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(2), 0, dp(6)) }
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(results, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val footer = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        footer.addView(Button(this).apply {
            text = "From phone"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(48, 48, 52))
            setOnClickListener { openPhoneGif() }
        }, LinearLayout.LayoutParams(dp(118), dp(44)))
        footer.addView(TextView(this).apply {
            text = "Powered by KLIPY"
            textSize = 12f
            setTextColor(Color.rgb(190, 190, 195))
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        root.addView(footer)
        return root
    }

    private fun runSearch() = loadGifs(search.text.toString().trim())

    private fun loadGifs(query: String) {
        val thisRequest = ++requestId
        progress.visibility = View.VISIBLE
        status.text = "Loading…"
        results.removeAllViews()
        io.execute {
            try {
                val items = fetchWithFallbacks(query)
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    status.text = if (items.isEmpty()) "No GIFs found" else if (query.isBlank()) "Trending GIFs" else "Results for “$query”"
                    render(items)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    val detail = error.message?.take(90).orEmpty()
                    status.text = if (detail.isBlank()) "GIF search unavailable — choose one from your phone" else "GIF search unavailable: $detail"
                }
            }
        }
    }

    private fun fetchWithFallbacks(query: String): List<GifItem> {
        val errors = mutableListOf<String>()
        val encoded = URLEncoder.encode(query, "UTF-8")
        val base = KeyboardPrefs.baseUrl(this).trimEnd('/')
        if (base.startsWith("https://")) {
            val proxy = "$base/api/gifs?limit=18" + if (query.isBlank()) "" else "&q=$encoded"
            try { return fetchNormalized(proxy).takeIf { it.isNotEmpty() } ?: emptyList() }
            catch (e: Exception) { errors += "Ana proxy ${e.message.orEmpty()}" }
        }

        val v2 = if (query.isBlank()) {
            "https://api.klipy.com/v2/featured?key=$KLIPY_FALLBACK_KEY&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=18"
        } else {
            "https://api.klipy.com/v2/search?key=$KLIPY_FALLBACK_KEY&q=$encoded&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=18"
        }
        try { return fetchKlipyV2(v2) } catch (e: Exception) { errors += "KLIPY v2 ${e.message.orEmpty()}" }

        val action = if (query.isBlank()) "trending" else "search"
        val v1 = "https://api.klipy.com/api/v1/$KLIPY_FALLBACK_KEY/gifs/$action?page=1&per_page=18&customer_id=ana-keyboard&locale=en_US" +
            if (query.isBlank()) "" else "&q=$encoded"
        try { return fetchKlipyV1(v1) } catch (e: Exception) { errors += "KLIPY v1 ${e.message.orEmpty()}" }
        throw IllegalStateException(errors.lastOrNull()?.take(110) ?: "provider unavailable")
    }

    private fun openJson(endpoint: String): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = 7_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("User-Agent", "AnaKeyboard/0.9")
            val code = connection.responseCode
            if (code !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                throw IllegalStateException("HTTP $code ${errorBody.take(70)}")
            }
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun fetchNormalized(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        val array = root.optJSONArray("results") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val preview = item.optString("preview").takeIf { it.startsWith("https://") } ?: continue
                val share = item.optString("share").takeIf { it.startsWith("https://") } ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun fetchKlipyV2(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        root.optJSONObject("errors")?.let { throw IllegalStateException(it.toString().take(90)) }
        val array = root.optJSONArray("results") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val formats = item.optJSONObject("media_formats") ?: continue
                fun media(name: String): String? = formats.optJSONObject(name)?.optString("url")?.takeIf { it.startsWith("https://") }
                val preview = media("tinygif") ?: media("mediumgif") ?: media("gif") ?: continue
                val share = media("gif") ?: media("mediumgif") ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun fetchKlipyV1(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        val array = root.optJSONObject("data")?.optJSONArray("data") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                if (item.optString("type") == "ad") continue
                val file = item.optJSONObject("file") ?: continue
                fun media(size: String): String? = file.optJSONObject(size)?.optJSONObject("gif")?.optString("url")?.takeIf { it.startsWith("https://") }
                val preview = media("xs") ?: media("sm") ?: media("md") ?: media("hd") ?: continue
                val share = media("md") ?: media("sm") ?: media("hd") ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun render(items: List<GifItem>) {
        results.removeAllViews()
        items.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            pair.forEach { item ->
                row.addView(gifTile(item), LinearLayout.LayoutParams(0, dp(132), 1f).apply { setMargins(dp(3), dp(3), dp(3), dp(3)) })
            }
            if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, dp(132), 1f))
            results.addView(row)
        }
    }

    private fun gifTile(item: GifItem): ImageView = ImageView(this).apply {
        setBackgroundColor(Color.rgb(42, 42, 45))
        scaleType = ImageView.ScaleType.CENTER_CROP
        contentDescription = item.title
        setOnClickListener { chooseOnlineGif(item.shareUrl) }
        loadPreview(this, item.previewUrl)
    }

    private fun loadPreview(view: ImageView, url: String) {
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 7_000
                connection.readTimeout = 10_000
                connection.setRequestProperty("User-Agent", "AnaKeyboard/0.9")
                connection.inputStream.use { input ->
                    val bytes = input.readBytes()
                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@use
                    runOnUiThread { if (!isFinishing) view.setImageBitmap(bitmap) }
                }
            } catch (_: Exception) {
            } finally { connection?.disconnect() }
        }
    }

    private fun chooseOnlineGif(remoteUrl: String) {
        val token = UUID.randomUUID().toString().replace("-", "")
        GifSourceStore.put(this, token, remoteUrl)
        val contentUri = Uri.Builder().scheme("content").authority(GIF_AUTHORITY).appendPath(token).build()
        KeyboardPrefs.setPendingGifUri(this, contentUri.toString())
        finish()
    }

    private fun openPhoneGif() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/gif"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(intent, REQUEST_GIF)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_GIF && resultCode == RESULT_OK) {
            val uri = data?.data
            if (uri != null) {
                try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { }
                KeyboardPrefs.setPendingGifUri(this, uri.toString())
            }
            finish()
        }
    }

    override fun onDestroy() { io.shutdownNow(); super.onDestroy() }

    companion object {
        private const val REQUEST_GIF = 71
        private const val GIF_AUTHORITY = "com.ana.keyboard.gifs"
        // Public development fallback only. Production should use KLIPY_API_KEY on the Ana server.
        private const val KLIPY_FALLBACK_KEY = "sandbox-mJokm7E2jH"
    }
}
