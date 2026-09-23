package com.ana.keyboard

import android.content.Context
import android.content.res.Configuration

object KeyboardSizing {
    private const val STORE = "ana_keyboard_settings"
    private const val KEY_SIZE = "keyboard_size" // legacy portrait fallback
    private const val KEY_PORTRAIT_SIZE = "keyboard_size_portrait"
    private const val KEY_LANDSCAPE_SIZE = "keyboard_size_landscape"

    val options = listOf("Small", "Medium", "Large")

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun portraitSize(context: Context): String {
        val legacy = prefs(context).getString(KEY_SIZE, "Medium") ?: "Medium"
        return prefs(context).getString(KEY_PORTRAIT_SIZE, legacy)
            ?.takeIf { it in options } ?: "Medium"
    }

    fun landscapeSize(context: Context): String =
        prefs(context).getString(KEY_LANDSCAPE_SIZE, "Small")
            ?.takeIf { it in options } ?: "Small"

    fun size(context: Context): String =
        if (context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) landscapeSize(context)
        else portraitSize(context)

    fun setSize(context: Context, value: String) {
        if (context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) setLandscapeSize(context, value)
        else setPortraitSize(context, value)
    }

    fun setPortraitSize(context: Context, value: String) {
        val safe = value.takeIf { it in options } ?: "Medium"
        prefs(context).edit().putString(KEY_PORTRAIT_SIZE, safe).putString(KEY_SIZE, safe).apply()
    }

    fun setLandscapeSize(context: Context, value: String) {
        val safe = value.takeIf { it in options } ?: "Small"
        prefs(context).edit().putString(KEY_LANDSCAPE_SIZE, safe).apply()
    }

    fun keyboardHeightDp(context: Context): Int {
        val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        return if (landscape) {
            when (landscapeSize(context)) {
                "Medium" -> 250
                "Large" -> 282
                else -> 222
            }
        } else {
            when (portraitSize(context)) {
                "Small" -> 250
                "Large" -> 350
                else -> 300
            }
        }
    }

    fun bottomSpacerDp(context: Context): Int {
        val landscape = context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        if (landscape) return 18
        return when (portraitSize(context)) {
            "Small" -> 34
            "Large" -> 42
            else -> 38
        }
    }

    fun previewTotalHeightDp(context: Context): Int = keyboardHeightDp(context) + 58
}
