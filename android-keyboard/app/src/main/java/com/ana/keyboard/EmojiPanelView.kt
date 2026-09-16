package com.ana.keyboard

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class EmojiPanelView(context: Context) : LinearLayout(context) {

    interface Listener {
        fun onEmoji(emoji: String)
        fun onGifRequested()
        fun onBackToLetters()
    }

    var listener: Listener? = null

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private val emojis = listOf(
        "😀","😃","😄","😁","😆","😅","😂","🤣",
        "😊","😇","🙂","🙃","😉","😌","😍","🥰",
        "😘","😗","😙","😚","😋","😛","😝","😜",
        "🤪","🤨","🧐","🤓","😎","🥳","😏","😒",
        "😞","😔","😟","😕","🙁","☹️","😣","😖",
        "😫","😩","🥺","😢","😭","😤","😠","😡",
        "🤬","🤯","😳","🥵","🥶","😱","😨","😰",
        "😥","😓","🤗","🤔","🫡","🤭","🤫","🤥",
        "😶","😐","😑","😬","🙄","😯","😦","😧",
        "👍","👎","👏","🙌","🙏","👌","✌️","🤞",
        "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
        "💯","✨","🎉","🔥","🌟","✅","❌","💡"
    )

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.rgb(26, 26, 26))
        addView(buildTopBar(), LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)))

        val scroll = ScrollView(context).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
        }
        val content = LinearLayout(context).apply {
            orientation = VERTICAL
            setPadding(dp(6), dp(4), dp(6), dp(8))
        }
        emojis.chunked(8).forEach { rowItems ->
            val row = LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER
            }
            rowItems.forEach { emoji ->
                row.addView(emojiButton(emoji), LayoutParams(0, dp(50), 1f))
            }
            repeat(8 - rowItems.size) {
                row.addView(TextView(context), LayoutParams(0, dp(50), 1f))
            }
            content.addView(row)
        }
        scroll.addView(content)
        addView(scroll, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    private fun buildTopBar(): LinearLayout = LinearLayout(context).apply {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(6), dp(4), dp(6), dp(4))
        addView(topButton("ABC") { listener?.onBackToLetters() }, LayoutParams(0, dp(42), 1f))
        addView(TextView(context).apply {
            text = "Smileys"
            textSize = 16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LayoutParams(0, dp(42), 2f))
        addView(topButton("GIF") { listener?.onGifRequested() }, LayoutParams(0, dp(42), 1f))
    }

    private fun emojiButton(emoji: String): Button = Button(context).apply {
        text = emoji
        textSize = 23f
        isAllCaps = false
        minWidth = 0
        minimumWidth = 0
        setPadding(0, 0, 0, 0)
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { listener?.onEmoji(emoji) }
    }

    private fun topButton(label: String, onClick: () -> Unit): Button = Button(context).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        minWidth = 0
        minimumWidth = 0
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.rgb(55, 55, 55))
        setOnClickListener { onClick() }
    }
}
