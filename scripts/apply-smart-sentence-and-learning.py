from pathlib import Path

# Keyboard preference: sentence-level cloud correction is opt-in because normal typing stays local.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/KeyboardPrefs.kt')
text = p.read_text()
text = text.replace(
    '    private const val KEY_AUTO_CORRECTION = "auto_correction"\n',
    '    private const val KEY_AUTO_CORRECTION = "auto_correction"\n    private const val KEY_SMART_SENTENCE_CORRECTION = "smart_sentence_correction"\n',
    1,
)
text = text.replace(
    '    fun setAutoCorrectionEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_CORRECTION, enabled).apply()\n\n',
    '    fun setAutoCorrectionEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_CORRECTION, enabled).apply()\n\n    fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, false)\n    fun setSmartSentenceCorrectionEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_SMART_SENTENCE_CORRECTION, enabled).apply()\n\n',
    1,
)
p.write_text(text)

# Ana API: focused same-language sentence correction; explicit Correct still targets Translate-to language.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/AnaApi.kt')
text = p.read_text()
anchor = '\n    fun transform(baseUrl: String, text: String, action: Action, target: String): String {'
if anchor not in text:
    raise SystemExit('AnaApi transform anchor missing')
helper = '''
    fun correctSentence(baseUrl: String, text: String, languageHint: String): String {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no sentence to correct." }

        val instructions = "You are Ana Keyboard's Smart Sentence Correction. The user is typing in $languageHint. Keep the SAME language; do not translate. Correct only high-confidence keyboard slips, spelling, grammar, punctuation, missing articles or prepositions, and clearly wrong word order. Use the full sentence context to repair an obvious nearby-key typo when the intended word is clear. Preserve the user's meaning, tone, names, numbers, URLs and facts. Do not make stylistic rewrites and do not add new information. Return ONLY the corrected sentence, with no labels, explanations or quotation marks."
        return request(baseUrl, text, instructions)
    }

    private fun request(baseUrl: String, text: String, instructions: String): String {
        val endpoint = URL(baseUrl.trimEnd('/') + "/api/translate")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 12_000
        connection.readTimeout = 25_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")

        val body = JSONObject()
            .put("text", text)
            .put("instructions", instructions)
            .toString()

        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val response = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        val json = JSONObject(response.ifBlank { "{}" })

        if (connection.responseCode !in 200..299) {
            throw IllegalStateException(json.optString("error", "Ana request failed (${connection.responseCode})."))
        }
        return json.optString("content").trim().ifBlank { throw IllegalStateException("Ana returned no text.") }
    }
'''
text = text.replace(anchor, helper + anchor, 1)
start = text.index('        val endpoint = URL(baseUrl.trimEnd(\'/\') + "/api/translate")', text.index('fun transform'))
end_marker = '        return json.optString("content").trim().ifBlank { throw IllegalStateException("Ana returned no text.") }\n'
end = text.index(end_marker, start) + len(end_marker)
text = text[:start] + '        return request(baseUrl, text, instructions)\n' + text[end:]
p.write_text(text)

# Settings UI.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/MainActivity.kt')
text = p.read_text()
old = '''        root.addView(switchRow("Auto-correction", "Correct confident spelling mistakes when you press Space", KeyboardPrefs.autoCorrectionEnabled(this)) {
            KeyboardPrefs.setAutoCorrectionEnabled(this, it)
        })
        root.addView(switchRow("Word suggestions", "First choice is exactly what you typed; tap it to teach Ana that word", KeyboardPrefs.wordSuggestionsEnabled(this)) {'''
new = '''        root.addView(switchRow("Auto-correction", "Correct confident spelling mistakes when you press Space", KeyboardPrefs.autoCorrectionEnabled(this)) {
            KeyboardPrefs.setAutoCorrectionEnabled(this, it)
        })
        root.addView(switchRow("Smart sentence correction", "After a short pause, Ana can correct grammar and contextual typing mistakes across the whole sentence. This sends that sentence to your Ana server; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {
            KeyboardPrefs.setSmartSentenceCorrectionEnabled(this, it)
        })
        root.addView(switchRow("Word suggestions", "First choice is exactly what you typed; tap it to teach Ana that word", KeyboardPrefs.wordSuggestionsEnabled(this)) {'''
if old not in text:
    raise SystemExit('MainActivity correction anchor missing')
text = text.replace(old, new, 1)
text = text.replace(
    'root.addView(infoCard("Write", "Type or dictate what you want to say, then tap Write in the keyboard toolbar. Ana drafts the finished message in the current typing language."))',
    'root.addView(infoCard("Write", "Type or dictate what you want to say, then tap Write. Ana drafts the finished message in the currently selected Translate-to language."))',
    1,
)
p.write_text(text)

# Keyboard service: asynchronous whole-sentence correction that never blocks key input.
p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt')
text = p.read_text()
text = text.replace(
    '    private val executor = Executors.newSingleThreadExecutor()\n',
    '    private val executor = Executors.newSingleThreadExecutor()\n    private val smartSentenceExecutor = Executors.newSingleThreadExecutor()\n',
    1,
)
text = text.replace(
    '    private var lastAutoCorrection: AutoCorrectionRecord? = null\n',
    '    private var lastAutoCorrection: AutoCorrectionRecord? = null\n    private var lastSentenceCorrection: SentenceCorrectionRecord? = null\n    private var smartSentenceToken = 0\n    private var lastSmartSentenceChecked = ""\n',
    1,
)
text = text.replace(
    '    private data class AutoCorrectionRecord(val original: String, val corrected: String)\n',
    '''    private data class AutoCorrectionRecord(val original: String, val corrected: String)
    private data class SentenceCorrectionRecord(val original: String, val corrected: String, val trailing: String)
    private data class SentenceCandidate(val text: String, val suffix: String, val trailing: String)

    private val smartSentenceRunnable = Runnable { runSmartSentenceCorrection() }
''',
    1,
)
text = text.replace(
    '        lastAutoCorrection = null\n        cancelPendingGlide()\n',
    '        lastAutoCorrection = null\n        lastSentenceCorrection = null\n        lastSmartSentenceChecked = ""\n        smartSentenceToken++\n        mainHandler.removeCallbacks(smartSentenceRunnable)\n        cancelPendingGlide()\n',
    1,
)
text = text.replace(
    '            "BACKSPACE" -> {\n                if (undoLastAutoCorrection()) return\n',
    '            "BACKSPACE" -> {\n                smartSentenceToken++\n                mainHandler.removeCallbacks(smartSentenceRunnable)\n                if (undoLastSentenceCorrection()) return\n                if (undoLastAutoCorrection()) return\n',
    1,
)
text = text.replace(
    '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                } else clearSuggestions()
''',
    '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                    scheduleSmartSentenceCorrection()
                } else {
                    clearSuggestions()
                    if (punctuation) scheduleSmartSentenceCorrection()
                }
''',
    1,
)
text = text.replace(
    '        clearSuggestions()\n        refreshShiftFromEditor()\n    }\n\n    private fun replaceDelimitedWordNearCursor',
    '        clearSuggestions()\n        refreshShiftFromEditor()\n        scheduleSmartSentenceCorrection()\n    }\n\n    private fun replaceDelimitedWordNearCursor',
    1,
)
text = text.replace(
    '        refreshShiftFromEditor()\n    }\n\n    private fun clearSuggestions()',
    '        refreshShiftFromEditor()\n        scheduleSmartSentenceCorrection()\n    }\n\n    private fun clearSuggestions()',
    1,
)
marker = '    private fun handleSuggestionResult(word: String, suggestions: List<String>, looksLikeTypo: Boolean) {'
if marker not in text:
    raise SystemExit('Service suggestion anchor missing')
engine = r'''    private fun scheduleSmartSentenceCorrection() {
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return
        mainHandler.postDelayed(smartSentenceRunnable, 1200)
    }

    private fun currentSentenceCandidate(): SentenceCandidate? {
        val connection = currentInputConnection ?: return null
        val before = connection.getTextBeforeCursor(700, 0)?.toString().orEmpty()
        if (before.isBlank()) return null

        val trailing = Regex("\\s*$").find(before)?.value.orEmpty()
        val content = if (trailing.isEmpty()) before else before.dropLast(trailing.length)
        if (content.length < 14) return null

        val scan = if (content.lastOrNull() in listOf('.', '!', '?')) content.dropLast(1) else content
        val boundaries = listOf(scan.lastIndexOf(". "), scan.lastIndexOf("! "), scan.lastIndexOf("? "), scan.lastIndexOf('\n'))
        val boundary = boundaries.maxOrNull() ?: -1
        var start = when {
            boundary < 0 -> 0
            scan.getOrNull(boundary) == '\n' -> boundary + 1
            else -> boundary + 2
        }
        while (start < content.length && content[start].isWhitespace()) start++
        if (start >= content.length) return null

        val sentence = content.substring(start)
        val wordCount = Regex("[\\p{L}']+").findAll(sentence).count()
        if (wordCount < 4 || sentence.length < 14) return null
        val suffix = before.substring(start)
        return SentenceCandidate(sentence, suffix, trailing)
    }

    private fun runSmartSentenceCorrection() {
        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) return
        val candidate = currentSentenceCandidate() ?: return
        if (candidate.text == lastSmartSentenceChecked) return
        lastSmartSentenceChecked = candidate.text
        val connection = currentInputConnection ?: return
        val token = smartSentenceToken
        val languageHint = KeyboardPrefs.inputLanguage(this)

        smartSentenceExecutor.execute {
            try {
                val corrected = AnaApi.correctSentence(baseUrl, candidate.text, languageHint).trim()
                mainHandler.post {
                    if (token != smartSentenceToken || currentInputConnection !== connection) return@post
                    if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService) || isPasswordField()) return@post
                    if (!isSafeSentenceCorrection(candidate.text, corrected)) return@post
                    val tail = connection.getTextBeforeCursor(candidate.suffix.length, 0)?.toString().orEmpty()
                    if (tail != candidate.suffix) return@post

                    connection.deleteSurroundingText(candidate.suffix.length, 0)
                    val replacement = corrected + candidate.trailing
                    connection.commitText(replacement, 1)
                    lastSentenceCorrection = SentenceCorrectionRecord(candidate.text, corrected, candidate.trailing)
                    lastSmartSentenceChecked = corrected
                    clearSuggestions()
                    refreshShiftFromEditor()
                    showStatus("Sentence corrected")
                }
            } catch (_: Exception) {
                // Optional cloud correction must never interrupt typing.
            }
        }
    }

    private fun isSafeSentenceCorrection(original: String, corrected: String): Boolean {
        if (corrected.isBlank() || corrected == original) return false
        val originalNumbers = Regex("\\d+(?:[.,]\\d+)?").findAll(original).map { it.value }.toList()
        val correctedNumbers = Regex("\\d+(?:[.,]\\d+)?").findAll(corrected).map { it.value }.toList()
        if (originalNumbers != correctedNumbers) return false

        val originalWords = Regex("[\\p{L}']+").findAll(original).count()
        val correctedWords = Regex("[\\p{L}']+").findAll(corrected).count()
        if (kotlin.math.abs(originalWords - correctedWords) > maxOf(2, originalWords / 3)) return false
        if (kotlin.math.abs(original.length - corrected.length) > maxOf(30, original.length / 2)) return false
        return true
    }

    private fun undoLastSentenceCorrection(): Boolean {
        val record = lastSentenceCorrection ?: return false
        val connection = currentInputConnection ?: return false
        val tail = record.corrected + record.trailing
        val current = connection.getTextBeforeCursor(tail.length, 0)?.toString().orEmpty()
        if (current != tail) {
            lastSentenceCorrection = null
            return false
        }
        connection.deleteSurroundingText(tail.length, 0)
        connection.commitText(record.original + record.trailing, 1)
        lastSmartSentenceChecked = record.original
        lastSentenceCorrection = null
        showStatus("Sentence correction undone")
        return true
    }

'''
text = text.replace(marker, engine + marker, 1)
text = text.replace(
    '        executor.shutdownNow()\n        mainHandler.removeCallbacksAndMessages(null)\n',
    '        executor.shutdownNow()\n        smartSentenceExecutor.shutdownNow()\n        mainHandler.removeCallbacksAndMessages(null)\n',
    1,
)
p.write_text(text)

# In-app learning layout: one feature list + one short guide.
Path('src/learn.css').write_text('''.ana-learn-backdrop{position:fixed;inset:0;z-index:55;background:rgba(38,34,29,.32);backdrop-filter:blur(7px);display:flex;justify-content:center;align-items:flex-start;padding:72px 16px 20px}.ana-learn-panel{width:min(900px,100%);max-height:calc(100dvh - 92px);overflow:auto;background:#faf7f1;border:1px solid rgba(43,39,33,.14);border-radius:23px;box-shadow:0 28px 90px rgba(50,42,32,.22);padding:18px;color:#1d1b18}.ana-learn-head{display:flex;gap:18px;justify-content:space-between;padding:5px 6px 17px;border-bottom:1px solid rgba(43,39,33,.1)}.ana-learn-head>div{max-width:700px}.ana-learn-head>div>span{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#897f72;font-weight:700}.ana-learn-head h2{margin:7px 0 6px;font-size:27px;letter-spacing:-.035em}.ana-learn-head p{margin:0;color:#746c62;font-size:12px;line-height:1.5}.ana-learn-head>button{border:0;background:transparent;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:#71695f;cursor:pointer}.ana-learn-focus{display:grid;grid-template-columns:minmax(230px,.75fr) minmax(0,1.25fr);gap:12px;padding:16px 4px}.ana-learn-menu{display:grid;gap:6px;align-content:start}.ana-learn-menu button{border:1px solid rgba(43,39,33,.1);background:rgba(255,253,249,.72);border-radius:12px;padding:9px 10px;display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:8px;text-align:left;color:#302c27;cursor:pointer}.ana-learn-menu button.active{background:#1b1a18;color:#fff;border-color:#1b1a18}.ana-learn-menu button>span{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:#eee7dc;color:#292622}.ana-learn-menu button.active>span{background:#3b3935;color:#fff}.ana-learn-menu button>div{display:flex;flex-direction:column}.ana-learn-menu strong{font-size:11px}.ana-learn-menu small{font-size:9px;color:#8b8277;margin-top:2px}.ana-learn-menu button.active small{color:#c9c1b6}.ana-learn-detail{border:1px solid rgba(43,39,33,.1);border-radius:16px;background:#fffdfa;padding:20px;min-height:330px}.ana-learn-detail-title{display:flex;align-items:center;gap:11px}.ana-learn-detail-title>span{width:40px;height:40px;border-radius:11px;background:#1b1a18;color:#fff;display:grid;place-items:center}.ana-learn-detail-title small{font-size:9px;color:#8b8277}.ana-learn-detail-title h3{font-size:22px;margin:2px 0 0}.ana-learn-detail>p{font-size:12px;line-height:1.55;color:#696158;margin:20px 0 14px}.ana-learn-detail ol{margin:0 0 22px;padding-left:22px;font-size:11px;line-height:1.8;color:#4f4942}.ana-learn-detail>button{display:inline-flex;align-items:center;gap:6px;border:0;background:#1b1a18;color:#fff;border-radius:999px;padding:9px 12px;font-size:10px;font-weight:700;cursor:pointer}.ana-learn-links{border-top:1px solid rgba(43,39,33,.1);padding:15px 6px 3px;display:flex;align-items:center;justify-content:space-between;gap:18px}.ana-learn-links>div{display:flex;flex-direction:column;max-width:520px}.ana-learn-links strong{font-size:12px}.ana-learn-links span{font-size:10px;color:#82796e;margin-top:3px}.ana-learn-links nav{display:flex;gap:7px}.ana-learn-links a{border:1px solid rgba(43,39,33,.12);border-radius:999px;padding:7px 10px;background:#fffdfa;font-size:10px;font-weight:700;color:#4b453e;text-decoration:none}@media(max-width:760px){.ana-learn-backdrop{align-items:flex-end;padding:0}.ana-learn-panel{width:100%;max-height:90dvh;border-radius:23px 23px 0 0;border-bottom:0;padding:12px 10px calc(12px + env(safe-area-inset-bottom))}.ana-learn-panel:before{content:"";display:block;width:38px;height:4px;border-radius:99px;background:#c7beb1;margin:0 auto 9px}.ana-learn-head h2{font-size:23px}.ana-learn-focus{grid-template-columns:1fr}.ana-learn-menu{display:flex;overflow-x:auto;gap:6px;padding-bottom:3px}.ana-learn-menu button{min-width:155px;grid-template-columns:28px 1fr}.ana-learn-menu button>svg{display:none}.ana-learn-detail{min-height:0;padding:16px}.ana-learn-links{flex-direction:column;align-items:flex-start}}\n''')

# Public Learn page: compact feature navigator. Only one guide is visible at a time.
Path('public/learn/index.html').write_text(r'''<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f4f1ea"><title>Learn Ana — Short guides by feature</title><meta name="description" content="Short, focused guides for each Ana feature, including Ana Keyboard, smart sentence correction and Ana Platform API."><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f4f1ea}*{box-sizing:border-box}body{margin:0;background:#f4f1ea}a{color:inherit}.wrap{width:min(1100px,calc(100% - 28px));margin:auto}.top{min-height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8d1c7}.brand{display:flex;align-items:center;gap:9px;text-decoration:none;font-weight:800}.brand img{width:35px;height:35px}.nav{display:flex;gap:7px;flex-wrap:wrap}.nav a{text-decoration:none;font-size:11px;font-weight:700;padding:8px 10px;border-radius:999px}.hero{padding:64px 0 30px;max-width:720px}.kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8b8277;font-weight:800}.hero h1{font-size:clamp(40px,7vw,68px);line-height:.96;letter-spacing:-.05em;margin:10px 0 14px}.hero p{font-size:14px;line-height:1.6;color:#70685f;max-width:630px}.learn{display:grid;grid-template-columns:310px 1fr;gap:16px;padding:15px 0 70px}.menu{display:grid;gap:7px;align-content:start;position:sticky;top:14px}.menu button{width:100%;border:1px solid #ddd5ca;background:#fffdfa;border-radius:13px;padding:11px 12px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;gap:10px}.menu button strong{font-size:12px}.menu button small{display:block;color:#8a8176;font-size:9px;margin-top:3px}.menu button.active{background:#171717;color:white;border-color:#171717}.menu button.active small{color:#bdb7ae}.guide{border:1px solid #ddd5ca;background:#fffdfa;border-radius:20px;padding:26px;min-height:430px}.guide section{display:none}.guide section.active{display:block}.guide .eyebrow{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8a8176;font-weight:800}.guide h2{font-size:32px;letter-spacing:-.04em;margin:8px 0 10px}.guide .lead{font-size:13px;line-height:1.6;color:#6b645b;max-width:650px}.steps{display:grid;gap:9px;margin:22px 0}.step{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;border-top:1px solid #ebe5dc;padding-top:10px}.step i{width:25px;height:25px;border-radius:50%;background:#eee8de;display:grid;place-items:center;font-style:normal;font-size:10px}.step b{font-size:11px}.step p{font-size:10px;line-height:1.5;color:#746c62;margin:3px 0}.note{background:#eee8de;border-radius:12px;padding:12px;font-size:10px;line-height:1.55;color:#5f584f}.link{display:inline-flex;margin-top:16px;background:#171717;color:#fff;text-decoration:none;border-radius:999px;padding:9px 12px;font-size:10px;font-weight:800}.foot{border-top:1px solid #d8d1c7;padding:20px 0 35px;font-size:10px;color:#847c72;display:flex;justify-content:space-between}@media(max-width:760px){.top{padding:12px 0;align-items:flex-start}.nav{justify-content:flex-end}.hero{padding:44px 0 22px}.learn{grid-template-columns:1fr;padding-top:5px}.menu{display:flex;overflow-x:auto;position:static}.menu button{min-width:175px}.guide{min-height:0;padding:20px}.foot{flex-direction:column;gap:9px}}
</style></head><body><div class="wrap"><header class="top"><a class="brand" href="/meet-ana/"><img src="/ana-app-icon.png" alt="Ana"><span>Ana</span></a><nav class="nav"><a href="/meet-ana/">Product</a><a href="/learn/" aria-current="page">Learn</a><a href="/developers/">Developers</a><a href="/">Open Ana</a></nav></header><main><section class="hero"><div class="kicker">Learn Ana</div><h1>One feature. One short guide.</h1><p>Choose what you are using. Only that guide opens, so you do not need to read a long manual to find one answer.</p></section><div class="learn"><nav class="menu" id="menu"></nav><article class="guide" id="guide"></article></div></main><footer class="foot"><span>© Ana · Your voice, in any language.</span><span>Short guides · no manual required</span></footer></div><script>
const guides=[
['translate','Translate','One message or paragraph','Type, paste or dictate text and translate it into the language you choose.',[['1','Add your text','Type, paste or use voice.'],['2','Choose a target','Pick the language you want to receive.'],['3','Translate','Review, refine or copy the result.']],'Translation keeps meaning, names, dates and numbers in view.'],
['keyboard','Ana Keyboard','Ana inside other apps','Use Ana while typing in messaging, email and other Android apps.',[['1','Choose typing language','EN, DE or Hinglish controls the keyboard layout and local correction.'],['2','Type normally','Suggestions, autocorrection, glide, voice and your personal dictionary are available without opening Ana.'],['3','Use Ana actions when needed','Translate, Write and Correct use the selected Translate-to language.']],'The keyboard can be resized, themed and tested directly inside its Settings screen.'],
['sentence','Smart sentence correction','Context-aware correction','Optionally let Ana check the whole sentence after a short pause, not only one word at a time.',[['1','Enable it in Typing settings','It is separate from local word autocorrection.'],['2','Keep typing normally','Ana waits for a pause and never blocks key input.'],['3','Ana fixes the sentence','Grammar, punctuation, word order and clear contextual keyboard slips can be corrected automatically.']],'This feature sends the current sentence to your configured Ana server. Basic word suggestions and autocorrection remain local.'],
['write','Write','Draft in the target language','Describe what you want to say and Ana writes the finished message in the selected Translate-to language.',[['1','Choose Translate-to language','For example German, English or French.'],['2','Type the intent','Rough notes are enough.'],['3','Tap Write','Ana replaces the draft with a ready-to-send message.']],'Write creates a message; it is different from Translate, which preserves the text you already wrote.'],
['correct','Correct','Fix a longer message','Correct spelling, grammar and wording across a longer draft and return it in the selected Translate-to language.',[['1','Select or type the draft','Ana can use selected text or the current line.'],['2','Choose target language','Correct can also convert a mixed-language draft into that language.'],['3','Tap Correct','The corrected text replaces the draft only if the text has not changed while Ana was working.']],'Use Correct for a longer message; local autocorrection is for individual typing mistakes.'],
['dictionary','Dictionary & learning','Teach Ana your words','Keep names, SAP terms, Hinglish and other valid words that normal dictionaries may not know.',[['1','Tap the exact word','The first suggestion is what you actually typed.'],['2','Ana stores it locally','The word becomes part of your personal dictionary.'],['3','Corrections are learned too','When you choose a correction, Ana remembers the mapping for that typing language.']],'Translation glossary and typing dictionary are separate: one controls terminology, the other controls keyboard correction.'],
['glide','Glide typing','Swipe to type','Swipe deliberately through letters to create a word; fast tapping remains normal typing.',[['1','Start on the first letter','Move across the intended keys.'],['2','Lift after the last letter','Ana decodes the finger path against the local dictionary.'],['3','Keep or correct','The decoded word is inserted with a space.']],'Glide and its visible trail can be turned on or off independently.'],
['rich','Voice, emoji & GIF','Rich keyboard input','Use Android voice typing, emoji, clipboard and GIF search without leaving the keyboard.',[['1','Mic','Dictate into the active field.'],['2','Emoji/GIF','Choose emoji or search online GIFs; you can also pick a GIF from your phone.'],['3','Clipboard','Open recent local text clips and paste them.']],'Online GIF search currently uses KLIPY. The production app should use Ana’s own provider key.'],
['live','Live Interpreter','A back-and-forth conversation','Use Live when two people are speaking and each side needs interpretation.',[['1','Choose both languages','Set what each person speaks.'],['2','Start','Speak naturally in turns.'],['3','Read or hear the interpretation','Ana translates each side while you remain the person deciding.']],'Use Talk for Me instead when you want Ana to conduct the routine conversation for you.'],
['meeting','Meeting Listen','Long meeting + transcript','Use this for Teams, Zoom or longer sessions when you want live translated text and a transcript.',[['1','Open Ana beside the meeting','Use shared computer audio when available.'],['2','Choose the language you want to read','Ana processes the meeting in rolling segments.'],['3','Keep the text','Meeting Listen keeps translated text, not the meeting audio.']],'For temporary subtitles without a saved transcript, use Live Subtitles.'],
['talk','Talk for Me','Ana handles routine dialogue','Give Ana a goal and constraints. Ana can handle the conversation while important decisions remain with you.',[['1','Describe the outcome','Be clear about what Ana may and may not accept.'],['2','Start the conversation','Ana handles routine questions and collects critical facts.'],['3','You keep decisions','Ana pauses when price, appointment, commitment or another material choice needs you.']],'Talk for Me is designed around an explicit owner-decision boundary.'],
['documents','Documents & Camera','Translate what you can see','Use Camera for visible text and Documents for letters, forms, PDFs and scans.',[['1','Capture or upload','Take a photo or choose a document.'],['2','Choose the target language','Ana reads the content.'],['3','Review the translation','Check critical names, dates, reference numbers and amounts.']],'For important healthcare, legal, banking or authority documents, verify critical facts yourself.'],
['api','Ana Platform API','Build Ana into software','Ana also exposes server APIs for partner products.',[['1','Translate API','POST /api/v1/translate for meaning-first text translation.'],['2','Transcribe API','POST /api/v1/transcribe for short audio segments.'],['3','Talk for Me sessions','POST /api/v1/talk-session for the realtime owner-goal and decision contract.']],'Partner keys belong on a trusted backend, never inside a public browser or mobile bundle.']]
];
const menu=document.getElementById('menu'),guide=document.getElementById('guide');let active='translate';
function draw(){menu.innerHTML=guides.map(g=>`<button data-id="${g[0]}" class="${g[0]===active?'active':''}"><span><strong>${g[1]}</strong><small>${g[2]}</small></span><span>→</span></button>`).join('');const g=guides.find(x=>x[0]===active)||guides[0];guide.innerHTML=`<section class="active"><div class="eyebrow">${g[2]}</div><h2>${g[1]}</h2><p class="lead">${g[3]}</p><div class="steps">${g[4].map(s=>`<div class="step"><i>${s[0]}</i><div><b>${s[1]}</b><p>${s[2]}</p></div></div>`).join('')}</div><div class="note">${g[5]}</div>${active==='api'?'<a class="link" href="/developers/">Open API documentation →</a>':'<a class="link" href="/">Open Ana →</a>'}</section>`;menu.querySelectorAll('button').forEach(b=>b.onclick=()=>{active=b.dataset.id;history.replaceState(null,'',`?guide=${active}`);draw()})}
const requested=new URLSearchParams(location.search).get('guide');if(guides.some(g=>g[0]===requested))active=requested;draw();
</script></body></html>''')

# Product page: advertise keyboard, sentence intelligence and API alongside existing features.
p = Path('public/meet-ana/index.html')
text = p.read_text()
anchor = '''        <article class="feature"><div class="icon">◇</div><h3>Remembers how you communicate</h3><p>Ana can remember language preferences, personal terminology and German Sie/du choices while keeping important decisions with you.</p></article>
'''
addition = anchor + '''        <article class="feature"><div class="icon">⌨</div><h3>Ana Keyboard</h3><p>Use Ana inside Android apps with local word suggestions and autocorrection, glide typing, voice, clipboard, emoji/GIF, learned words, resizeable layouts and Translate, Write or Correct when you need them.</p></article>
        <article class="feature"><div class="icon">✓</div><h3>Understands the whole sentence</h3><p>Optional Smart sentence correction can fix grammar, punctuation, word order and clear context-sensitive typing slips after you pause — without blocking normal typing.</p></article>
        <article class="feature"><div class="icon">{ }</div><h3>Ana Platform API</h3><p>Bring Ana into another product with server APIs for meaning-first translation, transcription and the realtime Talk for Me foundation. <a href="/developers/"><b>Developer API →</b></a></p></article>
'''
if anchor not in text:
    raise SystemExit('Meet Ana feature anchor missing')
text = text.replace(anchor, addition, 1)
p.write_text(text)

# Developer docs: use the public Ana domain consistently.
for file in ['public/developers/index.html', 'public/developers/openapi.json']:
    p = Path(file)
    text = p.read_text().replace('https://vak-gray.vercel.app', 'https://ana-translate.vercel.app')
    p.write_text(text)
