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

    private var speechRecognizer: SpeechRecognizer? = null
    private var voiceListening = false

    private data class AutoCorrectionRecord(val original: String, val corrected: String)

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
        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField()) {
            clearSuggestions()
            return@Runnable
        }
        val word = currentWord()
        if (word.isNullOrBlank()) {
            clearSuggestions()
            return@Runnable
        }
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
        suggestionEngine.request(word)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate() {
        super.onCreate()
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
                    currentInputConnection?.commitText(emoji, 1)
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
                    currentInputConnection?.commitText(text, 1)
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
                    suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this@AnaKeyboardService))
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
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
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
        stopVoiceTyping(false)
        if (::keyboard.isInitialized) {
            showLetterKeyboard()
            keyboard.refreshPreferences()
            loadBackgroundImage()
            if (::targetButton.isInitialized) targetButton.text = "→ ${KeyboardPrefs.targetBadge(this)}"
            suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
            suggestionEngine.refreshUserData()
            requestSuggestionsSoon()
            mainHandler.postDelayed({ commitPendingGifIfAny() }, 120)
        }
    }

    override fun onWindowShown() {
        super.onWindowShown()
        mainHandler.postDelayed({ commitPendingGifIfAny() }, 120)
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
        if (KeyboardPrefs.hapticEnabled(this)) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(
                    KeyboardPrefs.hapticStrengthMs(this).toLong(),
                    VibrationEffect.DEFAULT_AMPLITUDE
                )
            )
        }
        if (KeyboardPrefs.soundEnabled(this)) audioManager.playSoundEffect(AudioManager.FX_KEY_CLICK, 0.34f)
    }

    override fun onGlide(trace: AnaKeyboardView.GlideTrace) {
        val raw = trace.sequence.lowercase().filter { it.isLetter() }
        if (raw.isBlank() || !KeyboardPrefs.glideTypingEnabled(this)) return

        flushPendingGlideFast()
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
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

    override fun onKey(code: String) {
        if (pendingGlide != null) flushPendingGlideFast()
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
                if (undoLastAutoCorrection()) return
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
                if (punctuation && KeyboardPrefs.autoSpaceAfterPunctuation(this)) connection.commitText("$typed ", 1)
                else connection.commitText(typed, 1)
                if (!capsLock && keyboard.isShifted() && typed.any { it.isLetter() }) keyboard.setShifted(false)
                if (typed.any { it.isLetter() }) {
                    showTypedWordCandidate()
                    requestSuggestionsSoon()
                } else clearSuggestions()
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
        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField()) {
            clearSuggestions()
            return
        }
        mainHandler.postDelayed(suggestionRunnable, 130)
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
        if (currentWord() != word || !KeyboardPrefs.wordSuggestionsEnabled(this)) return

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
        val word = currentWord() ?: return
        vibrateSuggestionTap()

        if (suggestion.equals(word, ignoreCase = true)) {
            KeyboardPrefs.addPersonalWord(this, word)
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
        if (!KeyboardPrefs.autoCorrectionEnabled(this)) return null
        if (word.length < 3) return null
        if (word.firstOrNull()?.isUpperCase() == true) return null

        KeyboardPrefs.learnedCorrections(this)[word.lowercase()]?.let { return it }
        if (KeyboardPrefs.personalDictionary(this).any { it.equals(word, ignoreCase = true) }) return null

        if (lastLooksLikeTypo && lastSuggestedWord == word) {
            bestCorrection?.takeIf { !it.equals(word, ignoreCase = true) }?.let { return it }
        }

        val fast = suggestionEngine.fastResult(word)
        if (fast.highConfidenceTypo) {
            return fast.suggestions.firstOrNull()?.takeIf { !it.equals(word, ignoreCase = true) }
        }
        return null
    }

    private fun handleSpace() {
        val connection = currentInputConnection ?: return
        val wordBeforeSpace = currentWord()
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
        val canPeriod = KeyboardPrefs.doubleSpacePeriodEnabled(this) && now - lastSpaceTap < 420 &&
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
            if (!corrected && !wordBeforeSpace.isNullOrBlank() && KeyboardPrefs.autoCorrectionEnabled(this)) {
                pendingDelimitedWord = wordBeforeSpace
                suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
                suggestionEngine.request(wordBeforeSpace)
            } else {
                pendingDelimitedWord = null
            }
        }

        clearSuggestions()
        refreshShiftFromEditor()
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
        suggestionEngine.refreshUserData()
        lastAutoCorrection = null
        pendingDelimitedWord = null
        showStatus("${record.original} learned")
        requestSuggestionsSoon()
        return true
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
            AnaApi.Action.WRITE -> "Ana is writing in $target…"
            AnaApi.Action.FIX -> "Ana is correcting to $target…"
            AnaApi.Action.TRANSLATE -> "Ana is translating to $target…"
            else -> "Ana is working…"
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

    private fun defaultStatus(): String = "Ana • typing, correction and glide stay local"

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
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private val STATUS_TOKEN = Any()
    }
}
