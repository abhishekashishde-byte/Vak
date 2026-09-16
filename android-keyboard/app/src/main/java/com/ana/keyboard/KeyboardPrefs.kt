package com.ana.keyboard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object KeyboardPrefs {
    private const val STORE = "ana_keyboard_settings"
    private const val KEY_BASE_URL = "ana_base_url"
    private const val DEFAULT_BASE_URL = "https://ana-translate.vercel.app"
    private const val KEY_HAPTIC = "haptic_enabled"
    private const val KEY_HAPTIC_STRENGTH = "haptic_strength_ms"
    private const val KEY_SOUND = "sound_enabled"
    private const val KEY_POPUP = "key_popup_enabled"
    private const val KEY_TARGET = "target_language"
    private const val KEY_RECENT_TARGETS = "recent_target_languages"
    private const val KEY_INPUT_LANGUAGE = "input_language"
    private const val KEY_NUMBER_ROW = "number_row"
    private const val KEY_COMMA = "comma_key"
    private const val KEY_FULL_STOP = "full_stop_key"
    private const val KEY_AUTO_CAP = "auto_capitalisation"
    private const val KEY_DOUBLE_SPACE = "double_space_period"
    private const val KEY_AUTO_SPACE_PUNCT = "auto_space_punctuation"
    private const val KEY_TOOLBAR = "ana_toolbar_compact_v2"
    private const val KEY_THEME = "keyboard_theme"
    private const val KEY_BACKGROUND_URI = "background_uri"
    private const val KEY_BACKGROUND_TINT = "background_tint_percent"
    private const val KEY_WORD_SUGGESTIONS = "word_suggestions"
    private const val KEY_AUTO_CORRECTION = "auto_correction"
    private const val KEY_SMART_SENTENCE_CORRECTION = "smart_sentence_correction"
    private const val KEY_CLIPBOARD_HISTORY = "clipboard_history"
    private const val KEY_GLIDE_TYPING = "glide_typing"
    private const val KEY_GLIDE_TRAIL = "glide_trail"
    private const val KEY_VOICE_TYPING = "voice_typing"
    private const val KEY_PERSONAL_DICTIONARY_PREFIX = "personal_dictionary_"
    private const val KEY_LEARNED_CORRECTIONS_PREFIX = "learned_corrections_"
    private const val KEY_PENDING_GIF_URI = "pending_gif_uri"
    private const val KEY_SHORTCUTS_PREFIX = "text_shortcuts_"
    private const val KEY_ONE_HANDED_MODE = "one_handed_mode"
    private const val KEY_ADAPTIVE_TOUCH = "adaptive_touch"
    private const val KEY_TOUCH_CALIBRATION_PREFIX = "touch_calibration_"

    data class TranslationTarget(val name: String, val badge: String)

    val translationTargets = listOf(
        TranslationTarget("German", "DE"),
        TranslationTarget("English", "EN"),
        TranslationTarget("Hindi", "HI"),
        TranslationTarget("Hinglish", "HIN"),
        TranslationTarget("French", "FR"),
        TranslationTarget("Spanish", "ES"),
        TranslationTarget("Italian", "IT"),
        TranslationTarget("Dutch", "NL"),
        TranslationTarget("Polish", "PL"),
        TranslationTarget("Portuguese", "PT"),
        TranslationTarget("Turkish", "TR"),
        TranslationTarget("Arabic", "AR"),
        TranslationTarget("Chinese", "ZH"),
        TranslationTarget("Japanese", "JA"),
        TranslationTarget("Korean", "KO"),
        TranslationTarget("Russian", "RU"),
        TranslationTarget("Ukrainian", "UK"),
        TranslationTarget("Swedish", "SV"),
        TranslationTarget("Danish", "DA"),
        TranslationTarget("Norwegian", "NO"),
        TranslationTarget("Czech", "CS"),
        TranslationTarget("Greek", "EL"),
        TranslationTarget("Romanian", "RO")
    )

    val targets: List<Pair<String, String>> = translationTargets.map { it.name to it.badge }

    val inputLanguages = listOf(
        "English" to "EN",
        "Deutsch" to "DE",
        "Hindi (Hinglish)" to "HIN"
    )

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun baseUrl(context: Context): String =
        prefs(context).getString(KEY_BASE_URL, DEFAULT_BASE_URL)?.trim().orEmpty().ifBlank { DEFAULT_BASE_URL }
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

    fun setTarget(context: Context, value: String) {
        val safe = translationTargets.firstOrNull { it.name == value }?.name ?: "German"
        prefs(context).edit().putString(KEY_TARGET, safe).apply()
        rememberRecentTarget(context, safe)
    }

    fun cycleTarget(context: Context): String {
        val current = target(context)
        val index = translationTargets.indexOfFirst { it.name == current }.let { if (it < 0) 0 else it }
        val next = translationTargets[(index + 1) % translationTargets.size].name
        setTarget(context, next)
        return next
    }

    fun targetBadge(context: Context): String = translationTargets.firstOrNull { it.name == target(context) }?.badge ?: "DE"

    fun recentTargets(context: Context): List<String> {
        val raw = prefs(context).getString(KEY_RECENT_TARGETS, "[]") ?: "[]"
        return try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val value = array.optString(i)
                    if (translationTargets.any { it.name == value }) add(value)
                }
            }.distinct().take(5)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun rememberRecentTarget(context: Context, target: String) {
        val items = recentTargets(context).filterNot { it == target }.toMutableList()
        items.add(0, target)
        val array = JSONArray()
        items.take(5).forEach { array.put(it) }
        prefs(context).edit().putString(KEY_RECENT_TARGETS, array.toString()).apply()
    }

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
    fun inputDisplayBadge(context: Context): String = if (inputBadge(context) == "HIN") "IN" else inputBadge(context)

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

    // Compact toolbar now contains only the useful Ana actions (Translate, Write, clipboard, mic, target language).
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

    fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, false)
    fun setSmartSentenceCorrectionEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_SMART_SENTENCE_CORRECTION, enabled).apply()

    fun glideTypingEnabled(context: Context): Boolean = false // Temporarily paused: typing stability takes priority.
    fun setGlideTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TYPING, enabled).apply()

    fun glideTrailEnabled(context: Context): Boolean = false // Glide is temporarily paused.
    fun setGlideTrailEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TRAIL, enabled).apply()

    fun voiceTypingEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_VOICE_TYPING, true)
    fun setVoiceTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_VOICE_TYPING, enabled).apply()

    fun personalDictionary(context: Context, badge: String = inputBadge(context)): List<String> {
        val raw = prefs(context).getString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, "[]") ?: "[]"
        return try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val word = array.optString(i).trim()
                    if (word.isNotBlank()) add(word)
                }
            }.distinctBy { it.lowercase() }.sortedBy { it.lowercase() }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun addPersonalWord(context: Context, word: String, badge: String = inputBadge(context)) {
        val clean = word.trim().take(60)
        if (clean.isBlank()) return
        val words = personalDictionary(context, badge).filterNot { it.equals(clean, ignoreCase = true) }.toMutableList()
        words.add(clean)
        val array = JSONArray()
        words.sortedBy { it.lowercase() }.forEach { array.put(it) }
        prefs(context).edit().putString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, array.toString()).apply()
    }

    fun removePersonalWord(context: Context, word: String, badge: String = inputBadge(context)) {
        val array = JSONArray()
        personalDictionary(context, badge).filterNot { it.equals(word, ignoreCase = true) }.forEach { array.put(it) }
        prefs(context).edit().putString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, array.toString()).apply()
    }

    fun learnedCorrections(context: Context, badge: String = inputBadge(context)): Map<String, String> {
        val raw = prefs(context).getString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, "{}") ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val source = keys.next()
                    val replacement = json.optString(source).trim()
                    if (source.isNotBlank() && replacement.isNotBlank()) put(source, replacement)
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun learnCorrection(context: Context, source: String, replacement: String, badge: String = inputBadge(context)) {
        val from = source.trim().lowercase().take(60)
        val to = replacement.trim().lowercase().take(60)
        if (from.length < 2 || to.length < 2 || from == to) return
        val json = JSONObject()
        learnedCorrections(context, badge).forEach { (key, value) -> json.put(key, value) }
        json.put(from, to)
        prefs(context).edit().putString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, json.toString()).apply()
    }

    fun removeLearnedCorrection(context: Context, source: String, badge: String = inputBadge(context)) {
        val json = JSONObject()
        learnedCorrections(context, badge).filterKeys { !it.equals(source, ignoreCase = true) }
            .forEach { (key, value) -> json.put(key, value) }
        prefs(context).edit().putString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, json.toString()).apply()
    }

    fun clearLearnedCorrections(context: Context, badge: String = inputBadge(context)) =
        prefs(context).edit().remove(KEY_LEARNED_CORRECTIONS_PREFIX + badge).apply()

    fun textShortcuts(context: Context, badge: String = inputBadge(context)): Map<String, String> {
        val raw = prefs(context).getString(KEY_SHORTCUTS_PREFIX + badge, "{}") ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val trigger = keys.next().trim()
                    val expansion = json.optString(trigger).trim()
                    if (trigger.isNotBlank() && expansion.isNotBlank()) put(trigger, expansion)
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun setTextShortcut(context: Context, trigger: String, expansion: String, badge: String = inputBadge(context)) {
        val key = trigger.trim().take(24)
        val value = expansion.trim().take(500)
        if (key.isBlank() || value.isBlank() || key.any { it.isWhitespace() }) return
        val json = JSONObject()
        textShortcuts(context, badge).forEach { (existing, replacement) -> json.put(existing, replacement) }
        json.put(key, value)
        prefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
    }

    fun removeTextShortcut(context: Context, trigger: String, badge: String = inputBadge(context)) {
        val json = JSONObject()
        textShortcuts(context, badge).filterKeys { it != trigger }.forEach { (key, value) -> json.put(key, value) }
        prefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
    }

    fun oneHandedMode(context: Context): String {
        val value = prefs(context).getString(KEY_ONE_HANDED_MODE, "off") ?: "off"
        return value.takeIf { it in setOf("off", "left", "right") } ?: "off"
    }

    fun setOneHandedMode(context: Context, value: String) {
        val safe = value.takeIf { it in setOf("off", "left", "right") } ?: "off"
        prefs(context).edit().putString(KEY_ONE_HANDED_MODE, safe).apply()
    }

    fun adaptiveTouchEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ADAPTIVE_TOUCH, true)
    fun setAdaptiveTouchEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_ADAPTIVE_TOUCH, enabled).apply()

    data class TouchCalibration(val dx: Float, val dy: Float, val count: Int)

    fun touchCalibration(context: Context, badge: String = inputBadge(context)): Map<String, TouchCalibration> {
        val raw = prefs(context).getString(KEY_TOUCH_CALIBRATION_PREFIX + badge, "{}") ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val item = json.optJSONObject(key) ?: continue
                    val dx = item.optDouble("dx", 0.0).toFloat().coerceIn(-0.10f, 0.10f)
                    val dy = item.optDouble("dy", 0.0).toFloat().coerceIn(-0.10f, 0.10f)
                    val count = item.optInt("count", 0).coerceIn(0, 100000)
                    if (key.length == 1 && count > 0) put(key.lowercase(), TouchCalibration(dx, dy, count))
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun saveTouchCalibration(context: Context, values: Map<String, TouchCalibration>, badge: String = inputBadge(context)) {
        val json = JSONObject()
        values.forEach { (key, value) ->
            if (key.length != 1 || value.count <= 0) return@forEach
            json.put(key.lowercase(), JSONObject().apply {
                put("dx", value.dx.coerceIn(-0.10f, 0.10f).toDouble())
                put("dy", value.dy.coerceIn(-0.10f, 0.10f).toDouble())
                put("count", value.count.coerceIn(1, 100000))
            })
        }
        prefs(context).edit().putString(KEY_TOUCH_CALIBRATION_PREFIX + badge, json.toString()).apply()
    }

    fun clearTouchCalibration(context: Context, badge: String = inputBadge(context)) =
        prefs(context).edit().remove(KEY_TOUCH_CALIBRATION_PREFIX + badge).apply()

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

    fun setPendingGifUri(context: Context, uri: String) = prefs(context).edit().putString(KEY_PENDING_GIF_URI, uri).apply()
    fun consumePendingGifUri(context: Context): String {
        val value = prefs(context).getString(KEY_PENDING_GIF_URI, "").orEmpty()
        if (value.isNotBlank()) prefs(context).edit().remove(KEY_PENDING_GIF_URI).apply()
        return value
    }
}
