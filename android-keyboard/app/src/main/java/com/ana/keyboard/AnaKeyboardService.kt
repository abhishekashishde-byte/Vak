package com.ana.keyboard

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.inputmethodservice.InputMethodService
import java.util.concurrent.Executors

class AnaKeyboardService : InputMethodService(), AnaKeyboardView.Listener {
    private lateinit var keyboard: AnaKeyboardView
    private lateinit var status: TextView
    private lateinit var targetButton: Button
    private val aiButtons = mutableListOf<Button>()
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var capsLock = false
    private var lastShiftTap = 0L

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(26, 26, 26))
        }

        val toolbarScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(5), dp(4), dp(5), dp(3))
        }

        targetButton = actionButton(KeyboardPrefs.targetBadge(this)) {
            KeyboardPrefs.cycleTarget(this)
            targetButton.text = KeyboardPrefs.targetBadge(this)
            showStatus("Translate target: ${KeyboardPrefs.target(this)}")
        }.also { toolbar.addView(it) }

        toolbar.addView(actionButton("Translate") { runAnaAction(AnaApi.Action.TRANSLATE) }.also { aiButtons += it })
        toolbar.addView(actionButton("Fix") { runAnaAction(AnaApi.Action.FIX) }.also { aiButtons += it })
        toolbar.addView(actionButton("Tone") { runAnaAction(AnaApi.Action.TONE) }.also { aiButtons += it })
        toolbar.addView(actionButton("Shorter") { runAnaAction(AnaApi.Action.SHORTER) }.also { aiButtons += it })
        toolbarScroll.addView(toolbar)
        root.addView(toolbarScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))

        status = TextView(this).apply {
            text = "Ana"
            textSize = 12f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            setBackgroundColor(Color.rgb(35, 35, 35))
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)))

        keyboard = AnaKeyboardView(this).apply {
            listener = this@AnaKeyboardService
        }
        root.addView(keyboard, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(252)))
        updateAiAvailability()
        return root
    }

    private fun actionButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(Color.WHITE)
        backgroundTintList = ColorStateList.valueOf(Color.rgb(55, 55, 55))
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
        if (::keyboard.isInitialized) {
            keyboard.setSymbols(false)
            refreshShiftFromEditor()
            updateAiAvailability()
        }
    }

    override fun onPressFeedback(view: View) {
        if (KeyboardPrefs.hapticEnabled(this)) {
            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
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
            "SYMBOLS" -> keyboard.setSymbols(true)
            "ABC" -> {
                keyboard.setSymbols(false)
                refreshShiftFromEditor()
            }
            "GLOBE" -> switchToNextInputMethod(false)
            "BACKSPACE" -> {
                val selected = connection.getSelectedText(0)?.toString().orEmpty()
                if (selected.isNotEmpty()) connection.commitText("", 1)
                else connection.deleteSurroundingText(1, 0)
                refreshShiftFromEditor()
            }
            "SPACE" -> {
                connection.commitText(" ", 1)
                refreshShiftFromEditor()
            }
            "ENTER" -> handleEnter()
            else -> {
                var text = code
                if (code.length == 1 && code[0].isLetter() && keyboard.isShifted()) text = code.uppercase()
                connection.commitText(text, 1)
                if (!capsLock && keyboard.isShifted() && text.any { it.isLetter() }) keyboard.setShifted(false)
            }
        }
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
        val connection = currentInputConnection ?: return
        val inputType = currentInputEditorInfo?.inputType ?: InputType.TYPE_CLASS_TEXT
        keyboard.setShifted(connection.getCursorCapsMode(inputType) != 0)
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
        targetButton.isEnabled = !password
        if (password) status.text = "Ana AI disabled in password fields"
        else status.text = "Ana • normal typing stays local"
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
            showStatus("Open Ana Keyboard app and set your Ana address")
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
        targetButton.isEnabled = !busy
    }

    private fun showStatus(message: String) {
        if (!::status.isInitialized) return
        status.text = message
        mainHandler.removeCallbacksAndMessages(STATUS_TOKEN)
        mainHandler.postAtTime({
            if (!isPasswordField()) status.text = "Ana • normal typing stays local"
        }, STATUS_TOKEN, SystemClock.uptimeMillis() + 2800)
    }

    override fun onDestroy() {
        executor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private val STATUS_TOKEN = Any()
    }
}
