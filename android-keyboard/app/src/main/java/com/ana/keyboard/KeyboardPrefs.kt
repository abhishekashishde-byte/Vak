package com.ana.keyboard

import android.content.Context

object KeyboardPrefs {
    private const val STORE = "ana_keyboard_settings"
    private const val KEY_BASE_URL = "ana_base_url"
    private const val KEY_HAPTIC = "haptic_enabled"
    private const val KEY_SOUND = "sound_enabled"
    private const val KEY_TARGET = "target_language"

    val targets = listOf(
        "German" to "DE",
        "English" to "EN",
        "Hindi" to "HI",
        "Hinglish" to "HIN"
    )

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun baseUrl(context: Context): String = prefs(context).getString(KEY_BASE_URL, "")?.trim().orEmpty()
    fun setBaseUrl(context: Context, value: String) = prefs(context).edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()

    fun hapticEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_HAPTIC, true)
    fun setHapticEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_HAPTIC, enabled).apply()

    fun soundEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SOUND, true)
    fun setSoundEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_SOUND, enabled).apply()

    fun target(context: Context): String = prefs(context).getString(KEY_TARGET, "German") ?: "German"
    fun cycleTarget(context: Context): String {
        val current = target(context)
        val index = targets.indexOfFirst { it.first == current }.let { if (it < 0) 0 else it }
        val next = targets[(index + 1) % targets.size].first
        prefs(context).edit().putString(KEY_TARGET, next).apply()
        return next
    }

    fun targetBadge(context: Context): String = targets.firstOrNull { it.first == target(context) }?.second ?: "DE"
}
