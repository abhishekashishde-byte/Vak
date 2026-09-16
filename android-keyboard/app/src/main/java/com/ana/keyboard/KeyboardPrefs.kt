package com.ana.keyboard

import android.content.Context
import org.json.JSONArray

object KeyboardPrefs {
    private const val STORE = "ana_keyboard_settings"
    private const val KEY_BASE_URL = "ana_base_url"
    private const val KEY_HAPTIC = "haptic_enabled"
    private const val KEY_HAPTIC_STRENGTH = "haptic_strength_ms"
    private const val KEY_SOUND = "sound_enabled"
    private const val KEY_POPUP = "key_popup_enabled"
    private const val KEY_TARGET = "target_language"
    private const val KEY_INPUT_LANGUAGE = "input_language"
    private const val KEY_NUMBER_ROW = "number_row"
    private const val KEY_COMMA = "comma_key"
    private const val KEY_FULL_STOP = "full_stop_key"
    private const val KEY_AUTO_CAP = "auto_capitalisation"
    private const val KEY_DOUBLE_SPACE = "double_space_period"
    private const val KEY_AUTO_SPACE_PUNCT = "auto_space_punctuation"
    private const val KEY_TOOLBAR = "ana_toolbar"
    private const val KEY_THEME = "keyboard_theme"
    private const val KEY_BACKGROUND_URI = "background_uri"
    private const val KEY_BACKGROUND_TINT = "background_tint_percent"
    private const val KEY_WORD_SUGGESTIONS = "word_suggestions"
    private const val KEY_AUTO_CORRECTION = "auto_correction"
    private const val KEY_CLIPBOARD_HISTORY = "clipboard_history"
    private const val KEY_GLIDE_TYPING = "glide_typing"
    private const val KEY_GLIDE_TRAIL = "glide_trail"
    private const val KEY_VOICE_TYPING = "voice_typing"

    val targets = listOf(
        "German" to "DE",
        "English" to "EN",
        "Hinglish" to "HIN"
    )

    val inputLanguages = listOf(
        "English" to "EN",
        "Deutsch" to "DE",
        "Hindi (Hinglish)" to "HIN"
    )

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun baseUrl(context: Context): String = prefs(context).getString(KEY_BASE_URL, "")?.trim().orEmpty()
    fun setBaseUrl(context: Context, value: String) = prefs(context).edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()

    fun hapticEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_HAPTIC, true)
    fun setHapticEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_HAPTIC, enabled).apply()

    fun hapticStrengthMs(context: Context): Int = prefs(context).getInt(KEY_HAPTIC_STRENGTH, 6).coerceIn(1, 25)
    fun setHapticStrengthMs(context: Context, value: Int) = prefs(context).edit().putInt(KEY_HAPTIC_STRENGTH, value.coerceIn(1, 25)).apply()

    fun soundEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SOUND, true)
    fun setSoundEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_SOUND, enabled).apply()

    fun keyPopupEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_POPUP, true)
    fun setKeyPopupEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_POPUP, enabled).apply()

    fun target(context: Context): String = prefs(context).getString(KEY_TARGET, "German") ?: "German"
    fun cycleTarget(context: Context): String {
        val current = target(context)
        val index = targets.indexOfFirst { it.first == current }.let { if (it < 0) 0 else it }
        val next = targets[(index + 1) % targets.size].first
        prefs(context).edit().putString(KEY_TARGET, next).apply()
        return next
    }
    fun targetBadge(context: Context): String = targets.firstOrNull { it.first == target(context) }?.second ?: "DE"

    fun inputLanguage(context: Context): String = prefs(context).getString(KEY_INPUT_LANGUAGE, "English") ?: "English"
    fun setInputLanguage(context: Context, value: String) = prefs(context).edit().putString(KEY_INPUT_LANGUAGE, value).apply()
    fun cycleInputLanguage(context: Context): String {
        val current = inputLanguage(context)
        val index = inputLanguages.indexOfFirst { it.first == current }.let { if (it < 0) 0 else it }
        val next = inputLanguages[(index + 1) % inputLanguages.size].first
        setInputLanguage(context, next)
        return next
    }
    fun inputBadge(context: Context): String = inputLanguages.firstOrNull { it.first == inputLanguage(context) }?.second ?: "EN"

    fun numberRowEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_NUMBER_ROW, true)
    fun setNumberRowEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_NUMBER_ROW, enabled).apply()

    fun commaKeyEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_COMMA, true)
    fun setCommaKeyEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_COMMA, enabled).apply()

    fun fullStopKeyEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_FULL_STOP, true)
    fun setFullStopKeyEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_FULL_STOP, enabled).apply()

    fun autoCapitalisationEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_CAP, true)
    fun setAutoCapitalisationEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_CAP, enabled).apply()

    fun doubleSpacePeriodEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_DOUBLE_SPACE, true)
    fun setDoubleSpacePeriodEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_DOUBLE_SPACE, enabled).apply()

    fun autoSpaceAfterPunctuation(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_SPACE_PUNCT, true)
    fun setAutoSpaceAfterPunctuation(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_SPACE_PUNCT, enabled).apply()

    fun toolbarEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_TOOLBAR, true)
    fun setToolbarEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_TOOLBAR, enabled).apply()

    fun theme(context: Context): String = prefs(context).getString(KEY_THEME, "dark") ?: "dark"
    fun setTheme(context: Context, value: String) = prefs(context).edit().putString(KEY_THEME, value).apply()

    fun backgroundUri(context: Context): String = prefs(context).getString(KEY_BACKGROUND_URI, "") ?: ""
    fun setBackgroundUri(context: Context, value: String) = prefs(context).edit().putString(KEY_BACKGROUND_URI, value).apply()

    fun backgroundTintPercent(context: Context): Int = prefs(context).getInt(KEY_BACKGROUND_TINT, 22).coerceIn(0, 80)
    fun setBackgroundTintPercent(context: Context, value: Int) = prefs(context).edit().putInt(KEY_BACKGROUND_TINT, value.coerceIn(0, 80)).apply()

    fun wordSuggestionsEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_WORD_SUGGESTIONS, true)
    fun setWordSuggestionsEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_WORD_SUGGESTIONS, enabled).apply()

    fun autoCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_CORRECTION, true)
    fun setAutoCorrectionEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_CORRECTION, enabled).apply()

    fun glideTypingEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_GLIDE_TYPING, true)
    fun setGlideTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TYPING, enabled).apply()

    fun glideTrailEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_GLIDE_TRAIL, true)
    fun setGlideTrailEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TRAIL, enabled).apply()

    fun voiceTypingEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_VOICE_TYPING, true)
    fun setVoiceTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_VOICE_TYPING, enabled).apply()

    fun clipboardHistory(context: Context): List<String> {
        val raw = prefs(context).getString(KEY_CLIPBOARD_HISTORY, "[]") ?: "[]"
        return try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val value = array.optString(i).trim()
                    if (value.isNotEmpty()) add(value)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun rememberClipboard(context: Context, text: String) {
        val clean = text.trim().take(800)
        if (clean.isBlank()) return
        val items = clipboardHistory(context).filterNot { it == clean }.toMutableList()
        items.add(0, clean)
        val array = JSONArray()
        items.take(10).forEach { array.put(it) }
        prefs(context).edit().putString(KEY_CLIPBOARD_HISTORY, array.toString()).apply()
    }

    fun clearClipboardHistory(context: Context) = prefs(context).edit().remove(KEY_CLIPBOARD_HISTORY).apply()
}
