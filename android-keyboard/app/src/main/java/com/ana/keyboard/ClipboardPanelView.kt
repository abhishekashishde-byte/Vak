package com.ana.keyboard

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class ClipboardPanelView(context: Context) : LinearLayout(context) {

    interface Listener {
        fun onPaste(text: String)
        fun onBackToLetters()
        fun onClearHistory()
        fun onTogglePin(text: String)
        fun onDelete(text: String)
    }

    var listener: Listener? = null
    private val list = LinearLayout(context).apply { orientation = VERTICAL }
    private var allItems = emptyList<KeyboardPrefs.ClipboardItem>()
    private var query = ""

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(25, 25, 25))
        setPadding(dp(8), dp(8), dp(8), dp(8))

        val header = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(action("ABC") { listener?.onBackToLetters() })
        header.addView(TextView(context).apply {
            text = "Clipboard"
            textSize = 17f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(12), 0)
        }, LayoutParams(0, dp(44), 1f))
        header.addView(action("Clear") { listener?.onClearHistory() })
        addView(header, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        addView(TextView(context).apply {
            text = "Ana reads the clipboard only when you open this panel. Unpinned clips expire after 1 hour; pinned clips stay on this device."
            textSize = 11f
            setTextColor(Color.LTGRAY)
            setPadding(dp(8), dp(2), dp(8), dp(6))
        })

        val search = EditText(context).apply {
            hint = "Search clipboard"
            setHintTextColor(Color.GRAY)
            setTextColor(Color.WHITE)
            isSingleLine = true
            textSize = 13f
            setPadding(dp(12), dp(7), dp(12), dp(7))
            backgroundTintList = ColorStateList.valueOf(Color.rgb(82, 82, 82))
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    query = s?.toString().orEmpty().trim()
                    renderItems()
                }
                override fun afterTextChanged(s: android.text.Editable?) = Unit
            })
        }
        addView(search, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
            bottomMargin = dp(6)
        })

        val scroll = ScrollView(context).apply {
            isFillViewport = true
            addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        addView(scroll, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    fun setItems(items: List<KeyboardPrefs.ClipboardItem>) {
        allItems = items
        renderItems()
    }

    private fun renderItems() {
        list.removeAllViews()
        val filtered = allItems.filter {
            query.isBlank() || it.text.contains(query, ignoreCase = true)
        }
        if (filtered.isEmpty()) {
            list.addView(TextView(context).apply {
                text = if (query.isBlank()) "Clipboard is empty" else "No clipboard matches"
                textSize = 15f
                setTextColor(Color.LTGRAY)
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(32), dp(12), dp(16))
            })
            return
        }

        val pinned = filtered.filter { it.pinned }
        val recent = filtered.filterNot { it.pinned }
        if (pinned.isNotEmpty()) addSection("Pinned", pinned)
        if (recent.isNotEmpty()) addSection("Recent", recent)
    }

    private fun addSection(title: String, items: List<KeyboardPrefs.ClipboardItem>) {
        list.addView(TextView(context).apply {
            text = title
            textSize = 11f
            setTextColor(Color.LTGRAY)
            setPadding(dp(5), dp(7), dp(5), dp(5))
        })
        items.take(20).forEach { clip ->
            val row = LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val button = Button(context).apply {
                text = clip.text.replace('\n', ' ').take(160)
                isAllCaps = false
                textSize = 14f
                setTextColor(Color.WHITE)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                maxLines = 2
                backgroundTintList = ColorStateList.valueOf(Color.rgb(52, 52, 52))
                setPadding(dp(14), dp(7), dp(14), dp(7))
                setOnClickListener { listener?.onPaste(clip.text) }
            }
            row.addView(button, LayoutParams(0, dp(58), 1f))
            row.addView(action(if (clip.pinned) "Unpin" else "Pin") { listener?.onTogglePin(clip.text) }, LayoutParams(dp(70), dp(48)).apply {
                marginStart = dp(5)
            })
            row.addView(action("×") { listener?.onDelete(clip.text) }, LayoutParams(dp(48), dp(48)).apply {
                marginStart = dp(4)
            })
            list.addView(row, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)).apply {
                bottomMargin = dp(4)
            })
        }
    }

    private fun action(label: String, onClick: () -> Unit): Button = Button(context).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(Color.WHITE)
        minWidth = 0
        minimumWidth = 0
        backgroundTintList = ColorStateList.valueOf(Color.rgb(55, 55, 55))
        setOnClickListener { onClick() }
        layoutParams = LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42))
    }
}
