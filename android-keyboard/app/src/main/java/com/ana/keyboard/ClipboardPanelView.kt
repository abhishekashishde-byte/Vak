package com.ana.keyboard

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class ClipboardPanelView(context: Context) : LinearLayout(context) {

    interface Listener {
        fun onPaste(text: String)
        fun onBackToLetters()
        fun onClearHistory()
    }

    var listener: Listener? = null
    private val list = LinearLayout(context).apply { orientation = VERTICAL }

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
            text = "Ana reads the clipboard only when you open this panel. Saved clips stay on this device."
            textSize = 11f
            setTextColor(Color.LTGRAY)
            setPadding(dp(8), dp(2), dp(8), dp(6))
        })

        val scroll = ScrollView(context).apply {
            isFillViewport = true
            addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        addView(scroll, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    fun setItems(items: List<String>) {
        list.removeAllViews()
        if (items.isEmpty()) {
            list.addView(TextView(context).apply {
                text = "Clipboard is empty"
                textSize = 15f
                setTextColor(Color.LTGRAY)
                gravity = Gravity.CENTER
                setPadding(dp(12), dp(32), dp(12), dp(16))
            })
            return
        }
        items.take(10).forEach { clip ->
            val button = Button(context).apply {
                text = clip.replace('\n', ' ').take(160)
                isAllCaps = false
                textSize = 14f
                setTextColor(Color.WHITE)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                maxLines = 2
                backgroundTintList = ColorStateList.valueOf(Color.rgb(52, 52, 52))
                setPadding(dp(14), dp(7), dp(14), dp(7))
                setOnClickListener { listener?.onPaste(clip) }
            }
            list.addView(button, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)).apply {
                bottomMargin = dp(6)
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
