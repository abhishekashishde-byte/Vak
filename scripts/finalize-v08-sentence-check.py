from pathlib import Path

p = Path('android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt')
text = p.read_text()

old_fields = '''    private var lastSentenceCorrection: SentenceCorrectionRecord? = null
    private var smartSentenceToken = 0
    private var lastSmartSentenceChecked = ""
'''
new_fields = '''    private var lastSentenceCorrection: SentenceCorrectionRecord? = null
    private var smartSentenceToken = 0
    private var lastSmartSentenceChecked = ""
    @Volatile private var smartSentenceInFlight = false
'''
if old_fields not in text:
    raise SystemExit('smart sentence fields anchor missing')
text = text.replace(old_fields, new_fields, 1)

old_letters = '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                } else {
                    clearSuggestions()
                    if (punctuation) scheduleSmartSentenceCorrection()
                }
'''
new_letters = '''                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                    // A user may stop immediately after the final letter. Keep this
                    // lightweight delayed check so no trailing Space is required.
                    scheduleSmartSentenceCorrection()
                } else {
                    clearSuggestions()
                    if (punctuation) scheduleSmartSentenceCorrection()
                }
'''
if old_letters not in text:
    raise SystemExit('letter scheduling anchor missing')
text = text.replace(old_letters, new_letters, 1)

text = text.replace('mainHandler.postDelayed(smartSentenceRunnable, 650)', 'mainHandler.postDelayed(smartSentenceRunnable, 950)', 1)

old_start = '''    private fun runSmartSentenceCorrection() {
        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return
        val baseUrl = KeyboardPrefs.baseUrl(this)
'''
new_start = '''    private fun runSmartSentenceCorrection() {
        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return
        if (smartSentenceInFlight) return
        val baseUrl = KeyboardPrefs.baseUrl(this)
'''
if old_start not in text:
    raise SystemExit('run smart sentence anchor missing')
text = text.replace(old_start, new_start, 1)

old_exec = '''        val languageHint = KeyboardPrefs.inputLanguage(this)
        showStatus("Checking sentence…")

        smartSentenceExecutor.execute {
            try {
'''
new_exec = '''        val languageHint = KeyboardPrefs.inputLanguage(this)
        showStatus("Checking sentence…")
        smartSentenceInFlight = true

        smartSentenceExecutor.execute {
            try {
'''
if old_exec not in text:
    raise SystemExit('smart sentence executor anchor missing')
text = text.replace(old_exec, new_exec, 1)

old_catch = '''            } catch (_: Exception) {
                // Network/API failure must never interrupt typing, but it should
                // not fail invisibly either.
                mainHandler.post {
                    if (token == smartSentenceToken && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        showStatus("Sentence check unavailable")
                    }
                }
            }
        }
    }
'''
new_catch = '''            } catch (_: Exception) {
                // Network/API failure must never interrupt typing, but it should
                // not fail invisibly either.
                mainHandler.post {
                    if (token == smartSentenceToken && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        showStatus("Sentence check unavailable")
                    }
                }
            } finally {
                mainHandler.post {
                    smartSentenceInFlight = false
                    // If the user continued typing while an older request was in
                    // flight, schedule one fresh check for the latest sentence.
                    if (token != smartSentenceToken && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        scheduleSmartSentenceCorrection()
                    }
                }
            }
        }
    }
'''
if old_catch not in text:
    raise SystemExit('smart sentence catch anchor missing')
text = text.replace(old_catch, new_catch, 1)

p.write_text(text)
