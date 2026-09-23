package com.ana.keyboard

import android.Manifest
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Build
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
import android.widget.ScrollView
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
    private lateinit var bottomSpacer: View
    private lateinit var status: TextView
    private lateinit var targetButton: Button
    private lateinit var suggestionEngine: LocalSuggestionEngine
    private lateinit var correctionPreview: LinearLayout
    private lateinit var correctionPreviewText: TextView

    private var voiceButton: ImageButton? = null
    private var appAiButton: Button? = null
    private val aiButtons = mutableListOf<Button>()
    private val suggestionButtons = mutableListOf<TextView>()
    private val suggestionEntries = MutableList<SuggestionEntry?>(3) { null }

    private val executor = Executors.newSingleThreadExecutor()
    private val smartSentenceExecutor = Executors.newSingleThreadExecutor()
    private val feedbackExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val vibrator by lazy { getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val clipboardManager by lazy { getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager }
    private var quickClipboardText = ""
    private val clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
        if (!isInputViewShown || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this)) return@OnPrimaryClipChangedListener
        mainHandler.post {
            refreshQuickClipboard()
            requestSuggestionsSoon()
        }
    }

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
    private var pendingSentenceProposal: SentenceProposal? = null
    private var smartSentenceToken = 0
    private var lastSmartSentenceChecked = ""
    @Volatile private var smartSentenceInFlight = false
    @Volatile private var explicitAiActionInFlight = false
    private var shortcutCache: Map<String, String> = emptyMap()

    // Cached once per input session so physical key taps never need to query
    // SharedPreferences or rebuild dictionaries on the hot path.
    private var cachedWordSuggestionsEnabled = true
    private var cachedSmartSentenceEnabled = false
    private var cachedAutoCorrectionEnabled = true
    private var cachedDoubleSpacePeriodEnabled = true
    private var cachedAutoSpacePunctuation = true
    private var cachedAutoSpaceSuggestion = true
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
    private var voiceFinalizing = false
    private var voiceStopRequested = false
    private var voiceResultHandled = false
    private var lastVoicePartial = ""
    private var voiceRecognizerOnDevice = false
    private var onDeviceVoiceFailedThisSession = false
    private var voiceSessionId = 0L
    private enum class VoiceMode { DICTATE, EDIT_COMMAND }
    private var voiceMode = VoiceMode.DICTATE
    private var voiceEditSource: ActionText? = null
    private val voiceFinalizeTimeout = Runnable {
        if (!voiceFinalizing || voiceResultHandled) return@Runnable
        try { speechRecognizer?.cancel() } catch (_: Exception) {}
        completeVoiceRecognition("", fromTimeout = true)
    }

    private enum class SuggestionKind { WORD, NEXT_WORD, EMOJI, CLIPBOARD }
    private data class SuggestionEntry(val label: String, val value: String, val kind: SuggestionKind)

    private data class AutoCorrectionRecord(val original: String, val corrected: String)
    private data class SentenceCorrectionRecord(val original: String, val corrected: String, val trailing: String)
    private data class SentenceCandidate(val text: String, val suffix: String, val trailing: String)
    private data class SentenceProposal(
        val original: String,
        val corrected: String,
        val suffix: String,
        val trailing: String,
        val connection: InputConnection
    )

    private val smartSentenceRunnable = Runnable { runSmartSentenceCorrection() }

    private val typingIdleRunnable = Runnable {
        val sawLetter = typingIdleSawLetter
        val sawPunctuation = typingIdleSawPunctuation
        typingIdleSawLetter = false
        typingIdleSawPunctuation = false

        if (cachedWordSuggestionsEnabled && !isSensitiveField()) {
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
        if (!cachedWordSuggestionsEnabled || isSensitiveField()) {
            clearSuggestions()
            return@Runnable
        }
        val word = currentWord()
        suggestionEngine.setLanguage(cachedInputBadge)
        if (!word.isNullOrBlank()) {
            suggestionEngine.request(word)
            return@Runnable
        }
        val previous = lastCompletedWord()
        if (!previous.isNullOrBlank()) suggestionEngine.requestNext(previous)
        else showEntries(listOfNotNull(clipboardQuickEntry()))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun refreshTypingCache() {
        cachedWordSuggestionsEnabled = KeyboardPrefs.wordSuggestionsEnabled(this)
        cachedSmartSentenceEnabled = KeyboardPrefs.smartSentenceCorrectionEnabled(this)
        cachedAutoCorrectionEnabled = KeyboardPrefs.autoCorrectionEnabled(this)
        cachedDoubleSpacePeriodEnabled = KeyboardPrefs.doubleSpacePeriodEnabled(this)
        cachedAutoSpacePunctuation = KeyboardPrefs.autoSpaceAfterPunctuation(this)
        cachedAutoSpaceSuggestion = KeyboardPrefs.autoSpaceAfterSuggestion(this)
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
        suggestionEngine = LocalSuggestionEngine(
            this,
            onResult = { word, suggestions, typo -> mainHandler.post { handleSuggestionResult(word, suggestions, typo) } },
            onNextResult = { previous, suggestions -> mainHandler.post { handleNextWordResult(previous, suggestions) } }
        )
        try { clipboardManager.addPrimaryClipChangedListener(clipboardListener) } catch (_: Exception) {}
    }

    override fun onCreateInputView(): View {
        aiButtons.clear()
        suggestionButtons.clear()
        voiceButton = null
        appAiButton = null

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

            fun show(id: String) = KeyboardPrefs.toolbarActionEnabled(this@AnaKeyboardService, id)
            fun addAi(id: String, label: String, action: AnaApi.Action) {
                if (!show(id)) return
                toolbar.addView(actionButton(label) { runAnaAction(action) }.also { aiButtons += it })
            }

            targetButton = actionButton("→ ${KeyboardPrefs.targetBadge(this)}") { showTranslationPicker() }
                .also { toolbar.addView(it) }
            addAi("translate", "Translate", AnaApi.Action.TRANSLATE)
            addAi("write", "Write", AnaApi.Action.WRITE)
            addAi("correct", "Correct", AnaApi.Action.FIX)
            addAi("shorter", "Shorter", AnaApi.Action.SHORTER)
            addAi("friendly", "Friendly", AnaApi.Action.FRIENDLY)
            addAi("formal", "Formal", AnaApi.Action.FORMAL)
            addAi("du", "Du", AnaApi.Action.DU)
            addAi("sie", "Sie", AnaApi.Action.SIE)
            if (show("clipboard")) toolbar.addView(iconButton(R.drawable.ic_clipboard, "Clipboard") { showClipboardPanel() })
            if (show("undo")) toolbar.addView(actionButton("Undo") { performUndo() })
            if (show("redo")) toolbar.addView(actionButton("Redo") { sendEditorShortcut(KeyEvent.KEYCODE_Z, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON) })
            if (show("select_all")) toolbar.addView(actionButton("Select all") { performSelectAll() })
            if (show("app_ai")) {
                appAiButton = actionButton(if (isAppAiAllowed()) "AI app ✓" else "AI app off") { toggleCurrentAppAi() }
                    .also { toolbar.addView(it) }
            }
            if (show("private")) {
                toolbar.addView(actionButton(if (KeyboardPrefs.incognitoEnabled(this)) "Private ✓" else "Private") {
                    val enabled = KeyboardPrefs.toggleIncognito(this)
                    if (enabled) {
                        stopVoiceTyping(false)
                        clearSuggestions()
                        hidePanels()
                        keyboard.visibility = View.VISIBLE
                    }
                    updateAiAvailability()
                    showStatus(if (enabled) "INCOGNITO • learning, clipboard history and Ana AI are off" else defaultStatus())
                    requestSuggestionsSoon()
                })
            }
            if (KeyboardPrefs.voiceTypingEnabled(this)) {
                if (show("voice_edit")) toolbar.addView(actionButton("Voice edit") { startVoiceEditCommand() }.also { aiButtons += it })
                if (show("voice")) {
                    voiceButton = iconButton(R.drawable.ic_mic, "Voice typing") { toggleVoiceTyping() }
                        .also { toolbar.addView(it) }
                }
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
            repeat(3) { index ->
                val cell = TextView(this).apply {
                    textSize = 16f
                    setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER
                    maxLines = 1
                    setPadding(dp(5), 0, dp(5), 0)
                    contentDescription = "Suggestion ${index + 1}"
                    setOnClickListener { applySuggestionEntry(index) }
                }
                suggestionButtons += cell
                suggestionStrip.addView(cell, LinearLayout.LayoutParams(0, dp(38), 1f))
            }
            root.addView(suggestionStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        }

        correctionPreviewText = TextView(this).apply {
            textSize = 11f
            setTextColor(Color.WHITE)
            maxLines = Int.MAX_VALUE
            gravity = Gravity.TOP
            setPadding(dp(10), dp(7), dp(8), dp(9))
        }
        val correctionTextScroller = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            addView(correctionPreviewText, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ))
        }
        correctionPreview = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(3), dp(4), dp(3))
            setBackgroundColor(Color.argb(245, 43, 43, 43))
            visibility = View.GONE
            addView(correctionTextScroller, LinearLayout.LayoutParams(0, dp(112), 1f))
            addView(Button(this@AnaKeyboardService).apply {
                text = "Reject"
                isAllCaps = false
                textSize = 11f
                minWidth = 0
                minimumWidth = 0
                setTextColor(Color.WHITE)
                backgroundTintList = ColorStateList.valueOf(Color.rgb(72, 72, 72))
                setOnClickListener { rejectSentenceProposal() }
            }, LinearLayout.LayoutParams(dp(72), dp(48)).apply { marginEnd = dp(5) })
            addView(Button(this@AnaKeyboardService).apply {
                text = "Accept"
                isAllCaps = false
                textSize = 11f
                minWidth = 0
                minimumWidth = 0
                setTextColor(Color.BLACK)
                backgroundTintList = ColorStateList.valueOf(Color.rgb(230, 181, 65))
                setOnClickListener { applySentenceProposal() }
            }, LinearLayout.LayoutParams(dp(72), dp(48)))
        }
        root.addView(correctionPreview, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(118)))

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
                    showStatus("Unpinned clipboard history cleared")
                }

                override fun onTogglePin(text: String) {
                    KeyboardPrefs.toggleClipboardPin(this@AnaKeyboardService, text)
                    refreshClipboardPanel()
                }

                override fun onDelete(text: String) {
                    KeyboardPrefs.deleteClipboardItem(this@AnaKeyboardService, text)
                    refreshClipboardPanel()
                    showStatus("Clipboard item deleted")
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

        bottomSpacer = View(this).apply { setBackgroundColor(keyboardShellColor()) }
        root.addView(
            bottomSpacer,
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
        pendingSentenceProposal = null
        if (::correctionPreview.isInitialized) correctionPreview.visibility = View.GONE
        lastSmartSentenceChecked = ""
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        cancelPendingGlide()
        clearSuggestions()
        if (::keyboard.isInitialized) {
            keyboard.setSymbols(false)
            updateEnterKeyForEditor(attribute)
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
            applyKeyboardSizing()
            keyboard.refreshPreferences()
            updateEnterKeyForEditor(info)
            loadBackgroundImage()
            if (::targetButton.isInitialized) targetButton.text = "→ ${KeyboardPrefs.targetBadge(this)}"
            suggestionEngine.setLanguage(cachedInputBadge)
            suggestionEngine.refreshUserData()
            shortcutCache = KeyboardPrefs.textShortcuts(this)
            refreshQuickClipboard()
            if (appAiButton != null) appAiButton?.text = if (isAppAiAllowed()) "AI app ✓" else "AI app off"
            updateAiAvailability()
            requestSuggestionsSoon()
            mainHandler.postDelayed({ commitPendingGifIfAny() }, 120)
        }
    }

    private fun applyKeyboardSizing() {
        if (::contentHost.isInitialized) {
            contentHost.layoutParams = (contentHost.layoutParams ?: LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(KeyboardSizing.keyboardHeightDp(this))
            )).apply {
                width = ViewGroup.LayoutParams.MATCH_PARENT
                height = dp(KeyboardSizing.keyboardHeightDp(this@AnaKeyboardService))
            }
        }
        if (::bottomSpacer.isInitialized) {
            bottomSpacer.layoutParams = (bottomSpacer.layoutParams ?: LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(KeyboardSizing.bottomSpacerDp(this))
            )).apply {
                width = ViewGroup.LayoutParams.MATCH_PARENT
                height = dp(KeyboardSizing.bottomSpacerDp(this@AnaKeyboardService))
            }
        }
        if (::keyboard.isInitialized) {
            keyboard.requestLayout()
            keyboard.invalidate()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::keyboard.isInitialized) {
            applyKeyboardSizing()
            keyboard.refreshPreferences()
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
        if (isSensitiveField()) {
            showStatus("Clipboard is hidden in private fields")
            return
        }
        if (KeyboardPrefs.incognitoEnabled(this)) {
            showStatus("Clipboard history is paused in Incognito mode")
            return
        }
        stopVoiceTyping(false)
        refreshClipboardPanel()
        hidePanels()
        clipboardPanel.visibility = View.VISIBLE
        showStatus("Clipboard")
    }

    private fun showTranslationPicker() {
        if (isSensitiveField()) return
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
        if (isSensitiveField()) return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val primary = clipboard.primaryClip
        if (primary != null && primary.itemCount > 0) {
            val text = primary.getItemAt(0).coerceToText(this)?.toString()?.trim().orEmpty()
            if (text.isNotBlank()) KeyboardPrefs.rememberClipboard(this, text)
        }
        clipboardPanel.setItems(KeyboardPrefs.clipboardItems(this))
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
        val prefix = if (isSensitiveField()) "" else composingBuffer.value()
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
        if (isSensitiveField()) {
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
        if (pendingSentenceProposal != null) dismissSentenceProposal(markChecked = false)
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
            "SYMBOL_PAGE" -> {
                keyboard.toggleSymbolPage()
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
        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isSensitiveField() || suggestionButtons.isEmpty()) return
        val word = currentWord()
        if (word.isNullOrBlank()) {
            clearSuggestions()
            return
        }
        showEntries(listOf(SuggestionEntry(word, word, SuggestionKind.WORD)))
    }

    private fun lastCompletedWord(): String? {
        val before = currentInputConnection?.getTextBeforeCursor(180, 0)?.toString().orEmpty()
        if (before.isBlank()) return null
        return Regex("([\\p{L}']{2,})[\\s.,!?;:]+$").find(before)?.groupValues?.getOrNull(1)
    }

    private fun recentWordsBeforeCursor(): List<String> {
        val before = currentInputConnection?.getTextBeforeCursor(220, 0)?.toString().orEmpty()
        return Regex("[\\p{L}']{2,}").findAll(before).map { it.value }.toList().takeLast(2)
    }

    private fun learnTransitionFromContext() {
        val words = recentWordsBeforeCursor()
        if (words.size == 2) suggestionEngine.learnTransition(words[0], words[1])
    }

    private fun refreshQuickClipboard() {
        if (isSensitiveField() || KeyboardPrefs.incognitoEnabled(this)) {
            quickClipboardText = ""
            return
        }
        try {
            val clip = clipboardManager.primaryClip
            quickClipboardText = if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).coerceToText(this)?.toString()?.trim()?.take(800).orEmpty()
            } else ""
        } catch (_: Exception) { quickClipboardText = "" }
    }

    private fun clipboardQuickEntry(): SuggestionEntry? {
        val value = quickClipboardText.trim()
        if (value.isBlank() || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this)) return null
        val label = "📋 " + value.replace('\n', ' ').replace(Regex("\\s+"), " ").take(22)
        return SuggestionEntry(label, value, SuggestionKind.CLIPBOARD)
    }

    private fun requestSuggestionsSoon() {
        mainHandler.removeCallbacks(suggestionRunnable)
        if (!cachedWordSuggestionsEnabled || isSensitiveField()) {
            clearSuggestions()
            return
        }
        mainHandler.postDelayed(suggestionRunnable, 130)
    }

    private fun scheduleSmartSentenceCorrection() {
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        if (explicitAiActionInFlight || !cachedSmartSentenceEnabled || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this) || !isAppAiAllowed()) return
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
        if (explicitAiActionInFlight || !KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this) || !isAppAiAllowed()) return
        if (smartSentenceInFlight || pendingSentenceProposal != null) return
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) return
        val candidate = currentParagraphCandidate() ?: return
        if (candidate.text == lastSmartSentenceChecked) return
        val connection = currentInputConnection ?: return
        val token = smartSentenceToken
        val languageHint = KeyboardPrefs.inputLanguage(this)
        val shieldEnabled = KeyboardPrefs.privacyShieldEnabled(this)
        showStatus(if (shieldEnabled) "ANA AI • checking paragraph • Privacy Shield active" else "ANA AI • checking paragraph")
        smartSentenceInFlight = true

        smartSentenceExecutor.execute {
            try {
                val cloudResult = AnaApi.correctParagraph(baseUrl, candidate.text, languageHint, shieldEnabled, cloudGlossary())
                val corrected = cloudResult.text.trim()
                mainHandler.post {
                    if (token != smartSentenceToken || currentInputConnection !== connection) {
                        if (currentInputConnection === connection) showStatus(defaultStatus())
                        return@post
                    }
                    if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService) || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this@AnaKeyboardService) || !isAppAiAllowed()) {
                        showStatus(defaultStatus())
                        return@post
                    }

                    if (corrected == candidate.text) {
                        lastSmartSentenceChecked = candidate.text
                        showStatus(defaultStatus())
                        return@post
                    }
                    if (!isSafeSentenceCorrection(candidate.text, corrected)) {
                        // Do not leave the keyboard stuck on "checking" if the
                        // model returned something too different to auto-apply.
                        showStatus(defaultStatus())
                        return@post
                    }

                    // Do not silently rewrite a paragraph. Keep obvious local
                    // typo correction automatic, but present AI paragraph rewrites
                    // as a reviewable proposal with explicit Accept / Reject.
                    val tail = connection.getTextBeforeCursor(candidate.suffix.length, 0)?.toString().orEmpty()
                    if (tail != candidate.suffix) {
                        showStatus(defaultStatus())
                        scheduleSmartSentenceCorrection()
                        return@post
                    }

                    showSentenceProposal(candidate, corrected, connection, cloudResult.shieldedCount)
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
                    if (token != smartSentenceToken && !explicitAiActionInFlight && KeyboardPrefs.smartSentenceCorrectionEnabled(this@AnaKeyboardService)) {
                        scheduleSmartSentenceCorrection()
                    }
                }
            }
        }
    }

    private fun showSentenceProposal(candidate: SentenceCandidate, corrected: String, connection: InputConnection, shieldedCount: Int = 0) {
        pendingSentenceProposal = SentenceProposal(candidate.text, corrected, candidate.suffix, candidate.trailing, connection)
        if (KeyboardPrefs.smartCorrectionMode(this) == "auto") {
            applySentenceProposal(auto = true)
            return
        }
        if (::correctionPreviewText.isInitialized) {
            correctionPreviewText.text = buildCorrectionPreview(candidate.text, corrected)
            correctionPreview.visibility = View.VISIBLE
        }
        showStatus(if (shieldedCount > 0) "ANA AI • correction ready • Privacy Shield protected $shieldedCount" else "ANA AI • correction ready for review")
    }

    private fun buildCorrectionPreview(before: String, after: String): String {
        val cleanBefore = before.replace("\n", " ").replace(Regex("\\s+"), " ").trim()
        val cleanAfter = after.replace("\n", " ").replace(Regex("\\s+"), " ").trim()
        return "Before: $cleanBefore\n\nAfter:  $cleanAfter"
    }

    private fun dismissSentenceProposal(markChecked: Boolean) {
        val proposal = pendingSentenceProposal
        if (markChecked && proposal != null) lastSmartSentenceChecked = proposal.original
        pendingSentenceProposal = null
        if (::correctionPreview.isInitialized) correctionPreview.visibility = View.GONE
    }

    private fun rejectSentenceProposal() {
        val proposal = pendingSentenceProposal ?: return
        lastSmartSentenceChecked = proposal.original
        dismissSentenceProposal(markChecked = false)
        showStatus("Correction rejected")
    }

    private fun applySentenceProposal(auto: Boolean = false) {
        val proposal = pendingSentenceProposal ?: return
        val connection = currentInputConnection
        if (connection == null || connection !== proposal.connection || isSensitiveField() || KeyboardPrefs.incognitoEnabled(this)) {
            dismissSentenceProposal(markChecked = false)
            showStatus("Text field changed — correction not applied")
            return
        }

        finishLocalComposition(connection)
        val tail = connection.getTextBeforeCursor(proposal.suffix.length, 0)?.toString().orEmpty()
        if (tail != proposal.suffix) {
            dismissSentenceProposal(markChecked = false)
            showStatus("Draft changed — correction not applied")
            scheduleSmartSentenceCorrection()
            return
        }

        val replacement = proposal.corrected + proposal.trailing
        connection.beginBatchEdit()
        val deleted = connection.deleteSurroundingText(proposal.suffix.length, 0)
        if (!deleted) {
            connection.endBatchEdit()
            dismissSentenceProposal(markChecked = false)
            showStatus("ANA AI • could not apply correction")
            return
        }
        connection.commitText(replacement, 1)
        connection.endBatchEdit()

        lastSentenceCorrection = SentenceCorrectionRecord(proposal.original, proposal.corrected, proposal.trailing)
        lastSmartSentenceChecked = proposal.corrected
        dismissSentenceProposal(markChecked = false)
        clearSuggestions()
        refreshShiftFromEditor()
        showStatus(if (auto) "ANA AI • correction applied automatically" else "Paragraph corrected")
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
                requestSuggestionsSoon()
                return
            }
        }

        if (isSensitiveField()) return
        if (currentWord() != word || !cachedWordSuggestionsEnabled) return

        val clean = suggestions
            .filterNot { it.equals(word, ignoreCase = true) }
            .distinctBy { it.lowercase() }
            .take(2)

        lastSuggestedWord = word
        lastLooksLikeTypo = looksLikeTypo
        bestCorrection = clean.firstOrNull()

        val emoji = CoreLexicon.emojiForWord(word, cachedInputBadge)
        val entries = mutableListOf(SuggestionEntry(word, word, SuggestionKind.WORD))
        clean.take(if (emoji != null) 1 else 2).forEach { entries += SuggestionEntry(it, it, SuggestionKind.WORD) }
        if (emoji != null && entries.size < 3) entries += SuggestionEntry(emoji, emoji, SuggestionKind.EMOJI)
        showEntries(entries)
    }

    private fun handleNextWordResult(previous: String, suggestions: List<String>) {
        if (isSensitiveField() || !cachedWordSuggestionsEnabled || currentWord() != null) return
        val currentPrevious = lastCompletedWord()
        if (!previous.equals(currentPrevious, ignoreCase = true)) return
        val clipboard = clipboardQuickEntry()
        val limit = if (clipboard != null) 2 else 3
        val entries = suggestions
            .distinctBy { it.lowercase() }
            .take(limit)
            .map { SuggestionEntry(it, it, SuggestionKind.NEXT_WORD) }
            .toMutableList()
        if (clipboard != null && entries.size < 3) entries += clipboard
        showEntries(entries)
    }

    private fun showEntries(entries: List<SuggestionEntry>) {
        suggestionButtons.forEachIndexed { index, button ->
            val entry = entries.getOrNull(index)
            suggestionEntries[index] = entry
            button.text = entry?.label.orEmpty()
            button.alpha = if (entry == null) 0f else 1f
            button.contentDescription = entry?.let {
                when (it.kind) {
                    SuggestionKind.CLIPBOARD -> "Paste " + it.value.take(40)
                    SuggestionKind.EMOJI -> "Insert emoji " + it.value
                    SuggestionKind.NEXT_WORD -> "Next word " + it.value
                    SuggestionKind.WORD -> "Word suggestion " + it.value
                }
            } ?: "Empty suggestion"
        }
    }

    private fun applySuggestionEntry(index: Int) {
        val entry = suggestionEntries.getOrNull(index) ?: return
        val connection = currentInputConnection ?: return
        vibrateSuggestionTap()
        when (entry.kind) {
            SuggestionKind.WORD -> applyWordSuggestion(entry.value)
            SuggestionKind.NEXT_WORD -> {
                finishLocalComposition(connection)
                val previous = lastCompletedWord()
                val before = connection.getTextBeforeCursor(1, 0)?.toString().orEmpty()
                val prefix = if (before.isNotEmpty() && !before.last().isWhitespace()) " " else ""
                val suffix = if (cachedAutoSpaceSuggestion) " " else ""
                connection.commitText(prefix + entry.value + suffix, 1)
                if (!previous.isNullOrBlank()) suggestionEngine.learnTransition(previous, entry.value)
                clearSuggestions()
                refreshShiftFromEditor()
                if (cachedAutoSpaceSuggestion) requestSuggestionsSoon()
            }
            SuggestionKind.EMOJI -> {
                finishLocalComposition(connection)
                val before = connection.getTextBeforeCursor(1, 0)?.toString().orEmpty()
                val prefix = if (before.isNotEmpty() && !before.last().isWhitespace()) " " else ""
                val suffix = if (cachedAutoSpaceSuggestion) " " else ""
                connection.commitText(prefix + entry.value + suffix, 1)
                clearSuggestions()
                if (cachedAutoSpaceSuggestion) requestSuggestionsSoon()
            }
            SuggestionKind.CLIPBOARD -> {
                finishLocalComposition(connection)
                connection.commitText(entry.value, 1)
                KeyboardPrefs.rememberClipboard(this, entry.value)
                clearSuggestions()
                refreshShiftFromEditor()
            }
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
        suggestionButtons.forEachIndexed { index, button ->
            button.text = ""
            button.alpha = 0f
            suggestionEntries[index] = null
        }
        lastSuggestedWord = ""
        bestCorrection = null
        lastLooksLikeTypo = false
    }

    private fun applyWordSuggestion(suggestion: String) {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        val word = currentWord() ?: return
        val suffix = if (cachedAutoSpaceSuggestion) " " else ""

        if (suggestion.equals(word, ignoreCase = true)) {
            KeyboardPrefs.addPersonalWord(this, word)
            refreshTypingCache()
            suggestionEngine.refreshUserData()
            connection.commitText(suffix, 1)
            pendingDelimitedWord = null
            clearSuggestions()
            refreshShiftFromEditor()
            showStatus("$word added to your dictionary")
            return
        }

        val replacement = adjustCase(word, suggestion)
        connection.deleteSurroundingText(word.length, 0)
        connection.commitText(replacement + suffix, 1)
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

        if (!wordBeforeSpace.isNullOrBlank()) learnTransitionFromContext()

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
        requestSuggestionsSoon()
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
        if (isSensitiveField() || shortcutCache.isEmpty()) return false
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

    private fun performUndo() {
        if (undoLastSentenceCorrection()) return
        if (undoLastAutoCorrection()) return
        sendEditorShortcut(KeyEvent.KEYCODE_Z, KeyEvent.META_CTRL_ON)
    }

    private fun sendEditorShortcut(keyCode: Int, metaState: Int) {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        val now = SystemClock.uptimeMillis()
        connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0, metaState))
        connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0, metaState))
        clearSuggestions()
        requestSuggestionsSoon()
    }

    private fun performSelectAll() {
        val connection = currentInputConnection ?: return
        finishLocalComposition(connection)
        connection.performContextMenuAction(android.R.id.selectAll)
        clearSuggestions()
        showStatus("Selected all")
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

    private fun editorRequestsMultiline(info: EditorInfo?): Boolean {
        if (info == null) return true
        val inputType = info.inputType
        val klass = inputType and InputType.TYPE_MASK_CLASS
        if (klass != InputType.TYPE_CLASS_TEXT) return false
        return (inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0 ||
            (inputType and InputType.TYPE_TEXT_FLAG_IME_MULTI_LINE) != 0
    }

    private fun editorAction(info: EditorInfo?): Int? {
        if (info == null || editorRequestsMultiline(info)) return null

        val standard = info.imeOptions and EditorInfo.IME_MASK_ACTION
        if (standard != EditorInfo.IME_ACTION_NONE && standard != EditorInfo.IME_ACTION_UNSPECIFIED) {
            return standard
        }

        return info.actionId.takeIf { it > 0 && !info.actionLabel.isNullOrBlank() }
    }

    private fun editorActionLabel(info: EditorInfo?): String {
        if (info == null || editorRequestsMultiline(info)) return "Enter"

        return when (editorAction(info)) {
            EditorInfo.IME_ACTION_SEARCH -> "Search"
            EditorInfo.IME_ACTION_NEXT -> "Next"
            EditorInfo.IME_ACTION_GO -> "Go"
            EditorInfo.IME_ACTION_SEND -> "Send"
            EditorInfo.IME_ACTION_DONE -> "Done"
            EditorInfo.IME_ACTION_PREVIOUS -> "Previous"
            else -> info.actionLabel?.toString()?.trim()?.take(10).orEmpty().ifBlank { "Enter" }
        }
    }

    private fun updateEnterKeyForEditor(info: EditorInfo? = currentInputEditorInfo) {
        if (!::keyboard.isInitialized) return
        keyboard.setEnterLabel(editorActionLabel(info))
    }

    private fun handleEnter() {
        val connection = currentInputConnection ?: return
        val info = currentInputEditorInfo
        finishLocalComposition(connection)

        val action = editorAction(info)
        if (action != null) {
            val handled = try { connection.performEditorAction(action) } catch (_: Exception) { false }
            if (!handled) {
                try {
                    connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
                    connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
                } catch (_: Exception) {
                    // If the host field refuses its advertised action, do not
                    // turn a login/search action into an accidental newline.
                }
            }
            return
        }

        // Multiline writing surfaces (messages, email bodies, notes, documents)
        // keep Enter as a genuine newline.
        connection.commitText("\n", 1)
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
        if (raw.isBlank() || isSensitiveField()) return
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

    private fun isOtpField(): Boolean {
        val info = currentInputEditorInfo ?: return false
        val hint = listOfNotNull(info.hintText?.toString(), info.label?.toString(), info.fieldName, info.privateImeOptions)
            .joinToString(" ").lowercase()
        return Regex("""\b(otp|one[ -]?time(?: password| code)?|verification[ -]?code|sms[ -]?code|auth(?:entication)?[ -]?code|security[ -]?code|passcode)\b""")
            .containsMatchIn(hint)
    }

    private fun isSensitiveField(): Boolean {
        val info = currentInputEditorInfo
        val noLearning = info != null && (info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0
        return isPasswordField() || isOtpField() || noLearning
    }

    private fun currentAppPackage(): String = currentInputEditorInfo?.packageName?.trim().orEmpty()

    private fun isAppAiAllowed(): Boolean =
        KeyboardPrefs.aiAllowedForPackage(this, currentAppPackage())

    private fun toggleCurrentAppAi() {
        val packageName = currentAppPackage()
        if (packageName.isBlank()) {
            showStatus("App privacy setting is unavailable here")
            return
        }
        val next = !isAppAiAllowed()
        KeyboardPrefs.setAiAllowedForPackage(this, packageName, next)
        appAiButton?.text = if (next) "AI app ✓" else "AI app off"
        updateAiAvailability()
        showStatus(if (next) "Ana AI enabled for this app" else "Ana AI disabled for this app")
    }

    private fun updateAiAvailability() {
        if (!::status.isInitialized) return
        val privateField = isSensitiveField()
        val incognito = KeyboardPrefs.incognitoEnabled(this)
        val appAllowed = isAppAiAllowed()
        aiButtons.forEach { it.isEnabled = !privateField && !incognito && appAllowed }
        if (::targetButton.isInitialized) targetButton.isEnabled = !privateField
        appAiButton?.isEnabled = !privateField
        appAiButton?.text = if (appAllowed) "AI app ✓" else "AI app off"
        voiceButton?.isEnabled = !privateField && !incognito
        if (privateField) {
            dismissSentenceProposal(markChecked = false)
            status.text = "PRIVATE FIELD • Ana AI, voice, learning and clipboard are off"
            clearSuggestions()
        } else if (incognito) {
            dismissSentenceProposal(markChecked = false)
            status.text = "INCOGNITO • learning, clipboard history and Ana AI are off"
        } else if (!appAllowed) {
            dismissSentenceProposal(markChecked = false)
            status.text = "APP AI OFF • local typing and suggestions only"
        } else {
            status.text = defaultStatus()
        }
    }

    private fun toggleVoiceTyping() {
        when {
            voiceFinalizing -> showStatus("Finishing dictation…")
            voiceListening -> finishVoiceTyping()
            else -> {
                voiceMode = VoiceMode.DICTATE
                voiceEditSource = null
                startVoiceTyping()
            }
        }
    }

    private fun startVoiceEditCommand() {
        if (voiceFinalizing) {
            showStatus("Finishing dictation…")
            return
        }
        if (voiceListening) {
            finishVoiceTyping()
            return
        }
        if (isSensitiveField() || KeyboardPrefs.incognitoEnabled(this) || !isAppAiAllowed()) {
            showStatus("Voice edit is unavailable in this private context")
            return
        }
        val connection = currentInputConnection ?: return
        val selected = connection.getSelectedText(0)?.toString().orEmpty()
        if (selected.isBlank()) {
            showStatus("Select text first, then tap Voice edit")
            return
        }
        voiceMode = VoiceMode.EDIT_COMMAND
        voiceEditSource = ActionText(selected.take(8000), true)
        startVoiceTyping()
    }

    private fun setVoiceListeningUi(listening: Boolean) {
        voiceButton?.setImageResource(if (listening) R.drawable.ic_stop else R.drawable.ic_mic)
        voiceButton?.contentDescription = if (listening) "Stop voice typing" else "Voice typing"
    }

    private fun recycleSpeechRecognizer() {
        val old = speechRecognizer
        speechRecognizer = null
        try { old?.cancel() } catch (_: Exception) {}
        try { old?.destroy() } catch (_: Exception) {}
    }

    private fun startVoiceTyping() {
        if (!KeyboardPrefs.voiceTypingEnabled(this)) {
            showStatus("Voice typing is turned off in settings")
            return
        }
        if (isSensitiveField()) {
            showStatus("Voice typing is disabled in private fields")
            return
        }
        if (KeyboardPrefs.incognitoEnabled(this)) {
            showStatus("Voice typing is disabled in Incognito mode")
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startActivity(Intent(this, MicrophonePermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            showStatus("Allow microphone permission, then tap the microphone again")
            return
        }
        val standardAvailable = SpeechRecognizer.isRecognitionAvailable(this)
        val canUseOnDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        if (!standardAvailable && !canUseOnDevice) {
            showStatus("Android speech service is unavailable — microphone permission is already separate")
            return
        }

        // Build a fresh recognizer for every dictation session. Some Android
        // speech services remain BUSY/CLIENT-broken after a completed/cancelled
        // session even though microphone permission is still granted.
        voiceSessionId += 1
        val sessionId = voiceSessionId
        recycleSpeechRecognizer()

        val preferOnDevice = KeyboardPrefs.preferOnDeviceDictation(this)
        voiceRecognizerOnDevice = (preferOnDevice && canUseOnDevice && !onDeviceVoiceFailedThisSession) ||
            (!standardAvailable && canUseOnDevice)
        speechRecognizer = if (voiceRecognizerOnDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        } else {
            SpeechRecognizer.createSpeechRecognizer(this)
        }
        speechRecognizer = speechRecognizer?.apply {
            setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        if (sessionId != voiceSessionId || voiceResultHandled) return
                        if (voiceStopRequested) {
                            voiceListening = false
                            voiceFinalizing = true
                            showStatus("Finishing dictation…")
                            return
                        }
                        voiceListening = true
                        voiceFinalizing = false
                        setVoiceListeningUi(true)
                        showStatus(if (voiceMode == VoiceMode.EDIT_COMMAND) "Listening for edit instruction…" else if (voiceRecognizerOnDevice) "Listening on device…" else "Listening…")
                    }
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() {
                        if (sessionId != voiceSessionId) return
                        if (!voiceResultHandled) {
                            voiceFinalizing = true
                            voiceListening = false
                            showStatus("Finishing dictation…")
                            mainHandler.removeCallbacks(voiceFinalizeTimeout)
                            mainHandler.postDelayed(voiceFinalizeTimeout, 2800)
                        }
                    }
                    override fun onError(error: Int) {
                        if (sessionId != voiceSessionId || voiceResultHandled) return
                        if (voiceRecognizerOnDevice && VoiceDictationPolicy.shouldFallbackFromOnDevice(error)) {
                            onDeviceVoiceFailedThisSession = true
                        }
                        if (VoiceDictationPolicy.shouldRecycleRecognizer(error)) {
                            val failedRecognizer = speechRecognizer
                            speechRecognizer = null
                            mainHandler.post { try { failedRecognizer?.destroy() } catch (_: Exception) {} }
                        }
                        val fallback = VoiceDictationPolicy.bestText("", lastVoicePartial)
                        if (fallback.isNotBlank()) {
                            completeVoiceRecognition(fallback)
                        } else {
                            voiceResultHandled = true
                            voiceListening = false
                            voiceFinalizing = false
                            mainHandler.removeCallbacks(voiceFinalizeTimeout)
                            try {
                                currentInputConnection?.setComposingText("", 1)
                                currentInputConnection?.finishComposingText()
                            } catch (_: Exception) {}
                            setVoiceListeningUi(false)
                            showStatus(voiceErrorMessage(error))
                        }
                    }
                    override fun onResults(results: Bundle?) {
                        if (sessionId != voiceSessionId || voiceResultHandled) return
                        val finalText = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                        completeVoiceRecognition(VoiceDictationPolicy.bestText(finalText, lastVoicePartial))
                    }
                    override fun onPartialResults(partialResults: Bundle?) {
                        if (sessionId != voiceSessionId || voiceResultHandled) return
                        val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                        if (partial.isBlank()) return
                        lastVoicePartial = partial
                        if (voiceMode == VoiceMode.EDIT_COMMAND) {
                            showStatus("Voice edit: " + partial.take(80))
                        } else {
                            currentInputConnection?.setComposingText(partial, 1)
                        }
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })
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
            if (KeyboardPrefs.preferOnDeviceDictation(this@AnaKeyboardService)) {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
        }
        voiceResultHandled = false
        voiceFinalizing = false
        voiceStopRequested = false
        lastVoicePartial = ""
        voiceListening = true
        setVoiceListeningUi(true)
        try {
            speechRecognizer?.startListening(intent)
            showStatus(if (voiceRecognizerOnDevice) "Listening on device…" else "Listening…")
        } catch (_: Exception) {
            voiceListening = false
            voiceFinalizing = false
            voiceSessionId += 1
            recycleSpeechRecognizer()
            setVoiceListeningUi(false)
            showStatus("Speech service did not start — Ana reset it; tap the mic again")
        }
    }

    private fun cloudGlossary(): List<String> =
        (
            KeyboardPrefs.personalDictionary(this, cachedInputBadge) +
            KeyboardPrefs.sharedGlossaryTerms(this, cachedInputBadge)
        ).map { it.trim() }.filter { it.isNotBlank() }.distinctBy { it.lowercase() }.take(80)

    private fun commitDictationText(text: String, message: String) {
        val connection = currentInputConnection ?: return
        try {
            connection.setComposingText("", 1)
            connection.finishComposingText()
        } catch (_: Exception) {}
        if (text.isNotBlank()) connection.commitText(text.trim() + " ", 1)
        clearSuggestions()
        refreshShiftFromEditor()
        showStatus(if (text.isBlank()) "Nothing heard" else message)
    }

    private fun finishDictation(raw: String) {
        if (raw.isBlank()) {
            currentInputConnection?.finishComposingText()
            showStatus("Nothing heard")
            return
        }
        val cleanMode = KeyboardPrefs.dictationMode(this) == "clean"
        val baseUrl = KeyboardPrefs.baseUrl(this)
        val canUseCloud = cleanMode && baseUrl.isNotBlank() && isAppAiAllowed() &&
            !KeyboardPrefs.incognitoEnabled(this) && !isSensitiveField()

        if (!canUseCloud) {
            commitDictationText(raw, if (cleanMode) "Exact dictation inserted" else "Dictation inserted")
            return
        }

        val connection = currentInputConnection ?: return
        try {
            connection.setComposingText("", 1)
            connection.finishComposingText()
        } catch (_: Exception) {}
        val shield = KeyboardPrefs.privacyShieldEnabled(this)
        showStatus(if (shield) "ANA AI • cleaning dictation • Privacy Shield active" else "ANA AI • cleaning dictation")
        executor.execute {
            try {
                val result = AnaApi.cleanDictation(
                    baseUrl,
                    raw,
                    KeyboardPrefs.inputLanguage(this),
                    shield,
                    cloudGlossary()
                )
                mainHandler.post {
                    if (currentInputConnection !== connection) {
                        showStatus("Text field changed — dictation result was not inserted")
                        return@post
                    }
                    connection.commitText(result.text.trim() + " ", 1)
                    clearSuggestions()
                    refreshShiftFromEditor()
                    showStatus(if (result.shieldedCount > 0) "Clean dictation inserted • Privacy Shield protected ${result.shieldedCount}" else "Clean dictation inserted")
                }
            } catch (_: Exception) {
                mainHandler.post { commitDictationText(raw, "Clean-up unavailable — exact dictation inserted") }
            }
        }
    }

    private fun finishVoiceEditCommand(command: String) {
        val source = voiceEditSource
        voiceEditSource = null
        voiceMode = VoiceMode.DICTATE
        if (command.isBlank() || source == null) {
            showStatus(if (command.isBlank()) "No edit instruction heard" else "Select text first")
            return
        }
        val connection = currentInputConnection ?: return
        val selected = connection.getSelectedText(0)?.toString().orEmpty()
        if (selected != source.text) {
            showStatus("Selection changed — Voice edit cancelled")
            return
        }
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) {
            showStatus("Set your Ana address in keyboard settings first")
            return
        }
        val shield = KeyboardPrefs.privacyShieldEnabled(this)
        setAiBusy(true)
        showStatus(if (shield) "ANA AI • Voice edit • Privacy Shield active" else "ANA AI • Voice edit")
        executor.execute {
            try {
                val result = AnaApi.voiceEdit(baseUrl, source.text, command, KeyboardPrefs.target(this), shield, cloudGlossary())
                mainHandler.post {
                    if (currentInputConnection !== connection || connection.getSelectedText(0)?.toString() != source.text) {
                        setAiBusy(false)
                        showStatus("Selection changed — Ana left it untouched")
                        return@post
                    }
                    connection.commitText(result.text, 1)
                    setAiBusy(false)
                    showStatus(if (result.shieldedCount > 0) "Voice edit applied • Privacy Shield protected ${result.shieldedCount}" else "Voice edit applied")
                    clearSuggestions()
                    refreshShiftFromEditor()
                }
            } catch (error: Exception) {
                mainHandler.post {
                    setAiBusy(false)
                    showStatus(error.message ?: "Voice edit failed")
                }
            }
        }
    }

    private fun finishVoiceTyping() {
        if (!voiceListening || voiceResultHandled) return
        voiceListening = false
        voiceFinalizing = true
        voiceStopRequested = true
        showStatus("Finishing dictation…")
        mainHandler.removeCallbacks(voiceFinalizeTimeout)
        mainHandler.postDelayed(voiceFinalizeTimeout, 2800)
        try {
            speechRecognizer?.stopListening()
        } catch (_: Exception) {
            completeVoiceRecognition("", fromTimeout = true)
        }
    }

    private fun completeVoiceRecognition(text: String, fromTimeout: Boolean = false) {
        if (voiceResultHandled) return
        voiceResultHandled = true
        voiceListening = false
        voiceFinalizing = false
        voiceStopRequested = false
        mainHandler.removeCallbacks(voiceFinalizeTimeout)
        setVoiceListeningUi(false)

        val resolved = VoiceDictationPolicy.bestText(text, lastVoicePartial)
        lastVoicePartial = ""
        if (resolved.isBlank()) {
            try {
                currentInputConnection?.setComposingText("", 1)
                currentInputConnection?.finishComposingText()
            } catch (_: Exception) {}
            showStatus(if (fromTimeout) "Nothing heard — tap the mic and try again" else "Nothing heard")
            if (voiceMode == VoiceMode.EDIT_COMMAND) {
                voiceEditSource = null
                voiceMode = VoiceMode.DICTATE
            }
            return
        }

        if (voiceMode == VoiceMode.EDIT_COMMAND) finishVoiceEditCommand(resolved)
        else finishDictation(resolved)
    }

    private fun voiceErrorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "Nothing understood — if this repeats, check Android Mic access"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                "Ana permission is allowed — check Android Mic access in Quick Settings"
            else "Microphone permission is required"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech service was busy — Ana reset it; tap the mic again"
        SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_SERVER -> "Speech service reset — tap the mic again"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network error"
        else -> if (voiceRecognizerOnDevice && onDeviceVoiceFailedThisSession) {
            "On-device speech failed — Ana will use Android speech recognition next time"
        } else {
            "Voice recognition failed — tap the mic and try again"
        }
    }

    private fun stopVoiceTyping(showMessage: Boolean) {
        if (!voiceListening && !voiceFinalizing) return
        mainHandler.removeCallbacks(voiceFinalizeTimeout)
        voiceResultHandled = true
        voiceListening = false
        voiceFinalizing = false
        voiceStopRequested = false
        lastVoicePartial = ""
        voiceSessionId += 1
        recycleSpeechRecognizer()
        try {
            currentInputConnection?.setComposingText("", 1)
            currentInputConnection?.finishComposingText()
        } catch (_: Exception) {}
        if (voiceMode == VoiceMode.EDIT_COMMAND) {
            voiceEditSource = null
            voiceMode = VoiceMode.DICTATE
        }
        setVoiceListeningUi(false)
        if (showMessage) showStatus("Voice typing cancelled")
    }

    private data class ActionText(val text: String, val selected: Boolean)
    private data class ExplicitActionText(val editorText: String, val aiText: String, val selected: Boolean)

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

    private fun explicitActionText(): ExplicitActionText? {
        val source = actionText() ?: return null
        val connection = currentInputConnection ?: return null
        val proposal = pendingSentenceProposal
        var aiText = source.text

        if (!source.selected && proposal != null && proposal.connection === connection) {
            val tail = connection.getTextBeforeCursor(proposal.suffix.length, 0)?.toString().orEmpty()
            val sameDraft = tail == proposal.suffix &&
                source.text.trimEnd().equals(proposal.original.trimEnd(), ignoreCase = false)
            if (sameDraft) aiText = proposal.corrected
        }

        // An explicit toolbar command owns this text now. Invalidate any
        // background paragraph check and remove its proposal so it cannot
        // compete with Translate / Write / tone actions later.
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        dismissSentenceProposal(markChecked = false)
        explicitAiActionInFlight = true
        return ExplicitActionText(source.text, aiText, source.selected)
    }

    private fun finishExplicitAiAction() {
        explicitAiActionInFlight = false
        // Do not immediately re-run Smart Correction on the result of an
        // explicit action. Normal typing will schedule the next check.
        smartSentenceToken++
        mainHandler.removeCallbacks(smartSentenceRunnable)
        dismissSentenceProposal(markChecked = false)
    }

    private fun runAnaAction(action: AnaApi.Action) {
        if (isSensitiveField()) {
            showStatus("Ana AI is disabled in private fields")
            return
        }
        if (KeyboardPrefs.incognitoEnabled(this)) {
            showStatus("Ana AI is disabled in Incognito mode")
            return
        }
        if (!isAppAiAllowed()) {
            showStatus("Ana AI is off for this app")
            return
        }
        val baseUrl = KeyboardPrefs.baseUrl(this)
        if (baseUrl.isBlank()) {
            showStatus("Open Ana Keyboard settings and set your Ana address")
            return
        }
        val source = explicitActionText()
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
        val shieldEnabled = KeyboardPrefs.privacyShieldEnabled(this)
        setAiBusy(true)
        val busyMessage = when (action) {
            AnaApi.Action.WRITE -> "ANA AI • writing in $target…"
            AnaApi.Action.FIX -> "ANA AI • correcting to $target…"
            AnaApi.Action.TRANSLATE -> "ANA AI • translating to $target…"
            AnaApi.Action.SHORTER -> "ANA AI • shortening…"
            AnaApi.Action.FORMAL -> "ANA AI • making formal…"
            AnaApi.Action.FRIENDLY -> "ANA AI • making friendly…"
            AnaApi.Action.DU -> "ANA AI • converting to Du…"
            AnaApi.Action.SIE -> "ANA AI • converting to Sie…"
            else -> "ANA AI • working…"
        }
        showStatus(if (shieldEnabled) "$busyMessage • Privacy Shield active" else busyMessage)

        executor.execute {
            try {
                val result = AnaApi.transform(baseUrl, source.aiText, action, target, shieldEnabled, cloudGlossary())
                mainHandler.post {
                    if (currentInputConnection !== connection) {
                        finishExplicitAiAction()
                        setAiBusy(false)
                        showStatus("Text field changed — result was not inserted")
                        return@post
                    }
                    val stillMatches = if (source.selected) {
                        connection.getSelectedText(0)?.toString() == source.editorText
                    } else {
                        connection.getTextBeforeCursor(source.editorText.length, 0)?.toString() == source.editorText
                    }
                    if (!stillMatches) {
                        finishExplicitAiAction()
                        setAiBusy(false)
                        showStatus("Draft changed — Ana left it untouched")
                        return@post
                    }

                    if (source.selected) connection.commitText(result.text, 1)
                    else {
                        connection.deleteSurroundingText(source.editorText.length, 0)
                        connection.commitText(result.text, 1)
                    }
                    finishExplicitAiAction()
                    setAiBusy(false)
                    showStatus(if (result.shieldedCount > 0) "Done • Privacy Shield protected ${result.shieldedCount}" else "Done")
                    clearSuggestions()
                    refreshShiftFromEditor()
                }
            } catch (error: Exception) {
                mainHandler.post {
                    finishExplicitAiAction()
                    setAiBusy(false)
                    showStatus(error.message ?: "Ana request failed")
                }
            }
        }
    }

    private fun setAiBusy(busy: Boolean) {
        if (busy) {
            aiButtons.forEach { it.isEnabled = false }
            if (::targetButton.isInitialized) targetButton.isEnabled = false
        } else {
            updateAiAvailability()
        }
    }

    private fun defaultStatus(): String = when {
        KeyboardPrefs.incognitoEnabled(this) -> "INCOGNITO • local typing only"
        !isAppAiAllowed() -> "APP AI OFF • local typing and suggestions only"
        KeyboardPrefs.privacyShieldEnabled(this) -> "LOCAL • Privacy Shield ON"
        else -> "LOCAL • typing stays on device"
    }

    private fun showStatus(message: String) {
        if (!::status.isInitialized) return
        status.text = message
        mainHandler.removeCallbacksAndMessages(STATUS_TOKEN)
        mainHandler.postAtTime({
            if (!isSensitiveField() && !voiceListening && !voiceFinalizing) status.text = defaultStatus()
        }, STATUS_TOKEN, SystemClock.uptimeMillis() + 2600)
    }

    override fun onDestroy() {
        cancelPendingGlide()
        stopVoiceTyping(false)
        voiceSessionId += 1
        recycleSpeechRecognizer()
        try { clipboardManager.removePrimaryClipChangedListener(clipboardListener) } catch (_: Exception) {}
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
