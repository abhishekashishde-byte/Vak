package com.ana.keyboard

import android.content.Context

object KeyboardSizing {
    private const val STORE = "ana_keyboard_settings"
    private const val KEY_SIZE = "keyboard_size"

    val options = listOf("Small", "Medium", "Large")

    fun size(context: Context): String =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .getString(KEY_SIZE, "Medium") ?: "Medium"

    fun setSize(context: Context, value: String) {
        val safe = value.takeIf { it in options } ?: "Medium"
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .edit().putString(KEY_SIZE, safe).apply()
    }

    fun keyboardHeightDp(context: Context): Int = when (size(context)) {
        "Small" -> 250
        "Large" -> 350
        else -> 300
    }

    fun bottomSpacerDp(context: Context): Int = when (size(context)) {
        "Small" -> 34
        "Large" -> 42
        else -> 38
    }

    fun previewTotalHeightDp(context: Context): Int = keyboardHeightDp(context) + 58
}
