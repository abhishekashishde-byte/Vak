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

/**
 * Lightweight GIF search for Ana Keyboard. KLIPY's public sandbox key is used
 * only for development/testing; replace it with Ana's production key before a
 * public store release.
 */
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
        loadTrending()
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

        val searchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
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
                if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                    runSearch()
                    true
                } else false
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

        val stateRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        status = TextView(this).apply {
            text = "Trending GIFs"
            textSize = 13f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
        }
        progress = ProgressBar(this).apply { visibility = View.GONE }
        stateRow.addView(status, LinearLayout.LayoutParams(0, dp(38), 1f))
        stateRow.addView(progress, LinearLayout.LayoutParams(dp(30), dp(30)))
        root.addView(stateRow)

        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(2), 0, dp(6))
        }
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(results, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
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

    private fun runSearch() {
        val query = search.text.toString().trim()
        if (query.isBlank()) loadTrending() else loadUrl(
            "https://api.klipy.com/v2/search?key=$KLIPY_TEST_KEY&q=${URLEncoder.encode(query, "UTF-8")}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=16",
            "Results for “$query”"
        )
    }

    private fun loadTrending() {
        loadUrl(
            "https://api.klipy.com/v2/featured?key=$KLIPY_TEST_KEY&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=16",
            "Trending GIFs"
        )
    }

    private fun loadUrl(endpoint: String, label: String) {
        val thisRequest = ++requestId
        progress.visibility = View.VISIBLE
        status.text = "Loading…"
        results.removeAllViews()

        io.execute {
            try {
                val items = fetchItems(endpoint)
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    status.text = if (items.isEmpty()) "No GIFs found" else label
                    render(items)
                }
            } catch (_: Exception) {
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    status.text = "GIF search unavailable — you can still choose one from your phone"
                }
            }
        }
    }

    private fun fetchItems(endpoint: String): List<GifItem> {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 12_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "AnaKeyboard/0.8")
            if (connection.responseCode !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                error("KLIPY ${connection.responseCode}: ${errorBody.take(160)}")
            }
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val root = JSONObject(body)

            // Current KLIPY v2 format.
            root.optJSONArray("results")?.let { array ->
                return buildList {
                    for (i in 0 until array.length()) {
                        val item = array.optJSONObject(i) ?: continue
                        val formats = item.optJSONObject("media_formats") ?: continue
                        fun media(name: String): String? = formats.optJSONObject(name)
                            ?.optString("url")
                            ?.takeIf { it.startsWith("https://") }

                        val preview = media("tinygif") ?: media("mediumgif") ?: media("gif") ?: continue
                        val share = media("gif") ?: media("mediumgif") ?: preview
                        add(GifItem(preview, share, item.optString("title", "GIF")))
                    }
                }.take(16)
            }

            // Backward-compatible v1 format.
            val array = root.optJSONObject("data")?.optJSONArray("data") ?: return emptyList()
            buildList {
                for (i in 0 until array.length()) {
                    val item = array.optJSONObject(i) ?: continue
                    if (item.optString("type") == "ad") continue
                    val file = item.optJSONObject("file") ?: continue
                    fun url(size: String): String? = file.optJSONObject(size)
                        ?.optJSONObject("gif")
                        ?.optString("url")
                        ?.takeIf { it.startsWith("https://") }
                    val preview = url("xs") ?: url("sm") ?: url("md") ?: url("hd") ?: continue
                    val share = url("md") ?: url("sm") ?: url("hd") ?: preview
                    add(GifItem(preview, share, item.optString("title", "GIF")))
                }
            }.take(16)
        } finally {
            connection.disconnect()
        }
    }

    private fun render(items: List<GifItem>) {
        results.removeAllViews()
        items.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            pair.forEach { item ->
                row.addView(gifTile(item), LinearLayout.LayoutParams(0, dp(132), 1f).apply {
                    setMargins(dp(3), dp(3), dp(3), dp(3))
                })
            }
            if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, dp(132), 1f))
            results.addView(row)
        }
    }

    private fun gifTile(item: GifItem): ImageView = ImageView(this).apply {
        setBackgroundColor(Color.rgb(42, 42, 45))
        scaleType = ImageView.ScaleType.CENTER_CROP
        contentDescription = item.title
        setPadding(0, 0, 0, 0)
        setOnClickListener { chooseOnlineGif(item.shareUrl) }
        loadPreview(this, item.previewUrl)
    }

    private fun loadPreview(view: ImageView, url: String) {
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 8_000
                connection.readTimeout = 12_000
                connection.inputStream.use { input ->
                    val bytes = input.readBytes()
                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@use
                    runOnUiThread {
                        if (!isFinishing) view.setImageBitmap(bitmap)
                    }
                }
            } catch (_: Exception) {
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun chooseOnlineGif(remoteUrl: String) {
        val token = UUID.randomUUID().toString().replace("-", "")
        GifSourceStore.put(this, token, remoteUrl)
        val contentUri = Uri.Builder()
            .scheme("content")
            .authority(GIF_AUTHORITY)
            .appendPath(token)
            .build()
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
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: Exception) {
                }
                KeyboardPrefs.setPendingGifUri(this, uri.toString())
            }
            finish()
        }
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_GIF = 71
        private const val GIF_AUTHORITY = "com.ana.keyboard.gifs"
        private const val KLIPY_TEST_KEY = "sandbox-mJokm7E2jH"
    }
}
