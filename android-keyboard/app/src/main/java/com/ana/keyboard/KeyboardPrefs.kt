package com.ana.keyboard

import android.content.Context
import android.content.res.Configuration
import org.json.JSONArray
import org.json.JSONObject

object KeyboardPrefs {
    private const val STORE = "ana_keyboard_settings"
    private const val LEARNING_STORE = "ana_keyboard_learning"
    private const val LEARNING_MIGRATED = "__learning_migrated_v1"
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
    private const val KEY_AUTO_SPACE_SUGGESTION = "auto_space_suggestion"
    private const val KEY_TOOLBAR = "ana_toolbar_compact_v2"
    private const val KEY_THEME = "keyboard_theme"
    private const val KEY_BACKGROUND_URI = "background_uri"
    private const val KEY_BACKGROUND_TINT = "background_tint_percent"
    private const val KEY_WORD_SUGGESTIONS = "word_suggestions"
    private const val KEY_AUTO_CORRECTION = "auto_correction"
    private const val KEY_SMART_SENTENCE_CORRECTION = "smart_sentence_correction"
    private const val KEY_CLIPBOARD_HISTORY = "clipboard_history"
    private const val KEY_INCOGNITO = "incognito_mode"
    private const val CLIPBOARD_TTL_MS = 60L * 60L * 1000L
    private const val KEY_GLIDE_TYPING = "glide_typing"
    private const val KEY_GLIDE_TRAIL = "glide_trail"
    private const val KEY_VOICE_TYPING = "voice_typing"
    private const val KEY_PERSONAL_DICTIONARY_PREFIX = "personal_dictionary_"
    private const val KEY_LEARNED_CORRECTIONS_PREFIX = "learned_corrections_"
    private const val KEY_PENDING_GIF_URI = "pending_gif_uri"
    private const val KEY_SHORTCUTS_PREFIX = "text_shortcuts_"
    private const val KEY_NEXT_WORD_PREFIX = "next_word_model_"
    private const val KEY_APP_AI_BLOCKLIST = "app_ai_blocklist"
    private const val KEY_APP_AI_ALLOWLIST = "app_ai_allowlist"
    private const val KEY_ONE_HANDED_MODE = "one_handed_mode"
    private const val KEY_ONE_HANDED_WIDTH = "one_handed_width_percent"
    private const val KEY_KEY_GAP = "key_gap_dp"
    private const val KEY_KEY_RADIUS = "key_radius_dp"
    private const val KEY_KEY_LABEL_SCALE = "key_label_scale_percent"
    private const val KEY_KEY_BORDERS = "key_borders"
    private const val KEY_SPACEBAR_SCALE = "spacebar_scale_percent"
    private const val KEY_ADAPTIVE_TOUCH = "adaptive_touch"
    private const val KEY_TOUCH_CALIBRATION_PREFIX = "touch_calibration_"

    data class TranslationTarget(val name: String, val badge: String)
    data class ClipboardItem(val text: String, val pinned: Boolean = false, val createdAt: Long = System.currentTimeMillis())

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
    private fun learningPrefs(context: Context) = context.getSharedPreferences(LEARNING_STORE, Context.MODE_PRIVATE)

    /**
     * One-time migration from the legacy all-in-one preference file.
     * Keeping learning in its own file lets Android back up corrections without
     * backing up clipboard history or other transient keyboard data.
     */
    fun migrateLearningStore(context: Context) {
        val target = learningPrefs(context)
        if (target.getBoolean(LEARNING_MIGRATED, false)) return

        val source = prefs(context)
        val editor = target.edit()
        val prefixes = listOf(
            KEY_PERSONAL_DICTIONARY_PREFIX,
            KEY_LEARNED_CORRECTIONS_PREFIX,
            KEY_SHORTCUTS_PREFIX,
            KEY_TOUCH_CALIBRATION_PREFIX
        )
        source.all.forEach { (key, value) ->
            if (prefixes.none { key.startsWith(it) }) return@forEach
            when (value) {
                is String -> editor.putString(key, value)
                is Boolean -> editor.putBoolean(key, value)
                is Int -> editor.putInt(key, value)
                is Long -> editor.putLong(key, value)
                is Float -> editor.putFloat(key, value)
                is Set<*> -> editor.putStringSet(key, value.filterIsInstance<String>().toSet())
            }
        }
        editor.putBoolean(LEARNING_MIGRATED, true).apply()
    }

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

    fun commaKeyEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_COMMA, false)
    fun setCommaKeyEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_COMMA, enabled).apply()

    fun fullStopKeyEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_FULL_STOP, true)
    fun setFullStopKeyEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_FULL_STOP, enabled).apply()

    fun autoCapitalisationEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_CAP, true)
    fun setAutoCapitalisationEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_CAP, enabled).apply()

    fun doubleSpacePeriodEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_DOUBLE_SPACE, true)
    fun setDoubleSpacePeriodEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_DOUBLE_SPACE, enabled).apply()

    fun autoSpaceAfterPunctuation(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_SPACE_PUNCT, true)
    fun setAutoSpaceAfterPunctuation(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_SPACE_PUNCT, enabled).apply()

    fun autoSpaceAfterSuggestion(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_SPACE_SUGGESTION, true)
    fun setAutoSpaceAfterSuggestion(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_AUTO_SPACE_SUGGESTION, enabled).apply()

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

    fun incognitoEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_INCOGNITO, false)
    fun setIncognitoEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_INCOGNITO, enabled).apply()
    fun toggleIncognito(context: Context): Boolean {
        val next = !incognitoEnabled(context)
        setIncognitoEnabled(context, next)
        return next
    }

    fun glideTypingEnabled(context: Context): Boolean = false // Temporarily paused: typing stability takes priority.
    fun setGlideTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TYPING, enabled).apply()

    fun glideTrailEnabled(context: Context): Boolean = false // Glide is temporarily paused.
    fun setGlideTrailEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_GLIDE_TRAIL, enabled).apply()

    fun voiceTypingEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_VOICE_TYPING, true)
    fun setVoiceTypingEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_VOICE_TYPING, enabled).apply()

    fun personalDictionary(context: Context, badge: String = inputBadge(context)): List<String> {
        val raw = learningPrefs(context).getString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, "[]") ?: "[]"
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

    fun addPersonalWord(
        context: Context,
        word: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val clean = word.trim().take(60)
        if (clean.isBlank()) return
        val words = personalDictionary(context, badge).filterNot { it.equals(clean, ignoreCase = true) }.toMutableList()
        words.add(clean)
        val array = JSONArray()
        words.sortedBy { it.lowercase() }.forEach { array.put(it) }
        learningPrefs(context).edit().putString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, array.toString()).apply()
        if (sync) KeyboardLearningSync.recordPersonalWord(context, badge, clean, false)
    }

    fun removePersonalWord(
        context: Context,
        word: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val clean = word.trim().take(60)
        val array = JSONArray()
        personalDictionary(context, badge).filterNot { it.equals(clean, ignoreCase = true) }.forEach { array.put(it) }
        learningPrefs(context).edit().putString(KEY_PERSONAL_DICTIONARY_PREFIX + badge, array.toString()).apply()
        if (sync && clean.isNotBlank()) KeyboardLearningSync.recordPersonalWord(context, badge, clean, true)
    }

    fun learnedCorrections(context: Context, badge: String = inputBadge(context)): Map<String, String> {
        val raw = learningPrefs(context).getString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, "{}") ?: "{}"
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

    fun learnCorrection(
        context: Context,
        source: String,
        replacement: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val from = source.trim().lowercase().take(60)
        val to = replacement.trim().lowercase().take(60)
        if (from.length < 2 || to.length < 2 || from == to) return
        val json = JSONObject()
        learnedCorrections(context, badge).forEach { (key, value) -> json.put(key, value) }
        json.put(from, to)
        learningPrefs(context).edit().putString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, json.toString()).apply()
        if (sync) KeyboardLearningSync.recordCorrection(context, badge, from, to, false)
    }

    fun removeLearnedCorrection(
        context: Context,
        source: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val clean = source.trim().lowercase().take(60)
        val json = JSONObject()
        learnedCorrections(context, badge).filterKeys { !it.equals(clean, ignoreCase = true) }
            .forEach { (key, value) -> json.put(key, value) }
        learningPrefs(context).edit().putString(KEY_LEARNED_CORRECTIONS_PREFIX + badge, json.toString()).apply()
        if (sync && clean.isNotBlank()) KeyboardLearningSync.recordCorrection(context, badge, clean, null, true)
    }

    fun clearLearnedCorrections(
        context: Context,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        if (sync) {
            learnedCorrections(context, badge).keys.forEach {
                KeyboardLearningSync.recordCorrection(context, badge, it, null, true)
            }
        }
        learningPrefs(context).edit().remove(KEY_LEARNED_CORRECTIONS_PREFIX + badge).apply()
    }

    fun textShortcuts(context: Context, badge: String = inputBadge(context)): Map<String, String> {
        val raw = learningPrefs(context).getString(KEY_SHORTCUTS_PREFIX + badge, "{}") ?: "{}"
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

    fun setTextShortcut(
        context: Context,
        trigger: String,
        expansion: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val key = trigger.trim().take(24)
        val value = expansion.trim().take(500)
        if (key.isBlank() || value.isBlank() || key.any { it.isWhitespace() }) return
        val json = JSONObject()
        textShortcuts(context, badge).forEach { (existing, replacement) -> json.put(existing, replacement) }
        json.put(key, value)
        learningPrefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
        if (sync) KeyboardLearningSync.recordShortcut(context, badge, key, value, false)
    }

    fun removeTextShortcut(
        context: Context,
        trigger: String,
        badge: String = inputBadge(context),
        sync: Boolean = true
    ) {
        val key = trigger.trim().take(24)
        val json = JSONObject()
        textShortcuts(context, badge).filterKeys { it != key }.forEach { (existing, value) -> json.put(existing, value) }
        learningPrefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
        if (sync && key.isNotBlank()) KeyboardLearningSync.recordShortcut(context, badge, key, null, true)
    }

    fun nextWordSuggestions(
        context: Context,
        previous: String,
        badge: String = inputBadge(context),
        max: Int = 3
    ): List<String> {
        val key = previous.trim().lowercase().take(40)
        if (key.isBlank()) return emptyList()
        val raw = learningPrefs(context).getString(KEY_NEXT_WORD_PREFIX + badge, "{}") ?: "{}"
        return try {
            val root = JSONObject(raw)
            val values = root.optJSONObject(key) ?: return emptyList()
            buildList {
                val keys = values.keys()
                while (keys.hasNext()) {
                    val next = keys.next()
                    val count = values.optInt(next, 0)
                    if (next.isNotBlank() && count > 0) add(next to count)
                }
            }.sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first })
                .take(max).map { it.first }
        } catch (_: Exception) { emptyList() }
    }

    fun learnNextWord(
        context: Context,
        previous: String,
        next: String,
        badge: String = inputBadge(context)
    ) {
        val from = previous.trim().lowercase().take(40)
        val to = next.trim().lowercase().take(40)
        if (from.length < 2 || to.length < 2 || from == to) return
        val store = learningPrefs(context)
        val prefKey = KEY_NEXT_WORD_PREFIX + badge
        val root = try { JSONObject(store.getString(prefKey, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        val row = root.optJSONObject(from) ?: JSONObject()
        row.put(to, (row.optInt(to, 0) + 1).coerceAtMost(999))
        val ranked = buildList {
            val keys = row.keys()
            while (keys.hasNext()) {
                val word = keys.next()
                val count = row.optInt(word, 0)
                if (word.isNotBlank() && count > 0) add(word to count)
            }
        }.sortedByDescending { it.second }.take(8)
        val compactRow = JSONObject()
        ranked.forEach { (word, count) -> compactRow.put(word, count) }
        root.put(from, compactRow)
        if (root.length() > 180) {
            val keys = buildList {
                val iterator = root.keys()
                while (iterator.hasNext()) add(iterator.next())
            }
            keys.take(root.length() - 180).forEach { root.remove(it) }
        }
        store.edit().putString(prefKey, root.toString()).apply()
    }

    fun aiBlockedApps(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_APP_AI_BLOCKLIST, emptySet())?.toSet() ?: emptySet()

    fun aiAllowedApps(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_APP_AI_ALLOWLIST, emptySet())?.toSet() ?: emptySet()

    private fun looksSensitiveAppPackage(packageName: String): Boolean {
        val value = packageName.lowercase()
        return listOf(
            "bank", "banking", "sparkasse", "dkb", "comdirect", "revolut", "n26",
            "paypal", "wallet", "finanz", "authenticator", "secureid", "tan"
        ).any { value.contains(it) }
    }

    fun aiAllowedForPackage(context: Context, packageName: String?): Boolean {
        val safe = packageName?.trim().orEmpty()
        if (safe.isBlank()) return true
        if (safe in aiAllowedApps(context)) return true
        if (safe in aiBlockedApps(context)) return false
        return !looksSensitiveAppPackage(safe)
    }

    fun setAiAllowedForPackage(context: Context, packageName: String, allowed: Boolean) {
        val safe = packageName.trim()
        if (safe.isBlank()) return
        val blocked = aiBlockedApps(context).toMutableSet()
        val allowedApps = aiAllowedApps(context).toMutableSet()
        if (allowed) {
            blocked.remove(safe)
            allowedApps.add(safe)
        } else {
            allowedApps.remove(safe)
            blocked.add(safe)
        }
        prefs(context).edit()
            .putStringSet(KEY_APP_AI_BLOCKLIST, blocked)
            .putStringSet(KEY_APP_AI_ALLOWLIST, allowedApps)
            .apply()
    }

    fun oneHandedMode(context: Context): String {
        val modern = prefs(context).getString(KEY_ONE_HANDED_MODE, null)
        val legacy = learningPrefs(context).getString(KEY_ONE_HANDED_MODE, "off")
        val value = modern ?: legacy ?: "off"
        return value.takeIf { it in setOf("off", "left", "right") } ?: "off"
    }

    fun setOneHandedMode(context: Context, value: String) {
        val safe = value.takeIf { it in setOf("off", "left", "right") } ?: "off"
        prefs(context).edit().putString(KEY_ONE_HANDED_MODE, safe).apply()
    }

    fun oneHandedWidthPercent(context: Context): Int = prefs(context).getInt(KEY_ONE_HANDED_WIDTH, 78).coerceIn(68, 92)
    fun setOneHandedWidthPercent(context: Context, value: Int) = prefs(context).edit().putInt(KEY_ONE_HANDED_WIDTH, value.coerceIn(68, 92)).apply()

    fun keyGapDp(context: Context): Int = prefs(context).getInt(KEY_KEY_GAP, 5).coerceIn(2, 9)
    fun setKeyGapDp(context: Context, value: Int) = prefs(context).edit().putInt(KEY_KEY_GAP, value.coerceIn(2, 9)).apply()

    fun keyRadiusDp(context: Context): Int = prefs(context).getInt(KEY_KEY_RADIUS, 7).coerceIn(3, 18)
    fun setKeyRadiusDp(context: Context, value: Int) = prefs(context).edit().putInt(KEY_KEY_RADIUS, value.coerceIn(3, 18)).apply()

    fun keyLabelScalePercent(context: Context): Int = prefs(context).getInt(KEY_KEY_LABEL_SCALE, 100).coerceIn(85, 125)
    fun setKeyLabelScalePercent(context: Context, value: Int) = prefs(context).edit().putInt(KEY_KEY_LABEL_SCALE, value.coerceIn(85, 125)).apply()

    fun keyBordersEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_KEY_BORDERS, false)
    fun setKeyBordersEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_KEY_BORDERS, enabled).apply()

    fun spacebarScalePercent(context: Context): Int = prefs(context).getInt(KEY_SPACEBAR_SCALE, 112).coerceIn(90, 135)
    fun setSpacebarScalePercent(context: Context, value: Int) = prefs(context).edit().putInt(KEY_SPACEBAR_SCALE, value.coerceIn(90, 135)).apply()

    fun adaptiveTouchEnabled(context: Context): Boolean = learningPrefs(context).getBoolean(KEY_ADAPTIVE_TOUCH, true)
    fun setAdaptiveTouchEnabled(context: Context, enabled: Boolean) = learningPrefs(context).edit().putBoolean(KEY_ADAPTIVE_TOUCH, enabled).apply()

    data class TouchCalibration(val dx: Float, val dy: Float, val count: Int)

    private fun calibrationKey(context: Context, badge: String): String {
        val orientation = if (context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) "land" else "port"
        return KEY_TOUCH_CALIBRATION_PREFIX + badge + "_" + orientation
    }

    fun touchCalibration(context: Context, badge: String = inputBadge(context)): Map<String, TouchCalibration> {
        val modernKey = calibrationKey(context, badge)
        val store = learningPrefs(context)
        val raw = store.getString(modernKey, null)
            ?: store.getString(KEY_TOUCH_CALIBRATION_PREFIX + badge, "{}")
            ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val item = json.optJSONObject(key) ?: continue
                    val dx = item.optDouble("dx", 0.0).toFloat().coerceIn(-0.16f, 0.16f)
                    val dy = item.optDouble("dy", 0.0).toFloat().coerceIn(-0.16f, 0.16f)
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
                put("dx", value.dx.coerceIn(-0.16f, 0.16f).toDouble())
                put("dy", value.dy.coerceIn(-0.16f, 0.16f).toDouble())
                put("count", value.count.coerceIn(1, 100000))
            })
        }
        learningPrefs(context).edit().putString(calibrationKey(context, badge), json.toString()).apply()
    }

    fun clearTouchCalibration(context: Context, badge: String = inputBadge(context)) {
        learningPrefs(context).edit()
            .remove(KEY_TOUCH_CALIBRATION_PREFIX + badge)
            .remove(KEY_TOUCH_CALIBRATION_PREFIX + badge + "_port")
            .remove(KEY_TOUCH_CALIBRATION_PREFIX + badge + "_land")
            .apply()
    }

    /**
     * Clears only account-synced language data when switching Ana accounts.
     * Device-specific touch calibration is intentionally left untouched.
     */
    fun clearAllSyncedLearning(context: Context) {
        val editor = learningPrefs(context).edit()
        listOf("EN", "DE", "HIN").forEach { badge ->
            editor.remove(KEY_PERSONAL_DICTIONARY_PREFIX + badge)
            editor.remove(KEY_LEARNED_CORRECTIONS_PREFIX + badge)
            editor.remove(KEY_SHORTCUTS_PREFIX + badge)
            editor.remove(KEY_NEXT_WORD_PREFIX + badge)
        }
        editor.apply()
    }

    private fun saveClipboardItems(context: Context, items: List<ClipboardItem>) {
        val array = JSONArray()
        items.take(20).forEach { item ->
            array.put(JSONObject().apply {
                put("text", item.text)
                put("pinned", item.pinned)
                put("createdAt", item.createdAt)
            })
        }
        prefs(context).edit().putString(KEY_CLIPBOARD_HISTORY, array.toString()).apply()
    }

    fun clipboardItems(context: Context): List<ClipboardItem> {
        val raw = prefs(context).getString(KEY_CLIPBOARD_HISTORY, "[]") ?: "[]"
        val now = System.currentTimeMillis()
        val items = try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val item = array.opt(i)
                    when (item) {
                        is JSONObject -> {
                            val text = item.optString("text").trim()
                            val pinned = item.optBoolean("pinned", false)
                            val createdAt = item.optLong("createdAt", now).takeIf { it > 0 } ?: now
                            if (text.isNotBlank() && (pinned || now - createdAt <= CLIPBOARD_TTL_MS)) {
                                add(ClipboardItem(text, pinned, createdAt))
                            }
                        }
                        is String -> {
                            val text = item.trim()
                            if (text.isNotBlank()) add(ClipboardItem(text, false, now))
                        }
                    }
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
        val sorted = items.distinctBy { it.text }.sortedWith(compareByDescending<ClipboardItem> { it.pinned }.thenByDescending { it.createdAt }).take(20)
        saveClipboardItems(context, sorted)
        return sorted
    }

    fun clipboardHistory(context: Context): List<String> = clipboardItems(context).map { it.text }

    fun rememberClipboard(context: Context, text: String) {
        if (incognitoEnabled(context)) return
        val clean = text.trim().take(800)
        if (clean.isBlank()) return
        val existing = clipboardItems(context)
        val previous = existing.firstOrNull { it.text == clean }
        val item = ClipboardItem(clean, previous?.pinned == true, System.currentTimeMillis())
        saveClipboardItems(context, listOf(item) + existing.filterNot { it.text == clean })
    }

    fun toggleClipboardPin(context: Context, text: String) {
        val clean = text.trim()
        if (clean.isBlank()) return
        val items = clipboardItems(context).map { item ->
            if (item.text == clean) item.copy(pinned = !item.pinned) else item
        }
        saveClipboardItems(context, items)
    }

    /** Clear transient clips while preserving anything the user explicitly pinned. */
    fun clearClipboardHistory(context: Context) = saveClipboardItems(context, clipboardItems(context).filter { it.pinned })

    fun setPendingGifUri(context: Context, uri: String) = prefs(context).edit().putString(KEY_PENDING_GIF_URI, uri).apply()
    fun consumePendingGifUri(context: Context): String {
        val value = prefs(context).getString(KEY_PENDING_GIF_URI, "").orEmpty()
        if (value.isNotBlank()) prefs(context).edit().remove(KEY_PENDING_GIF_URI).apply()
        return value
    }
}
