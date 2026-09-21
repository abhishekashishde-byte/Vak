package com.ana.keyboard

import android.Manifest
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputContentInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.inputmethodservice.InputMethodService
import java.util.concurrent.Executors

class AnaKeyboardService : InputMethodService(), AnaKeyboardView.Listener {
    private lateinit var keyboard: AnaKeyboardView
    private lateinit var emojiPanel: EmojiPanelView
    private lateinit var clipboardPanel: ClipboardPanelView
    private lateinit var translationPicker: TranslationLanguagePickerView
    private lateinit var inputLanguagePicker: InputLanguagePickerView
    private lateinit var contentHost: FrameLayout
    private lateinit var status: TextView
    private lateinit var targetButton: Button
    private lateinit var suggestionEngine: LocalSuggestionEngine

    private var voiceButton: ImageButton? = null
    private val aiButtons = mutableListOf<Button>()
    private val suggestionButtons = mutableListOf<TextView>()

    private val executor = Executors.newSingleThreadExecutor()
    private val smartSentenceExecutor = Executors.newSingleThreadExecutor()
    private val feedbackExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val vibrator by lazy { getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }

    private var capsLock = false
    private var lastShiftTap = 0L
    private var lastSpaceTap = 0L
    private var lastSuggestedWord = ""
    private var bestCorrection: String? = null
    private var lastLooksLikeTypo = false

    private var pendingGlide: String? = null
    private var pendingGlideCapitalized = false
    private var pendingGlideToken = 0
    private var pendingDelimitedWord: String? = null
    private var lastAutoCorrection: AutoCorrectionRecord? = null
    private var lastSentenceCorrection: SentenceCorrectionRecord? = null
    private var smartSentenceToken = 0
    private var lastSmartSentenceChecked = ""
    @Volatile private var smartSentenceInFlight = false
    private var shortcutCache: Map<String, String> = emptyMap()

    // Cached once per input session so physical key taps never need to query
    // SharedPreferences or rebuild dictionaries on the hot path.
    private var cachedWordSuggestionsEnabled = true
    private var cachedSmartSentenceEnabled = false
    private var cachedAutoCorrectionEnabled = true
    private var cachedDoubleSpacePeriodEnabled = true
    private var cachedAutoSpacePunctuation = true
    private var cachedHapticEnabled = true
    private var cachedHapticStrengthMs = 6
    private var cachedSoundEnabled = true
    private var cachedInputBadge = "EN"
    private var cachedPersonalWords: Set<String> = emptySet()
    private var cachedLearnedCorrections: Map<String, String> = emptyMap()
    private var cachedKnownPrefixes: Set<String> = emptySet()
    private val composingBuffer = ComposingWordBuffer()
    private var localCompositionActive = false
    private var typingIdleSawLetter = false
    private var typingIdleSawPunctuation = false

    private var speechRecognizer: SpeechRecognizer? = null
    private var voiceListening = false

    private data class AutoCorrectionRecord(val original: String, val corrected: String)
    private data class SentenceCorrectionRecord(val original: String, val corrected: String, val trailing: String)
    private data class SentenceCandidate(val text: String, val suffix: String, val trailing: String)

    private val smartSentenceRunnable = Runnable { runSmartSentenceCorrection() }

    private val typingIdleRunnable = Runnable {
        val sawLetter = typingIdleSawLetter
        val sawPunctuation = typingIdleSawPunctuation
        typingIdleSawLetter = false
        typingIdleSawPunctuation = false

        if (cachedWordSuggestionsEnabled && !isPasswordField()) {
            showTypedWordCandidate()
            requestSuggestionsSoon()
        } else {
            clearSuggestions()
        }
        if (sawLetter || sawPunctuation) scheduleSmartSentenceCorrection()
    }

    private val glideFallbackRunnable = Runnable {
        val raw = pendingGlide ?: return@Runnable
        val fallback = CoreLexicon.decodeGlide(raw, KeyboardPrefs.inputBadge(this))
        if (!fallback.isNullOrBlank()) commitGlide(fallback)
        else {
            pendingGlide = null
            pendingGlideCapitalized = false
            showStatus("Swipe not recognized")
        }
    }

    private val suggestionRunnable = Runnable {
        if (!cachedWordSuggestionsEnabled || isPasswordField()) {
            clearSuggestions()
            return@Runnable
        }
        val word = currentWord()
        if (word.isNullOrBlank()) {
            clearSuggestions()
            return@Runnable
        }
        suggestionEngine.setLanguage(cachedInputBadge)
        suggestionEngine.request(word)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun refreshTypingCache() {
        cachedWordSuggestionsEnabled = KeyboardPrefs.wordSuggestionsEnabled(this)
        cachedSmartSentenceEnabled = KeyboardPrefs.smartSentenceCorrectionEnabled(this)
        cachedAutoCorrectionEnabled = KeyboardPrefs.autoCorrectionEnabled(this)
        cachedDoubleSpacePeriodEnabled = KeyboardPrefs.doubleSpacePeriodEnabled(this)
        cachedAutoSpacePunctuation = KeyboardPrefs.autoSpaceAfterPunctuation(this)
        cachedHapticEnabled = KeyboardPrefs.hapticEnabled(this)
        cachedHapticStrengthMs = KeyboardPrefs.hapticStrengthMs(this)
        cachedSoundEnabled = KeyboardPrefs.soundEnabled(this)
        cachedInputBadge = KeyboardPrefs.inputBadge(this)
        cachedPersonalWords = KeyboardPrefs.personalDictionary(this, cachedInputBadge)
            .map { it.lowercase() }.toSet()
        cachedLearnedCorrections = KeyboardPrefs.learnedCorrections(this, cachedInputBadge)
        cachedKnownPrefixes = TouchLanguageRanker.buildPrefixSet(
            cachedPersonalWords + cachedLearnedCorrections.keys + cachedLearnedCorrections.values
        )
    }

    private fun scheduleTypingIdleUpdate(letter: Boolean, punctuation: Boolean) {
        typingIdleSawLetter = typingIdleSawLetter || letter
        typingIdleSawPunctuation = typingIdleSawPunctuation || punctuation
        mainHandler.removeCallbacks(typingIdleRunnable)
        // Do not wake suggestion/regex work between fast keystrokes.
        // Wait for a real pause in typing.
        mainHandler.postDelayed(typingIdleRunnable, 180)
    }

    override fun onCreate() {
        super.onCreate()
        KeyboardPrefs.migrateLearningStore(this)
        suggestionEngine = LocalSuggestionEngine(this) { word, suggestions, typo ->
            mainHandler.post { handleSuggestionResult(word, suggestions, typo) }
        }
    }

    override fun onCreateInputView(): View {
        aiButtons.clear()
        suggestionButtons.clear()
        voiceButton = null

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(keyboardShellColor())
        }

        if (KeyboardPrefs.toolbarEnabled(this)) {
            val toolbarScroll = HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
            }
            val toolbar = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(5), dp(4), dp(5), dp(3))
            }

            targetButton = actionButton("→ ${KeyboardPrefs.targetBadge(this)}") { showTranslationPicker() }
                .also { toolbar.addView(it) }
            toolbar.addView(actionButton("Translate") { runAnaAction(AnaApi.Action.TRANSLATE) }.also { aiButtons += it })
            toolbar.addView(actionButton("Write") { runAnaAction(AnaApi.Action.WRITE) }.also { aiButtons += it })
            toolbar.addView(actionButton("Correct") { runAnaAction(AnaApi.Action.FIX) }.also { aiButtons += it })
            toolbar.addView(iconButton(R.drawable.ic_clipboard, "Clipboard") { showClipboardPanel() })
            if (KeyboardPrefs.voiceTypingEnabled(this)) {
                voiceButton = iconButton(R.drawable.ic_mic, "Voice typing") { toggleVoiceTyping() }
                    .also { toolbar.addView(it) }
            }

            toolbarScroll.addView(toolbar)
            root.addView(toolbarScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        } else {
            targetButton = Button(this).apply { visibility = View.GONE }
        }

        if (KeyboardPrefs.wordSuggestionsEnabled(this)) {
            val suggestionStrip = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                setPadding(dp(4), dp(1), dp(4), dp(1))
                setBackgroundColor(Color.argb(232, 31, 31, 31))
            }
            repeat(3) {
                val cell = TextView(this).apply {
                    textSize = 16f
                    setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER
                    maxLines = 1
                    setPadding(dp(5), 0, dp(5), 0)
                    setOnClickListener {
                        val suggestion = text.toString().trim()
                        if (suggestion.isNotEmpty()) applySuggestion(suggestion)
                    }
                }
                suggestionButtons += cell
                suggestionStrip.addView(cell, LinearLayout.LayoutParams(0, dp(38), 1f))
            }
            root.addView(suggestionStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        }

        status = TextView(this).apply {
            text = defaultStatus()
            textSize = 11f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            setBackgroundColor(Color.argb(218, 35, 35, 35))
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)))

        contentHost = FrameLayout(this)
        keyboard = AnaKeyboardView(this).apply { listener = this@AnaKeyboardService }
        emojiPanel = EmojiPanelView(this).apply {
            visibility = View.GONE
            listener = object : EmojiPanelView.Listener {
                override fun onEmoji(emoji: String) {
                    currentInputConnection?.let { connection ->
                        finishLocalComposition(connection)
                        connection.commitText(emoji, 1)
                    }
                    clearSuggestions()
                }

                override fun onGifRequested() {
                    startActivity(Intent(this@AnaKeyboardService, GifPickerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    showStatus("Search GIFs")
                }

                override fun onBackToLetters() = showLetterKeyboard()
            }
        }
        clipboardPanel = ClipboardPanelView(this).apply {
            visibility = View.GONE
            listener = object : ClipboardPanelView.Listener {
                override fun onPaste(text: String) {
                    currentInputConnection?.let { connection ->
                        finishLocalComposition(connection)
                        connection.commitText(text, 1)
                    }
                    KeyboardPrefs.rememberClipboard(this@AnaKeyboardService, text)
                    showLetterKeyboard()
                    requestSuggestionsSoon()
                }

                override fun onBackToLetters() = showLetterKeyboard()

                override fun onClearHistory() {
                    KeyboardPrefs.clearClipboardHistory(this@AnaKeyboardService)
                    refreshClipboardPanel()
                    showStatus("Clipboard history cleared")
                }
            }
        }
        translationPicker = TranslationLanguagePickerView(this).apply {
            visibility = View.GONE
            listener = object : TranslationLanguagePickerView.Listener {
                override fun onLanguageSelected(name: String) {
                    KeyboardPrefs.setTarget(this@AnaKeyboardService, name)
                    if (::targetButton.isInitialized) targetButton.text = "→ ${KeyboardPrefs.targetBadge(this@AnaKeyboardService)}"
                    showLetterKeyboard()
                    showStatus("Translate to $name")
                }

                override fun onBackToKeyboard() = showLetterKeyboard()
            }
        }
        inputLanguagePicker = InputLanguagePickerView(this).apply {
            visibility = View.GONE
            listener = object : InputLanguagePickerView.Listener {
                override fun onLanguageSelected(name: String) {
                    KeyboardPrefs.setInputLanguage(this@AnaKeyboardService, name)
                    refreshTypingCache()
                    suggestionEngine.setLanguage(cachedInputBadge)
                    shortcutCache = KeyboardPrefs.textShortcuts(this@AnaKeyboardService)
                    keyboard.refreshPreferences()
                    showLetterKeyboard()
                    showStatus("Typing: $name")
                }

                override fun onBackToKeyboard() = showLetterKeyboard()
            }
        }

        contentHost.addView(keyboard, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(emojiPanel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(clipboardPanel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(translationPicker, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(inputLanguagePicker, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(
            contentHost,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(KeyboardSizing.keyboardHeightDp(this)))
        )

        root.addView(
            View(this).apply { setBackgroundColor(keyboardShellColor()) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(KeyboardSizing.bottomSpacerDp(this)))
        )

        loadBackgroundImage()
        refreshTypingCache()
        suggestionEngine.setLanguage(cachedInputBadge)
        shortcutCache = KeyboardPrefs.textShortcuts(this)
        clearSuggestions()
        updateAiAvailability()
        return root
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        capsLock = false
        lastSpaceTap = 0L
        pendingDelimitedWord = null
        lastAutoCorrection = null
        lastSentenceCorrection = null
        lastSmartSentenceChecked = ""
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        cancelPendingGlide()
        clearSuggestions()
        if (::keyboard.isInitialized) {
            keyboard.setSymbols(false)
            refreshShiftFromEditor()
            updateAiAvailability()
        }
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        composingBuffer.clear()
        localCompositionActive = false
        stopVoiceTyping(false)
        if (::keyboard.isInitialized) {
            refreshTypingCache()
            showLetterKeyboard()
            keyboard.refreshPreferences()
            loadBackgroundImage()
            if (::targetButton.isInitialized) targetButton.text = "→ ${KeyboardPrefs.targetBadge(this)}"
            suggestionEngine.setLanguage(cachedInputBadge)
            suggestionEngine.refreshUserData()
            shortcutCache = KeyboardPrefs.textShortcuts(this)
            requestSuggestionsSoon()
            mainHandler.postDelayed({ commitPendingGifIfAny() }, 120)
        }
    }

    override fun onWindowShown() {
        super.onWindowShown()
        mainHandler.postDelayed({ commitPendingGifIfAny() }, 120)
    }

    override fun onUpdateSelection(
        oldSelStart: Int,
        oldSelEnd: Int,
        newSelStart: Int,
        newSelEnd: Int,
        candidatesStart: Int,
        candidatesEnd: Int
    ) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        // If the editor/user moved out of Ana's composing region, do not let the
        // next key replace stale text somewhere else in the document.
        if (!composingBuffer.isEmpty && candidatesStart < 0) {
            composingBuffer.clear()
            localCompositionActive = false
        }
    }

    private fun hidePanels() {
        if (::emojiPanel.isInitialized) emojiPanel.visibility = View.GONE
        if (::clipboardPanel.isInitialized) clipboardPanel.visibility = View.GONE
        if (::translationPicker.isInitialized) translationPicker.visibility = View.GONE
        if (::inputLanguagePicker.isInitialized) inputLanguagePicker.visibility = View.GONE
        if (::keyboard.isInitialized) keyboard.visibility = View.GONE
    }

    private fun showEmojiPanel() {
        stopVoiceTyping(false)
        hidePanels()
        emojiPanel.visibility = View.VISIBLE
        showStatus("Emoji & GIF")
    }

    private fun showClipboardPanel() {
        if (isPasswordField()) {
            showStatus("Clipboard is hidden in password fields")
            return
        }
        stopVoiceTyping(false)
        refreshClipboardPanel()
        hidePanels()
        clipboardPanel.visibility = View.VISIBLE
        showStatus("Clipboard")
    }

    private fun showTranslationPicker() {
        if (isPasswordField()) return
        stopVoiceTyping(false)
        translationPicker.refresh()
        hidePanels()
        translationPicker.visibility = View.VISIBLE
        showStatus("Choose translation language")
    }

    private fun showInputLanguagePicker() {
        stopVoiceTyping(false)
        inputLanguagePicker.refresh()
        hidePanels()
        inputLanguagePicker.visibility = View.VISIBLE
        showStatus("Choose keyboard language")
    }

    private fun refreshClipboardPanel() {
        if (isPasswordField()) return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val primary = clipboard.primaryClip
        if (primary != null && primary.itemCount > 0) {
            val text = primary.getItemAt(0).coerceToText(this)?.toString()?.trim().orEmpty()
            if (text.isNotBlank()) KeyboardPrefs.rememberClipboard(this, text)
        }
        clipboardPanel.setItems(KeyboardPrefs.clipboardHistory(this))
    }

    private fun showLetterKeyboard() {
        hidePanels()
        keyboard.visibility = View.VISIBLE
        requestSuggestionsSoon()
    }

    private fun keyboardShellColor(): Int = when (KeyboardPrefs.theme(this)) {
        "light" -> Color.rgb(225, 228, 232)
        "midnight" -> Color.BLACK
        "gold" -> Color.rgb(17, 17, 17)
        else -> Color.rgb(26, 26, 26)
    }

    private fun controlColor(): Int =
        if (KeyboardPrefs.theme(this) == "gold") Color.rgb(79, 68, 42) else Color.rgb(48, 48, 50)

    private fun actionButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(Color.WHITE)
        backgroundTintList = ColorStateList.valueOf(controlColor())
        minWidth = 0
        minimumWidth = 0
        setPadding(dp(12), 0, dp(12), 0)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(40)).apply { marginEnd = dp(5) }
    }

    private fun iconButton(icon: Int, description: String, onClick: () -> Unit): ImageButton = ImageButton(this).apply {
        setImageResource(icon)
        imageTintList = ColorStateList.valueOf(Color.WHITE)
        backgroundTintList = ColorStateList.valueOf(controlColor())
        contentDescription = description
        setPadding(dp(10), dp(10), dp(10), dp(10))
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(dp(43), dp(40)).apply { marginEnd = dp(5) }
    }

    private fun vibrateSuggestionTap() {
        if (!KeyboardPrefs.hapticEnabled(this)) return
        vibrator.vibrate(
            VibrationEffect.createOneShot(
                KeyboardPrefs.hapticStrengthMs(this).toLong(),
                VibrationEffect.DEFAULT_AMPLITUDE
            )
        )
    }

    override fun onPressFeedback(view: View) {
        val haptic = cachedHapticEnabled
        val strength = cachedHapticStrengthMs
        val sound = cachedSoundEnabled
        // Binder calls for vibration/audio must not sit in front of character delivery.
        feedbackExecutor.execute {
            if (haptic) {
                vibrator.vibrate(
                    VibrationEffect.createOneShot(
                        strength.toLong(),
                        VibrationEffect.DEFAULT_AMPLITUDE
                    )
                )
            }
            if (sound) audioManager.playSoundEffect(AudioManager.FX_KEY_CLICK, 0.34f)
        }
    }

    override fun onKeyCandidates(candidates: List<SpatialTouchDecoder.Candidate>) {
        val prefix = if (isPasswordField()) "" else composingBuffer.value()
        val chosen = TouchLanguageRanker.choose(
            candidates = candidates,
            currentPrefix = prefix,
            languageBadge = cachedInputBadge,
            knownPrefixes = cachedKnownPrefixes
        ) ?: return
        onKey(chosen)
    }

    override fun onReplaceLastKey(text: String) {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        connection.deleteSurroundingText(1, 0)
        connection.commitText(text, 1)
        scheduleTypingIdleUpdate(text.any { it.isLetter() }, text in setOf(",", ".", "?", "!", ":", ";"))
    }

    override fun onGlide(trace: AnaKeyboardView.GlideTrace) {
        val raw = trace.sequence.lowercase().filter { it.isLetter() }
        if (raw.isBlank() || !KeyboardPrefs.glideTypingEnabled(this)) return

        flushPendingGlideFast()
        suggestionEngine.setLanguage(cachedInputBadge)
        pendingGlide = raw
        pendingGlideCapitalized = keyboard.isShifted()
        val token = ++pendingGlideToken
        mainHandler.removeCallbacks(glideFallbackRunnable)

        suggestionEngine.decodeGlideAsync(trace) { decoded ->
            mainHandler.post {
                if (token != pendingGlideToken || pendingGlide == null) return@post
                if (!decoded.isNullOrBlank()) commitGlide(decoded)
                else glideFallbackRunnable.run()
            }
        }
        mainHandler.postDelayed(glideFallbackRunnable, 360)
    }

    private fun flushPendingGlideFast() {
        val raw = pendingGlide ?: return
        mainHandler.removeCallbacks(glideFallbackRunnable)
        val fallback = CoreLexicon.decodeGlide(raw, KeyboardPrefs.inputBadge(this))
        if (!fallback.isNullOrBlank()) commitGlide(fallback) else cancelPendingGlide()
    }

    private fun cancelPendingGlide() {
        mainHandler.removeCallbacks(glideFallbackRunnable)
        pendingGlide = null
        pendingGlideCapitalized = false
        pendingGlideToken++
    }

    private fun appendComposingCharacter(connection: InputConnection, text: String) {
        if (isPasswordField()) {
            connection.commitText(text, 1)
            return
        }
        val value = composingBuffer.append(text)
        localCompositionActive = connection.setComposingText(value, 1)
    }

    private fun finishLocalComposition(connection: InputConnection): String? {
        if (composingBuffer.isEmpty) return null
        val value = composingBuffer.value()
        if (localCompositionActive) connection.finishComposingText()
        composingBuffer.clear()
        localCompositionActive = false
        return value
    }

    private fun backspaceLocalComposition(connection: InputConnection): Boolean {
        if (composingBuffer.isEmpty) return false
        val value = composingBuffer.backspace()
        if (value.isEmpty()) {
            connection.setComposingText("", 1)
            connection.finishComposingText()
            localCompositionActive = false
        } else {
            localCompositionActive = connection.setComposingText(value, 1)
        }
        scheduleTypingIdleUpdate(letter = value.isNotEmpty(), punctuation = false)
        return true
    }

    override fun onKey(code: String) {
        if (code == "CURSOR_LEFT" || code == "CURSOR_RIGHT") {
            smartSentenceToken++
            mainHandler.removeCallbacks(smartSentenceRunnable)
            moveCursor(if (code == "CURSOR_RIGHT") 1 else -1)
            return
        }
        if (pendingGlide != null) flushPendingGlideFast()
        // Any new key cancels an older sentence check/result. Space or punctuation
        // will schedule a fresh check after the key is committed.
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        if (code != "BACKSPACE" && code != "SPACE") lastAutoCorrection = null

        val connection = currentInputConnection ?: return
        when (code) {
            "SHIFT" -> handleShift()
            "SYMBOLS" -> {
                keyboard.setSymbols(true)
                clearSuggestions()
            }
            "ABC" -> {
                keyboard.setSymbols(false)
                refreshShiftFromEditor()
                requestSuggestionsSoon()
            }
            "LANGUAGE" -> showInputLanguagePicker()
            "EMOJI" -> showEmojiPanel()
            "CLIPBOARD" -> showClipboardPanel()
            "BACKSPACE" -> {
                if (undoLastSentenceCorrection()) return
                if (undoLastAutoCorrection()) return
                if (backspaceLocalComposition(connection)) return
                val selected = connection.getSelectedText(0)?.toString().orEmpty()
                if (selected.isNotEmpty()) connection.commitText("", 1)
                else connection.deleteSurroundingText(1, 0)
                refreshShiftFromEditor()
                showTypedWordCandidate()
                requestSuggestionsSoon()
            }
            "SPACE" -> handleSpace()
            "ENTER" -> {
                handleEnter()
                clearSuggestions()
            }
            else -> {
                var typed = code
                if (code.length == 1 && code[0].isLetter() && keyboard.isShifted()) typed = code.uppercase()
                val punctuation = typed in setOf(",", ".", "?", "!", ":", ";")
                val composingCharacter = typed.length == 1 &&
                    (typed[0].isLetter() || (typed == "'" && !composingBuffer.isEmpty))

                if (composingCharacter) {
                    appendComposingCharacter(connection, typed)
                } else {
                    finishLocalComposition(connection)
                    if (punctuation && cachedAutoSpacePunctuation) connection.commitText("$typed ", 1)
                    else connection.commitText(typed, 1)
                }
                if (!capsLock && keyboard.isShifted() && typed.any { it.isLetter() }) keyboard.setShifted(false)

                // Suggestions, regex scans and sentence intelligence only run
                // after a real typing idle period. The physical key path ends here.
                scheduleTypingIdleUpdate(typed.any { it.isLetter() }, punctuation)
            }
        }
    }

    private fun currentWord(): String? {
        val before = currentInputConnection?.getTextBeforeCursor(80, 0)?.toString().orEmpty()
        if (before.isBlank()) return null
        return Regex("([\\p{L}']{2,})$").find(before)?.value
    }

    private fun showTypedWordCandidate() {
        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField() || suggestionButtons.isEmpty()) return
        val word = currentWord()
        if (word.isNullOrBlank()) {
            clearSuggestions()
            return
        }
        suggestionButtons[0].text = word
        suggestionButtons[0].alpha = 1f
        for (index in 1 until suggestionButtons.size) {
            suggestionButtons[index].text = ""
            suggestionButtons[index].alpha = 0f
        }
    }

    private fun requestSuggestionsSoon() {
        mainHandler.removeCallbacks(suggestionRunnable)
        if (!cachedWordSuggestionsEnabled || isPasswordField()) {
            clearSuggestions()
            return
        }
        mainHandler.postDelayed(suggestionRunnable, 130)
    }

    private fun scheduleSmartSentenceCorrection() {
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        if (!cachedSmartSentenceEnabled || isPasswordField()) return
        mainHandler.postDelayed(smartSentenceRunnable, 950)
    }

    private fun currentParagraphCandidate(): SentenceCandidate? {
        val connection = currentInputConnection ?: return null
        // Read enough history to include the complete active paragraph, not just
        // the final sentence. This lets Ana repair an earlier missed typo when
        // later words make the intended meaning clear.
        val before = connection.getTextBeforeCursor(2600, 0)?.toString().orEmpty()
        if (before.isBlank()) return null

        val trailing = Regex("\\s*$").find(before)?.value.orEmpty()
        val content = if (trailing.isEmpty()) before else before.dropLast(trailing.length)
        if (content.length < 14) return null

        val lastLineBreak = content.lastIndexOf('\n')
        var start = if (lastLineBreak >= 0) lastLineBreak + 1 else 0
        while (start < content.length && content[start].isWhitespace()) start++
        if (start >= content.length) return null

        val paragraph = content.substring(start)
        val wordCount = Regex("[\\p{L}']+").findAll(paragraph).count()
        if (wordCount < 4 || paragraph.length < 14) return null
        val suffix = before.substring(start)
        return SentenceCandidate(paragraph, suffix, trailing)
    }

    private fun runSmartSentenceCorrection() {
        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return
        if (smartSentenceInFlight) return
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) return
        val candidate = currentParagraphCandidate() ?: return
        if (candidate.text == lastSmartSentenceChecked) return
        lastSmartSentenceChecked = candidate.text
        val connection = currentInputConnection ?: return
        val token = smartSentenceToken
        val languageHint = KeyboardPrefs.inputLanguage(this)
        showStatus("ANA AI • checking paragraph")
        smartSentenceInFlight = true

        smartSentenceExecutor.execute {
            try {
                val corrected = AnaApi.correctParagraph(baseUrl, candidate.text, languageHint).trim()
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
                    showStatus("Paragraph corrected")
                }
            } catch (_: Exception) {
                // Network/API failure must never interrupt typing, but it should
                // not fail invisibly either.
                mainHandler.post {
                    if (token == smartSentenceToken && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        showStatus("Paragraph check unavailable")
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
        showStatus("Paragraph correction undone")
        return true
    }

    private fun handleSuggestionResult(word: String, suggestions: List<String>, looksLikeTypo: Boolean) {
        val delimited = pendingDelimitedWord
        if (delimited != null && delimited.equals(word, ignoreCase = true) && looksLikeTypo) {
            val correction = suggestions.firstOrNull()
            if (!correction.isNullOrBlank() && replaceDelimitedWordNearCursor(delimited, correction)) {
                pendingDelimitedWord = null
                clearSuggestions()
                return
            }
        }

        if (isPasswordField()) return
        if (currentWord() != word || !cachedWordSuggestionsEnabled) return

        val clean = suggestions
            .filterNot { it.equals(word, ignoreCase = true) }
            .distinctBy { it.lowercase() }
            .take(2)

        lastSuggestedWord = word
        lastLooksLikeTypo = looksLikeTypo
        bestCorrection = clean.firstOrNull()

        val display = listOf(word) + clean
        suggestionButtons.forEachIndexed { index, button ->
            button.text = display.getOrNull(index).orEmpty()
            button.alpha = if (button.text.isNullOrEmpty()) 0f else 1f
        }
    }

    private fun commitGlide(value: String) {
        val raw = pendingGlide ?: value
        mainHandler.removeCallbacks(glideFallbackRunnable)
        val connection = currentInputConnection
        if (connection != null) {
            val clean = value.trim().ifBlank { raw }
            val finalWord = if (pendingGlideCapitalized) clean.replaceFirstChar { it.uppercase() } else clean.lowercase()
            connection.commitText("$finalWord ", 1)
            pendingDelimitedWord = finalWord
        }
        pendingGlide = null
        pendingGlideCapitalized = false
        pendingGlideToken++
        clearSuggestions()
        if (!capsLock) keyboard.setShifted(false)
        refreshShiftFromEditor()
        scheduleSmartSentenceCorrection()
    }

    private fun clearSuggestions() {
        suggestionButtons.forEach {
            it.text = ""
            it.alpha = 0f
        }
        lastSuggestedWord = ""
        bestCorrection = null
        lastLooksLikeTypo = false
    }

    private fun applySuggestion(suggestion: String) {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        val word = currentWord() ?: return
        vibrateSuggestionTap()

        if (suggestion.equals(word, ignoreCase = true)) {
            KeyboardPrefs.addPersonalWord(this, word)
            refreshTypingCache()
            suggestionEngine.refreshUserData()
            connection.commitText(" ", 1)
            pendingDelimitedWord = null
            clearSuggestions()
            refreshShiftFromEditor()
            showStatus("$word added to your dictionary")
            return
        }

        val replacement = adjustCase(word, suggestion)
        connection.deleteSurroundingText(word.length, 0)
        connection.commitText("$replacement ", 1)
        KeyboardPrefs.learnCorrection(this, word, suggestion)
        refreshTypingCache()
        suggestionEngine.refreshUserData()
        pendingDelimitedWord = null
        clearSuggestions()
        refreshShiftFromEditor()
    }

    private fun adjustCase(original: String, suggestion: String): String = when {
        original.all { !it.isLetter() || it.isUpperCase() } -> suggestion.uppercase()
        original.firstOrNull()?.isUpperCase() == true -> suggestion.replaceFirstChar { it.uppercase() }
        else -> suggestion.lowercase()
    }

    private fun immediateCorrection(word: String): String? {
        if (!cachedAutoCorrectionEnabled) return null
        if (word.length < 3) return null
        if (word.firstOrNull()?.isUpperCase() == true) return null

        cachedLearnedCorrections[word.lowercase()]?.let { return it }
        if (word.lowercase() in cachedPersonalWords) return null

        // Never run dictionary ranking synchronously on Space. If the current
        // suggestion result is ready, use it; otherwise the existing async
        // delimited-word path can correct just after the space is committed.
        if (lastLooksLikeTypo && lastSuggestedWord == word) {
            bestCorrection?.takeIf { !it.equals(word, ignoreCase = true) }?.let { return it }
        }
        return null
    }

    private fun handleSpace() {
        val connection = currentInputConnection ?: return
        val bufferedWord = finishLocalComposition(connection)
        if (expandTextShortcut(connection)) {
            connection.commitText(" ", 1)
            lastSpaceTap = SystemClock.elapsedRealtime()
            pendingDelimitedWord = null
            lastAutoCorrection = null
            clearSuggestions()
            refreshShiftFromEditor()
            showStatus("LOCAL • shortcut expanded")
            return
        }
        val wordBeforeSpace = bufferedWord?.takeIf { it.isNotBlank() } ?: currentWord()
        var corrected = false

        if (!wordBeforeSpace.isNullOrBlank()) {
            val correction = immediateCorrection(wordBeforeSpace)
            if (!correction.isNullOrBlank()) {
                val adjusted = adjustCase(wordBeforeSpace, correction)
                connection.deleteSurroundingText(wordBeforeSpace.length, 0)
                connection.commitText(adjusted, 1)
                lastAutoCorrection = AutoCorrectionRecord(wordBeforeSpace, adjusted)
                corrected = true
            }
        }

        val now = SystemClock.elapsedRealtime()
        val before = connection.getTextBeforeCursor(2, 0)?.toString().orEmpty()
        val canPeriod = cachedDoubleSpacePeriodEnabled && now - lastSpaceTap < 420 &&
            before.length >= 2 && before.last() == ' ' && !before[before.length - 2].isWhitespace()

        if (canPeriod) {
            connection.deleteSurroundingText(1, 0)
            connection.commitText(". ", 1)
            lastSpaceTap = 0L
            pendingDelimitedWord = null
            lastAutoCorrection = null
        } else {
            connection.commitText(" ", 1)
            lastSpaceTap = now
            if (!corrected && !wordBeforeSpace.isNullOrBlank() && cachedAutoCorrectionEnabled) {
                pendingDelimitedWord = wordBeforeSpace
                suggestionEngine.setLanguage(cachedInputBadge)
                suggestionEngine.request(wordBeforeSpace)
            } else {
                pendingDelimitedWord = null
            }
        }

        clearSuggestions()
        refreshShiftFromEditor()
        scheduleSmartSentenceCorrection()
    }

    private fun replaceDelimitedWordNearCursor(original: String, suggestion: String): Boolean {
        val connection = currentInputConnection ?: return false
        val before = connection.getTextBeforeCursor(120, 0)?.toString().orEmpty()
        val escaped = Regex.escape(original)
        val match = Regex("(?i)(^|[^\\p{L}'])($escaped) ([\\p{L}']*)$").find(before) ?: return false
        val trailing = match.groupValues[3]
        val deleteCount = original.length + 1 + trailing.length
        val adjusted = adjustCase(original, suggestion)
        connection.deleteSurroundingText(deleteCount, 0)
        connection.commitText("$adjusted $trailing", 1)
        if (trailing.isEmpty()) lastAutoCorrection = AutoCorrectionRecord(original, adjusted)
        return true
    }

    private fun undoLastAutoCorrection(): Boolean {
        val record = lastAutoCorrection ?: return false
        val connection = currentInputConnection ?: return false
        val tail = connection.getTextBeforeCursor(record.corrected.length + 1, 0)?.toString().orEmpty()
        if (tail != "${record.corrected} ") {
            lastAutoCorrection = null
            return false
        }
        connection.deleteSurroundingText(record.corrected.length + 1, 0)
        connection.commitText(record.original, 1)
        KeyboardPrefs.addPersonalWord(this, record.original)
        refreshTypingCache()
        suggestionEngine.refreshUserData()
        lastAutoCorrection = null
        pendingDelimitedWord = null
        showStatus("${record.original} learned")
        requestSuggestionsSoon()
        return true
    }

    private fun expandTextShortcut(connection: InputConnection): Boolean {
        if (isPasswordField() || shortcutCache.isEmpty()) return false
        val before = connection.getTextBeforeCursor(80, 0)?.toString().orEmpty()
        val trigger = Regex("([^\\s]{1,24})$").find(before)?.groupValues?.getOrNull(1) ?: return false
        val expansion = shortcutCache[trigger] ?: return false
        if (expansion.isBlank()) return false
        connection.deleteSurroundingText(trigger.length, 0)
        connection.commitText(expansion, 1)
        return true
    }

    private fun moveCursor(direction: Int) {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        connection.finishComposingText()
        val keyCode = if (direction > 0) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        clearSuggestions()
    }

    private fun handleShift() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastShiftTap < 330) {
            capsLock = !capsLock
            keyboard.setShifted(capsLock)
            showStatus(if (capsLock) "Caps lock" else "Caps lock off")
        } else {
            if (capsLock) capsLock = false
            keyboard.setShifted(!keyboard.isShifted())
        }
        lastShiftTap = now
    }

    private fun handleEnter() {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION) ?: EditorInfo.IME_ACTION_NONE
        if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
            connection.performEditorAction(action)
        } else {
            connection.commitText("\n", 1)
        }
        refreshShiftFromEditor()
    }

    private fun refreshShiftFromEditor() {
        if (!::keyboard.isInitialized || keyboard.isSymbols() || capsLock) return
        if (!KeyboardPrefs.autoCapitalisationEnabled(this)) {
            keyboard.setShifted(false)
            return
        }
        val connection = currentInputConnection ?: return
        val inputType = currentInputEditorInfo?.inputType ?: InputType.TYPE_CLASS_TEXT
        keyboard.setShifted(connection.getCursorCapsMode(inputType) != 0)
    }

    private fun loadBackgroundImage() {
        if (!::keyboard.isInitialized) return
        val stored = KeyboardPrefs.backgroundUri(this)
        if (stored.isBlank()) {
            keyboard.setBackgroundBitmap(null)
            return
        }
        try {
            val uri = Uri.parse(stored)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (bounds.outWidth / sample > 1400 || bounds.outHeight / sample > 1000) sample *= 2
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            keyboard.setBackgroundBitmap(bitmap)
        } catch (_: Exception) {
            keyboard.setBackgroundBitmap(null)
        }
    }

    private fun commitPendingGifIfAny() {
        val raw = KeyboardPrefs.consumePendingGifUri(this)
        if (raw.isBlank() || isPasswordField()) return
        val uri = try { Uri.parse(raw) } catch (_: Exception) { return }
        val supported = currentInputEditorInfo?.contentMimeTypes.orEmpty()
        if (supported.none { it == "image/gif" || it == "image/*" || it == "image/*;" }) {
            showStatus("This app does not accept GIFs from keyboards")
            return
        }
        val content = InputContentInfo(uri, ClipDescription("GIF", arrayOf("image/gif")), null)
        val committed = try {
            currentInputConnection?.commitContent(
                content,
                InputConnection.INPUT_CONTENT_GRANT_READ_URI_PERMISSION,
                null
            ) == true
        } catch (_: Exception) {
            false
        }
        showStatus(if (committed) "GIF inserted" else "This app could not insert the GIF")
    }

    private fun isPasswordField(): Boolean {
        val inputType = currentInputEditorInfo?.inputType ?: return false
        val klass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (klass) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun updateAiAvailability() {
        if (!::status.isInitialized) return
        val password = isPasswordField()
        aiButtons.forEach { it.isEnabled = !password }
        if (::targetButton.isInitialized) targetButton.isEnabled = !password
        voiceButton?.isEnabled = !password
        if (password) {
            status.text = "Ana AI, voice, suggestions and clipboard are disabled in password fields"
            clearSuggestions()
        } else {
            status.text = defaultStatus()
        }
    }

    private fun toggleVoiceTyping() {
        if (voiceListening) stopVoiceTyping(true) else startVoiceTyping()
    }

    private fun setVoiceListeningUi(listening: Boolean) {
        voiceButton?.setImageResource(if (listening) R.drawable.ic_stop else R.drawable.ic_mic)
        voiceButton?.contentDescription = if (listening) "Stop voice typing" else "Voice typing"
    }

    private fun startVoiceTyping() {
        if (!KeyboardPrefs.voiceTypingEnabled(this)) {
            showStatus("Voice typing is turned off in settings")
            return
        }
        if (isPasswordField()) {
            showStatus("Voice typing is disabled in password fields")
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(this, MicrophonePermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            showStatus("Allow microphone access, then tap the microphone again")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            showStatus("No Android speech recognizer is available on this device")
            return
        }

        if (speechRecognizer == null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        voiceListening = true
                        setVoiceListeningUi(true)
                        showStatus("Listening…")
                    }
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() { showStatus("Finishing dictation…") }
                    override fun onError(error: Int) {
                        currentInputConnection?.finishComposingText()
                        voiceListening = false
                        setVoiceListeningUi(false)
                        showStatus("Voice typing stopped")
                    }
                    override fun onResults(results: Bundle?) {
                        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                        if (text.isNotBlank()) currentInputConnection?.commitText("$text ", 1)
                        else currentInputConnection?.finishComposingText()
                        voiceListening = false
                        setVoiceListeningUi(false)
                        clearSuggestions()
                        refreshShiftFromEditor()
                        showStatus(if (text.isBlank()) "Nothing heard" else "Dictation inserted")
                    }
                    override fun onPartialResults(partialResults: Bundle?) {
                        val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                        if (partial.isNotBlank()) currentInputConnection?.setComposingText(partial, 1)
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })
            }
        }

        val localeTag = when (KeyboardPrefs.inputBadge(this)) {
            "DE" -> "de-DE"
            "HIN" -> "en-IN"
            else -> "en-US"
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        voiceListening = true
        setVoiceListeningUi(true)
        speechRecognizer?.startListening(intent)
        showStatus("Listening…")
    }

    private fun stopVoiceTyping(showMessage: Boolean) {
        if (!voiceListening) return
        try { speechRecognizer?.stopListening() } catch (_: Exception) { }
        voiceListening = false
        setVoiceListeningUi(false)
        if (showMessage) showStatus("Voice typing stopped")
    }

    private data class ActionText(val text: String, val selected: Boolean)

    private fun actionText(): ActionText? {
        val connection = currentInputConnection ?: return null
        val selected = connection.getSelectedText(0)?.toString().orEmpty()
        if (selected.isNotBlank()) return ActionText(selected.take(8000), true)

        val before = connection.getTextBeforeCursor(8000, 0)?.toString().orEmpty()
        if (before.isBlank()) return null
        val lineStart = before.lastIndexOf('\n') + 1
        val draft = before.substring(lineStart).takeLast(8000)
        return if (draft.isBlank()) null else ActionText(draft, false)
    }

    private fun runAnaAction(action: AnaApi.Action) {
        if (isPasswordField()) {
            showStatus("Ana AI is disabled in password fields")
            return
        }
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) {
            showStatus("Open Ana Keyboard settings and set your Ana address")
            return
        }
        val source = actionText()
        if (source == null) {
            val message = when (action) {
                AnaApi.Action.WRITE -> "Type or dictate what you want to write, then tap Write"
                AnaApi.Action.FIX -> "Type or select the message you want Ana to correct"
                else -> "Type or select some text first"
            }
            showStatus(message)
            return
        }

        val connection = currentInputConnection ?: return
        val target = KeyboardPrefs.target(this)
        setAiBusy(true)
        val busyMessage = when (action) {
            AnaApi.Action.WRITE -> "ANA AI • writing in $target…"
            AnaApi.Action.FIX -> "ANA AI • correcting to $target…"
            AnaApi.Action.TRANSLATE -> "ANA AI • translating to $target…"
            else -> "ANA AI • working…"
        }
        showStatus(busyMessage)

        executor.execute {
            try {
                val result = AnaApi.transform(baseUrl, source.text, action, target)
                mainHandler.post {
                    if (currentInputConnection !== connection) {
                        setAiBusy(false)
                        showStatus("Text field changed — result was not inserted")
                        return@post
                    }
                    val stillMatches = if (source.selected) {
                        connection.getSelectedText(0)?.toString() == source.text
                    } else {
                        connection.getTextBeforeCursor(source.text.length, 0)?.toString() == source.text
                    }
                    if (!stillMatches) {
                        setAiBusy(false)
                        showStatus("Draft changed — Ana left it untouched")
                        return@post
                    }

                    if (source.selected) connection.commitText(result, 1)
                    else {
                        connection.deleteSurroundingText(source.text.length, 0)
                        connection.commitText(result, 1)
                    }
                    setAiBusy(false)
                    showStatus("Done")
                    clearSuggestions()
                    refreshShiftFromEditor()
                }
            } catch (error: Exception) {
                mainHandler.post {
                    setAiBusy(false)
                    showStatus(error.message ?: "Ana request failed")
                }
            }
        }
    }

    private fun setAiBusy(busy: Boolean) {
        aiButtons.forEach { it.isEnabled = !busy }
        if (::targetButton.isInitialized) targetButton.isEnabled = !busy
    }

    private fun defaultStatus(): String = "LOCAL • typing stays on device"

    private fun showStatus(message: String) {
        if (!::status.isInitialized) return
        status.text = message
        mainHandler.removeCallbacksAndMessages(STATUS_TOKEN)
        mainHandler.postAtTime({
            if (!isPasswordField() && !voiceListening) status.text = defaultStatus()
        }, STATUS_TOKEN, SystemClock.uptimeMillis() + 2600)
    }

    override fun onDestroy() {
        cancelPendingGlide()
        stopVoiceTyping(false)
        speechRecognizer?.destroy()
        speechRecognizer = null
        suggestionEngine.close()
        executor.shutdownNow()
        smartSentenceExecutor.shutdownNow()
        feedbackExecutor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private val STATUS_TOKEN = Any()
    }
}
