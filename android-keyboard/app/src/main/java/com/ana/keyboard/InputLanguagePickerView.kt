package com.ana.keyboard

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

class InputLanguagePickerView(context: Context) : LinearLayout(context) {
    interface Listener {
        fun onLanguageSelected(name: String)
        fun onBackToKeyboard()
    }

    var listener: Listener? = null

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(26, 26, 26))
        setPadding(dp(10), dp(8), dp(10), dp(8))
        addView(header())
        KeyboardPrefs.inputLanguages.forEach { (name, internalBadge) ->
            val displayBadge = if (internalBadge == "HIN") "IN" else internalBadge
            addView(languageRow(name, displayBadge))
        }
    }

    fun refresh() {
        removeAllViews()
        addView(header())
        KeyboardPrefs.inputLanguages.forEach { (name, internalBadge) ->
            val displayBadge = if (internalBadge == "HIN") "IN" else internalBadge
            addView(languageRow(name, displayBadge))
        }
    }

    private fun header(): View = LinearLayout(context).apply {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(TextView(context).apply {
            text = "‹"
            textSize = 32f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setOnClickListener { listener?.onBackToKeyboard() }
        }, LayoutParams(dp(48), dp(48)))
        addView(TextView(context).apply {
            text = "Keyboard language"
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }, LayoutParams(0, dp(48), 1f))
    }

    private fun languageRow(name: String, badge: String): View {
        val selected = KeyboardPrefs.inputLanguage(context) == name
        return LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(12), 0)
            setOnClickListener { listener?.onLanguageSelected(name) }

            addView(TextView(context).apply {
                text = badge
                textSize = 15f
                setTextColor(Color.LTGRAY)
                gravity = Gravity.CENTER
            }, LayoutParams(dp(54), dp(54)))

            addView(TextView(context).apply {
                text = name
                textSize = 17f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER_VERTICAL
            }, LayoutParams(0, dp(54), 1f))

            addView(TextView(context).apply {
                text = if (selected) "✓" else ""
                textSize = 20f
                setTextColor(Color.rgb(230, 181, 65))
                gravity = Gravity.CENTER
            }, LayoutParams(dp(40), dp(54)))
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
