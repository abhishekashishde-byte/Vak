package com.ana.keyboard

import android.content.Context
import android.graphics.Color
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class TranslationLanguagePickerView(context: Context) : LinearLayout(context) {

    interface Listener {
        fun onLanguageSelected(name: String)
        fun onBackToKeyboard()
    }

    var listener: Listener? = null
    private val list = LinearLayout(context).apply { orientation = VERTICAL }
    private val search = EditText(context).apply {
        hint = "Search language"
        setHintTextColor(Color.GRAY)
        setTextColor(Color.WHITE)
        textSize = 16f
        isSingleLine = true
        setPadding(dp(14), dp(8), dp(14), dp(8))
        setBackgroundColor(Color.rgb(45, 45, 47))
    }

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(26, 26, 26))

        val header = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        header.addView(TextView(context).apply {
            text = "‹"
            textSize = 32f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setOnClickListener { listener?.onBackToKeyboard() }
        }, LayoutParams(dp(46), dp(44)))
        header.addView(TextView(context).apply {
            text = "Translate to"
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }, LayoutParams(0, dp(44), 1f))
        addView(header)

        addView(search, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
            marginStart = dp(10)
            marginEnd = dp(10)
            bottomMargin = dp(6)
        })

        val scroll = ScrollView(context).apply {
            isVerticalScrollBarEnabled = false
            addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        addView(scroll, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = render(s?.toString().orEmpty())
            override fun afterTextChanged(s: Editable?) = Unit
        })
        render("")
    }

    fun refresh() {
        search.setText("")
        render("")
    }

    private fun render(query: String) {
        list.removeAllViews()
        val q = query.trim().lowercase()
        val all = KeyboardPrefs.translationTargets
        val recentNames = if (q.isBlank()) KeyboardPrefs.recentTargets(context) else emptyList()

        if (recentNames.isNotEmpty()) {
            section("Recent")
            recentNames.mapNotNull { name -> all.firstOrNull { it.name == name } }
                .forEach { addLanguage(it) }
            section("All languages")
        }

        all.filter { q.isBlank() || it.name.lowercase().contains(q) || it.badge.lowercase().contains(q) }
            .forEach { addLanguage(it) }
    }

    private fun section(label: String) {
        list.addView(TextView(context).apply {
            text = label
            textSize = 12f
            setTextColor(Color.LTGRAY)
            setPadding(dp(14), dp(9), dp(14), dp(4))
        })
    }

    private fun addLanguage(target: KeyboardPrefs.TranslationTarget) {
        val selected = KeyboardPrefs.target(context) == target.name
        val row = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), 0, dp(14), 0)
            isClickable = true
            isFocusable = true
            setOnClickListener { listener?.onLanguageSelected(target.name) }
        }
        row.addView(TextView(context).apply {
            text = target.badge
            textSize = 13f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
        }, LayoutParams(dp(48), dp(42)))
        row.addView(TextView(context).apply {
            text = target.name
            textSize = 16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }, LayoutParams(0, dp(42), 1f))
        row.addView(TextView(context).apply {
            text = if (selected) "✓" else ""
            textSize = 19f
            setTextColor(Color.rgb(230, 181, 65))
            gravity = Gravity.CENTER
        }, LayoutParams(dp(36), dp(42)))
        list.addView(row)
        list.addView(View(context).apply { setBackgroundColor(Color.rgb(48, 48, 50)) }, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
