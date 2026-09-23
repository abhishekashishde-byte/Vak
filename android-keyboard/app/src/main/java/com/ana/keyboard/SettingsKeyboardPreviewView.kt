package com.ana.keyboard

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

class SettingsKeyboardPreviewView(context: Context) : LinearLayout(context), AnaKeyboardView.Listener {
    private val output = TextView(context).apply {
        text = "Tap keys to test your setup"
        textSize = 17f
        setTextColor(Color.WHITE)
        setHintTextColor(Color.GRAY)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(14), dp(8), dp(14), dp(8))
        setBackgroundColor(Color.rgb(52, 52, 54))
        maxLines = 2
    }

    private val keyboard = AnaKeyboardView(context).apply {
        listener = this@SettingsKeyboardPreviewView
    }
    private val suggestionEngine = LocalSuggestionEngine(context, onResult = { _, _, _ -> Unit })
    private val text = StringBuilder()
    private var lastSpaceAt = 0L

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(26, 26, 26))
        addView(output, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)))
        addView(
            keyboard,
            LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(KeyboardSizing.keyboardHeightDp(context)))
        )
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(context))
        refreshFromSettings()
    }

    fun refreshFromSettings() {
        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(context))
        keyboard.layoutParams = keyboard.layoutParams.apply {
            height = dp(KeyboardSizing.keyboardHeightDp(context))
        }
        keyboard.refreshPreferences()
        loadBackground()
        requestLayout()
        invalidate()
    }

    fun clearText() {
        text.clear()
        updateOutput()
    }

    override fun onPressFeedback(view: View) {
        if (KeyboardPrefs.hapticEnabled(context)) {
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(
                VibrationEffect.createOneShot(
                    KeyboardPrefs.hapticStrengthMs(context).toLong(),
                    VibrationEffect.DEFAULT_AMPLITUDE
                )
            )
        }
        if (KeyboardPrefs.soundEnabled(context)) {
            (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                .playSoundEffect(AudioManager.FX_KEY_CLICK, 0.35f)
        }
    }

    override fun onGlide(trace: AnaKeyboardView.GlideTrace) {
        suggestionEngine.decodeGlideAsync(trace) { decoded ->
            post {
                val word = decoded ?: return@post
                val finalWord = if (keyboard.isShifted()) word.replaceFirstChar { it.uppercase() } else word
                appendText(finalWord)
                appendText(" ")
                keyboard.setShifted(false)
            }
        }
    }

    override fun onKey(code: String) {
        when (code) {
            "SHIFT" -> keyboard.setShifted(!keyboard.isShifted())
            "SYMBOLS" -> keyboard.setSymbols(true)
            "ABC" -> keyboard.setSymbols(false)
            "LANGUAGE" -> {
                KeyboardPrefs.cycleInputLanguage(context)
                suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(context))
                keyboard.refreshPreferences()
            }
            "BACKSPACE" -> {
                if (text.isNotEmpty()) text.deleteCharAt(text.lastIndex)
                updateOutput()
            }
            "SPACE" -> handleSpace()
            "CURSOR_LEFT", "CURSOR_RIGHT" -> Unit
            "ENTER" -> appendText("\n")
            "EMOJI" -> appendText("🙂")
            else -> {
                var value = code
                if (code.length == 1 && code[0].isLetter() && keyboard.isShifted()) {
                    value = code.uppercase()
                    keyboard.setShifted(false)
                }
                val punctuation = value in setOf(",", ".", "?", "!", ":", ";")
                appendText(if (punctuation && KeyboardPrefs.autoSpaceAfterPunctuation(context)) "$value " else value)
            }
        }
    }

    private fun handleSpace() {
        autoCorrectLastWord()
        val now = android.os.SystemClock.elapsedRealtime()
        val canPeriod = KeyboardPrefs.doubleSpacePeriodEnabled(context) && now - lastSpaceAt < 420 &&
            text.length >= 2 && text.last() == ' ' && !text[text.length - 2].isWhitespace()
        if (canPeriod) {
            text.deleteCharAt(text.lastIndex)
            text.append(". ")
            lastSpaceAt = 0L
        } else {
            text.append(' ')
            lastSpaceAt = now
        }
        updateOutput()
    }

    private fun autoCorrectLastWord() {
        if (!KeyboardPrefs.autoCorrectionEnabled(context)) return
        val source = Regex("([\\p{L}']{2,})$").find(text.toString())?.value ?: return
        val lower = source.lowercase()
        if (KeyboardPrefs.personalDictionary(context).any { it.equals(source, ignoreCase = true) }) return
        val learned = KeyboardPrefs.learnedCorrections(context)[lower]
        val replacement = learned ?: suggestionEngine.fastResult(lower)
            .takeIf { it.highConfidenceTypo }
            ?.suggestions
            ?.firstOrNull()
            ?: return
        if (replacement.equals(source, ignoreCase = true)) return
        repeat(source.length) { text.deleteCharAt(text.lastIndex) }
        val adjusted = if (source.firstOrNull()?.isUpperCase() == true) replacement.replaceFirstChar { it.uppercase() } else replacement
        text.append(adjusted)
    }

    private fun appendText(value: String) {
        text.append(value)
        updateOutput()
    }

    private fun updateOutput() {
        output.text = if (text.isEmpty()) "Tap keys to test your setup" else text.toString()
    }

    private fun loadBackground() {
        val stored = KeyboardPrefs.backgroundUri(context)
        if (stored.isBlank()) {
            keyboard.setBackgroundBitmap(null)
            return
        }
        try {
            val uri = Uri.parse(stored)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (bounds.outWidth / sample > 1200 || bounds.outHeight / sample > 900) sample *= 2
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            keyboard.setBackgroundBitmap(bitmap)
        } catch (_: Exception) {
            keyboard.setBackgroundBitmap(null)
        }
    }

    override fun onDetachedFromWindow() {
        suggestionEngine.close()
        super.onDetachedFromWindow()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
