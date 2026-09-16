package com.ana.keyboard

import android.content.ClipboardManager
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.inputmethodservice.InputMethodService
import java.util.concurrent.Executors

class AnaKeyboardService : InputMethodService(), AnaKeyboardView.Listener {
    private lateinit var keyboard: AnaKeyboardView
    private lateinit var emojiPanel: EmojiPanelView
    private lateinit var clipboardPanel: ClipboardPanelView
    private lateinit var contentHost: FrameLayout
    private lateinit var status: TextView
    private lateinit var targetButton: Button
    private lateinit var suggestionStrip: LinearLayout
    private lateinit var suggestionEngine: LocalSuggestionEngine
    private var inputLanguageButton: Button? = null
    private val aiButtons = mutableListOf<Button>()
    private val suggestionButtons = mutableListOf<TextView>()
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var capsLock = false
    private var lastShiftTap = 0L
    private var lastSpaceTap = 0L
    private var lastSuggestedWord = ""
    private var bestCorrection: String? = null
    private var lastLooksLikeTypo = false

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

            inputLanguageButton = actionButton(KeyboardPrefs.inputBadge(this)) {
                KeyboardPrefs.cycleInputLanguage(this)
                inputLanguageButton?.text = KeyboardPrefs.inputBadge(this)
                keyboard.refreshPreferences()
                suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
                requestSuggestionsSoon()
                showStatus("Typing: ${KeyboardPrefs.inputLanguage(this)}")
            }.also { toolbar.addView(it) }

            targetButton = actionButton("→ ${KeyboardPrefs.targetBadge(this)}") {
                KeyboardPrefs.cycleTarget(this)
                targetButton.text = "→ ${KeyboardPrefs.targetBadge(this)}"
                showStatus("Translate target: ${KeyboardPrefs.target(this)}")
            }.also { toolbar.addView(it) }

            toolbar.addView(actionButton("📋") { showClipboardPanel() })
            toolbar.addView(actionButton("Translate") { runAnaAction(AnaApi.Action.TRANSLATE) }.also { aiButtons += it })
            toolbar.addView(actionButton("Fix") { runAnaAction(AnaApi.Action.FIX) }.also { aiButtons += it })
            toolbar.addView(actionButton("Tone") { runAnaAction(AnaApi.Action.TONE) }.also { aiButtons += it })
            toolbar.addView(actionButton("Shorter") { runAnaAction(AnaApi.Action.SHORTER) }.also { aiButtons += it })
            toolbarScroll.addView(toolbar)
            root.addView(toolbarScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))
        } else {
            targetButton = Button(this).apply { visibility = View.GONE }
        }

        suggestionStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(2), dp(4), dp(2))
            setBackgroundColor(Color.argb(238, 31, 31, 31))
        }
        repeat(3) {
            val cell = TextView(this).apply {
                textSize = 15f
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
        root.addView(suggestionStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)))

        status = TextView(this).apply {
            text = "Ana • suggestions stay local"
            textSize = 11f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            setBackgroundColor(Color.argb(225, 35, 35, 35))
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)))

        contentHost = FrameLayout(this)
        keyboard = AnaKeyboardView(this).apply {
            listener = this@AnaKeyboardService
        }
        emojiPanel = EmojiPanelView(this).apply {
            visibility = View.GONE
            listener = object : EmojiPanelView.Listener {
                override fun onEmoji(emoji: String) {
                    currentInputConnection?.commitText(emoji, 1)
                    clearSuggestions()
                }

                override fun onGifRequested() {
                    showStatus("GIF search needs an online GIF provider — not enabled yet")
                }

                override fun onBackToLetters() {
                    showLetterKeyboard()
                }
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

                override fun onBackToLetters() {
                    showLetterKeyboard()
                }

                override fun onClearHistory() {
                    KeyboardPrefs.clearClipboardHistory(this@AnaKeyboardService)
                    refreshClipboardPanel()
                    showStatus("Clipboard history cleared")
                }
            }
        }
        contentHost.addView(keyboard, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(emojiPanel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        contentHost.addView(clipboardPanel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(contentHost, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300)))

        // Blank safety row keeps the lowest keys above the system navigation edge.
        root.addView(View(this).apply {
            setBackgroundColor(keyboardShellColor())
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)))

        loadBackgroundImage()
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
        clearSuggestions()
        updateAiAvailability()
        return root
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        if (::keyboard.isInitialized) {
            showLetterKeyboard()
            keyboard.refreshPreferences()
            loadBackgroundImage()
            inputLanguageButton?.text = KeyboardPrefs.inputBadge(this)
            if (::targetButton.isInitialized) targetButton.text = "→ ${KeyboardPrefs.targetBadge(this)}"
            suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))
            requestSuggestionsSoon()
        }
    }

    private fun showEmojiPanel() {
        if (!::emojiPanel.isInitialized) return
        keyboard.visibility = View.GONE
        clipboardPanel.visibility = View.GONE
        emojiPanel.visibility = View.VISIBLE
        showStatus("Smileys")
    }

    private fun showClipboardPanel() {
        if (!::clipboardPanel.isInitialized) return
        if (isPasswordField()) {
            showStatus("Clipboard is hidden in password fields")
            return
        }
        refreshClipboardPanel()
        keyboard.visibility = View.GONE
        emojiPanel.visibility = View.GONE
        clipboardPanel.visibility = View.VISIBLE
        showStatus("Clipboard")
    }

    private fun refreshClipboardPanel() {
        if (!::clipboardPanel.isInitialized || isPasswordField()) return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val primary = clipboard.primaryClip
        if (primary != null && primary.itemCount > 0) {
            val text = primary.getItemAt(0).coerceToText(this)?.toString()?.trim().orEmpty()
            if (text.isNotBlank()) KeyboardPrefs.rememberClipboard(this, text)
        }
        clipboardPanel.setItems(KeyboardPrefs.clipboardHistory(this))
    }

    private fun showLetterKeyboard() {
        if (!::emojiPanel.isInitialized || !::keyboard.isInitialized || !::clipboardPanel.isInitialized) return
        emojiPanel.visibility = View.GONE
        clipboardPanel.visibility = View.GONE
        keyboard.visibility = View.VISIBLE
        requestSuggestionsSoon()
    }

    private fun keyboardShellColor(): Int = when (KeyboardPrefs.theme(this)) {
        "light" -> Color.rgb(225, 228, 232)
        "midnight" -> Color.BLACK
        "gold" -> Color.rgb(17, 17, 17)
        else -> Color.rgb(26, 26, 26)
    }

    private fun actionButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(Color.WHITE)
        backgroundTintList = ColorStateList.valueOf(if (KeyboardPrefs.theme(this@AnaKeyboardService) == "gold") Color.rgb(85, 71, 38) else Color.rgb(55, 55, 55))
        minWidth = 0
        minimumWidth = 0
        setPadding(dp(13), 0, dp(13), 0)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)).apply {
            marginEnd = dp(5)
        }
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        capsLock = false
        lastSpaceTap = 0L
        clearSuggestions()
        if (::keyboard.isInitialized) {
            keyboard.setSymbols(false)
            refreshShiftFromEditor()
            updateAiAvailability()
        }
    }

    override fun onPressFeedback(view: View) {
        if (KeyboardPrefs.hapticEnabled(this)) {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createOneShot(KeyboardPrefs.hapticStrengthMs(this).toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
        }
        if (KeyboardPrefs.soundEnabled(this)) {
            (getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                .playSoundEffect(AudioManager.FX_KEY_CLICK, 0.45f)
        }
    }

    override fun onKey(code: String) {
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
            "EMOJI" -> showEmojiPanel()
            "CLIPBOARD" -> showClipboardPanel()
            "BACKSPACE" -> {
                val selected = connection.getSelectedText(0)?.toString().orEmpty()
                if (selected.isNotEmpty()) connection.commitText("", 1)
                else connection.deleteSurroundingText(1, 0)
                refreshShiftFromEditor()
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
                if (typed.any { it.isLetter() }) requestSuggestionsSoon() else clearSuggestions()
            }
        }
    }

    private fun currentWord(): String? {
        val before = currentInputConnection?.getTextBeforeCursor(80, 0)?.toString().orEmpty()
        if (before.isBlank()) return null
        return Regex("([\\p{L}']{2,})$").find(before)?.value
    }

    private fun requestSuggestionsSoon() {
        mainHandler.removeCallbacks(suggestionRunnable)
        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField()) {
            clearSuggestions()
            return
        }
        mainHandler.postDelayed(suggestionRunnable, 110)
    }

    private fun handleSuggestionResult(word: String, suggestions: List<String>, looksLikeTypo: Boolean) {
        if (!::suggestionStrip.isInitialized || isPasswordField()) return
        if (currentWord() != word || !KeyboardPrefs.wordSuggestionsEnabled(this)) return
        val clean = suggestions
            .filterNot { it.equals(word, ignoreCase = true) }
            .distinctBy { it.lowercase() }
            .take(3)
        lastSuggestedWord = word
        lastLooksLikeTypo = looksLikeTypo
        bestCorrection = clean.firstOrNull()
        suggestionButtons.forEachIndexed { index, button ->
            button.text = clean.getOrNull(index).orEmpty()
            button.alpha = if (button.text.isNullOrEmpty()) 0f else 1f
        }
    }

    private fun clearSuggestions() {
        if (::suggestionButtons.isInitialized) {
            suggestionButtons.forEach { it.text = ""; it.alpha = 0f }
        }
        lastSuggestedWord = ""
        bestCorrection = null
        lastLooksLikeTypo = false
    }

    private fun applySuggestion(suggestion: String) {
        val connection = currentInputConnection ?: return
        val word = currentWord() ?: return
        val replacement = adjustCase(word, suggestion)
        connection.deleteSurroundingText(word.length, 0)
        connection.commitText(replacement, 1)
        clearSuggestions()
        refreshShiftFromEditor()
    }

    private fun adjustCase(original: String, suggestion: String): String {
        return when {
            original.all { !it.isLetter() || it.isUpperCase() } -> suggestion.uppercase()
            original.firstOrNull()?.isUpperCase() == true -> suggestion.replaceFirstChar { it.uppercase() }
            else -> suggestion.lowercase()
        }
    }

    private fun maybeAutoCorrectCurrentWord() {
        if (!KeyboardPrefs.autoCorrectionEnabled(this)) return
        val connection = currentInputConnection ?: return
        val word = currentWord() ?: return
        val correction = bestCorrection ?: return
        if (!lastLooksLikeTypo || word != lastSuggestedWord || correction.equals(word, ignoreCase = true)) return
        val replacement = adjustCase(word, correction)
        connection.deleteSurroundingText(word.length, 0)
        connection.commitText(replacement, 1)
        clearSuggestions()
    }

    private fun handleSpace() {
        val connection = currentInputConnection ?: return
        maybeAutoCorrectCurrentWord()
        val now = SystemClock.elapsedRealtime()
        val before = connection.getTextBeforeCursor(2, 0)?.toString().orEmpty()
        val canPeriod = KeyboardPrefs.doubleSpacePeriodEnabled(this) && now - lastSpaceTap < 420 &&
            before.length >= 2 && before.last() == ' ' && !before[before.length - 2].isWhitespace()
        if (canPeriod) {
            connection.deleteSurroundingText(1, 0)
            connection.commitText(". ", 1)
            lastSpaceTap = 0L
        } else {
            connection.commitText(" ", 1)
            lastSpaceTap = now
        }
        clearSuggestions()
        refreshShiftFromEditor()
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
            while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1200) sample *= 2
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            keyboard.setBackgroundBitmap(bitmap)
        } catch (_: Exception) {
            keyboard.setBackgroundBitmap(null)
        }
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
        if (password) {
            status.text = "Ana AI, suggestions and clipboard are disabled in password fields"
            clearSuggestions()
        } else status.text = "Ana • suggestions stay local"
    }

    private data class ActionText(val text: String, val selected: Boolean)

    private fun actionText(): ActionText? {
        val connection = currentInputConnection ?: return null
        val selected = connection.getSelectedText(0)?.toString().orEmpty()
        if (selected.isNotBlank()) return ActionText(selected.take(2500), true)

        val before = connection.getTextBeforeCursor(2500, 0)?.toString().orEmpty()
        if (before.isBlank()) return null
        val lineStart = before.lastIndexOf('\n') + 1
        val draft = before.substring(lineStart).takeLast(2500)
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
            showStatus("Type or select some text first")
            return
        }
        val connection = currentInputConnection ?: return
        val target = KeyboardPrefs.target(this)
        setAiBusy(true)
        showStatus("Ana is working…")

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

    private fun showStatus(message: String) {
        if (!::status.isInitialized) return
        status.text = message
        mainHandler.removeCallbacksAndMessages(STATUS_TOKEN)
        mainHandler.postAtTime({
            if (!isPasswordField()) status.text = "Ana • suggestions stay local"
        }, STATUS_TOKEN, SystemClock.uptimeMillis() + 2800)
    }

    override fun onDestroy() {
        suggestionEngine.close()
        executor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private val STATUS_TOKEN = Any()
    }
}
