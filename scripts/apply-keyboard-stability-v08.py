from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Anchor not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# 1) Preferences: sentence correction ON by default; pause glide completely.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/KeyboardPrefs.kt')
text = p.read_text()
text = text.replace(
    'fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, false)',
    'fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, true)',
    1,
)
text = text.replace(
    'fun glideTypingEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_GLIDE_TYPING, true)',
    'fun glideTypingEnabled(context: Context): Boolean = false // Temporarily paused: typing stability takes priority.',
    1,
)
text = text.replace(
    'fun glideTrailEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_GLIDE_TRAIL, true)',
    'fun glideTrailEnabled(context: Context): Boolean = false // Glide is temporarily paused.',
    1,
)
p.write_text(text)


# 2) Settings: remove inactive swipe toggles and make the sentence behavior explicit.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/MainActivity.kt')
text = p.read_text()
text = text.replace(
    'root.addView(menuRow("Typing", "Auto-correction, suggestions and glide typing") { renderTyping() })',
    'root.addView(menuRow("Typing", "Auto-correction, smart sentence correction and suggestions") { renderTyping() })',
    1,
)
text = text.replace(
    'root.addView(switchRow("Smart sentence correction", "After a short pause, Ana can correct grammar and contextual typing mistakes across the whole sentence. This sends that sentence to your Ana server; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {\n            KeyboardPrefs.setSmartSentenceCorrectionEnabled(this, it)\n        })',
    'root.addView(switchRow("Smart sentence correction", "Automatically check the current sentence after you pause. Fixes grammar, completeness and contextual typing mistakes. The sentence is sent to your Ana server; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {\n            KeyboardPrefs.setSmartSentenceCorrectionEnabled(this, it)\n        })',
    1,
)
old_glide = '''        root.addView(section("Glide typing"))
        root.addView(switchRow("Glide typing", "Create words by intentionally swiping over letters", KeyboardPrefs.glideTypingEnabled(this)) {
            KeyboardPrefs.setGlideTypingEnabled(this, it)
        })
        root.addView(switchRow("Glide trail", "Show the line following your finger", KeyboardPrefs.glideTrailEnabled(this)) {
            KeyboardPrefs.setGlideTrailEnabled(this, it)
        })
        root.addView(infoCard("Fast typing protection", "Ana requires a deliberate glide before switching from tapping to swipe mode."))
'''
new_glide = '''        root.addView(section("Swipe typing"))
        root.addView(infoCard("Paused for stability", "Swipe typing is temporarily disabled. Ana now treats finger movement during fast typing as normal typing only while we prioritise zero-lag typing."))
'''
if old_glide not in text:
    raise SystemExit('MainActivity glide section anchor missing')
text = text.replace(old_glide, new_glide, 1)
p.write_text(text)


# 3) Keyboard service: sentence checking only schedules at word/sentence boundaries,
# never per letter, and reports failures instead of silently doing nothing.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt')
text = p.read_text()
text = text.replace(
    '''    override fun onKey(code: String) {
        if (pendingGlide != null) flushPendingGlideFast()
        if (code != "BACKSPACE" && code != "SPACE") lastAutoCorrection = null
''',
    '''    override fun onKey(code: String) {
        if (pendingGlide != null) flushPendingGlideFast()
        // Any new key cancels an older sentence check/result. Space or punctuation
        // will schedule a fresh check after the key is committed.
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        if (code != "BACKSPACE" && code != "SPACE") lastAutoCorrection = null
''',
    1,
)
text = text.replace(
    '''            "BACKSPACE" -> {
                smartSentenceToken++
                mainHandler.removeCallbacks(smartSentenceRunnable)
                if (undoLastSentenceCorrection()) return
''',
    '''            "BACKSPACE" -> {
                if (undoLastSentenceCorrection()) return
''',
    1,
)
text = text.replace(
    '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                    scheduleSmartSentenceCorrection()
                } else {
''',
    '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                } else {
''',
    1,
)
text = text.replace(
    'mainHandler.postDelayed(smartSentenceRunnable, 1200)',
    'mainHandler.postDelayed(smartSentenceRunnable, 650)',
    1,
)
text = text.replace(
    '''        val languageHint = KeyboardPrefs.inputLanguage(this)

        smartSentenceExecutor.execute {
''',
    '''        val languageHint = KeyboardPrefs.inputLanguage(this)
        showStatus("Checking sentence…")

        smartSentenceExecutor.execute {
''',
    1,
)
text = text.replace(
    '''            } catch (_: Exception) {
                // Optional cloud correction must never interrupt typing.
            }
''',
    '''            } catch (_: Exception) {
                // Network/API failure must never interrupt typing, but it should
                // not fail invisibly either.
                mainHandler.post {
                    if (token == smartSentenceToken && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        showStatus("Sentence check unavailable")
                    }
                }
            }
''',
    1,
)
p.write_text(text)


# 4) API: make keyboard sentence correction a low-latency path.
p = Path('api/translate.js')
text = p.read_text()
text = text.replace(
    "  const isLanguageDetection = rawInstructions.includes(\"Ana's language detector\")\n",
    "  const isLanguageDetection = rawInstructions.includes(\"Ana's language detector\")\n  const isKeyboardSentenceCorrection = rawInstructions.includes('Smart Sentence Correction')\n",
    1,
)
text = text.replace(
    "  const domainResolution = isLanguageDetection\n    ? resolveDomain('', { mode: 'general' })\n    : resolveDomain(text, req.body?.domain)\n  const domainInstructions = isLanguageDetection ? '' : domainPrompt(domainResolution)\n",
    "  const domainResolution = (isLanguageDetection || isKeyboardSentenceCorrection)\n    ? resolveDomain('', { mode: 'general' })\n    : resolveDomain(text, req.body?.domain)\n  const domainInstructions = (isLanguageDetection || isKeyboardSentenceCorrection) ? '' : domainPrompt(domainResolution)\n",
    1,
)
text = text.replace(
    "  const reasoningEffort = isAnaTranslation ? 'none' : (isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief || isMeetingIntelligence ? 'low' : 'medium')\n",
    "  const reasoningEffort = (isAnaTranslation || isKeyboardSentenceCorrection) ? 'none' : (isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief || isMeetingIntelligence ? 'low' : 'medium')\n",
    1,
)
text = text.replace(
    "  const deadlineMs = isWordRefinement ? 6000 : isLanguageDetection ? 4500 : isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : isAnaTranslation ? 22000 : isMeetingIntelligence ? 18000 : isVisualOrDocumentTranslation ? 24000 : 20000\n",
    "  const deadlineMs = isKeyboardSentenceCorrection ? 6500 : isWordRefinement ? 6000 : isLanguageDetection ? 4500 : isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : isAnaTranslation ? 22000 : isMeetingIntelligence ? 18000 : isVisualOrDocumentTranslation ? 24000 : 20000\n",
    1,
)
text = text.replace(
    "    if (isMeetingOutput) body.max_output_tokens = 1800\n",
    "    if (isMeetingOutput) body.max_output_tokens = 1800\n    if (isKeyboardSentenceCorrection) body.max_output_tokens = 420\n",
    1,
)
p.write_text(text)


# 5) GIF picker: move to KLIPY v2 endpoints/current response format while keeping
# a parser fallback for v1 responses.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/GifPickerActivity.kt')
text = p.read_text()
text = text.replace(
    '"https://api.klipy.com/api/v1/$KLIPY_TEST_KEY/gifs/search?q=${URLEncoder.encode(query, "UTF-8")}&page=1&per_page=16",',
    '"https://api.klipy.com/v2/search?key=$KLIPY_TEST_KEY&q=${URLEncoder.encode(query, "UTF-8")}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=16",',
    1,
)
text = text.replace(
    '"https://api.klipy.com/api/v1/$KLIPY_TEST_KEY/gifs/trending?page=1&per_page=16",',
    '"https://api.klipy.com/v2/featured?key=$KLIPY_TEST_KEY&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=16",',
    1,
)
start = text.index('    private fun fetchItems(endpoint: String): List<GifItem> {')
end = text.index('    private fun render(items: List<GifItem>) {', start)
new_fetch = r'''    private fun fetchItems(endpoint: String): List<GifItem> {
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

'''
text = text[:start] + new_fetch + text[end:]
p.write_text(text)


# 6) Version bump.
p = Path('android-keyboard/app/build.gradle.kts')
text = p.read_text()
text = text.replace('versionCode = 7', 'versionCode = 8', 1)
text = text.replace('versionName = "0.7.0"', 'versionName = "0.8.0"', 1)
p.write_text(text)
