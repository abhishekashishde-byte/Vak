package com.ana.keyboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.max

class AnaKeyboardView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    interface Listener {
        fun onKey(code: String)
        fun onPressFeedback(view: View)
    }

    data class KeySpec(val label: String, val code: String = label, val flex: Float = 1f, val letter: Boolean = false)
    data class PlacedKey(val key: KeySpec, val rect: RectF)

    var listener: Listener? = null
    private var shifted = false
    private var symbols = false
    private var placed = emptyList<PlacedKey>()
    private var active: PlacedKey? = null
    private var backspaceRepeated = false
    private val repeatHandler = Handler(Looper.getMainLooper())

    private val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL)
    }

    private val repeatBackspace = object : Runnable {
        override fun run() {
            if (active?.key?.code != "BACKSPACE") return
            backspaceRepeated = true
            listener?.onKey("BACKSPACE")
            repeatHandler.postDelayed(this, 55)
        }
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density

    fun setShifted(value: Boolean) {
        if (shifted == value) return
        shifted = value
        invalidate()
    }

    fun isShifted(): Boolean = shifted

    fun setSymbols(value: Boolean) {
        if (symbols == value) return
        symbols = value
        active = null
        invalidate()
    }

    fun isSymbols(): Boolean = symbols

    private fun rows(): List<List<KeySpec>> {
        if (symbols) return listOf(
            "1234567890".map { KeySpec(it.toString()) },
            listOf("@", "#", "€", "_", "%", "&", "-", "+", "(", ")").map { KeySpec(it) },
            listOf(
                KeySpec("ABC", "ABC", 1.35f), KeySpec("!"), KeySpec("?"), KeySpec(":"), KeySpec(";"),
                KeySpec("/"), KeySpec("'"), KeySpec("\""), KeySpec("⌫", "BACKSPACE", 1.35f)
            ),
            listOf(
                KeySpec("=", "=", 1.25f), KeySpec(","), KeySpec("🌐", "GLOBE", 1.05f),
                KeySpec("space", "SPACE", 3.8f), KeySpec("."), KeySpec("↵", "ENTER", 1.25f)
            )
        )

        val row1 = "QWERTYUIOP".map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) }
        val row2 = "ASDFGHJKL".map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) }
        val row3 = buildList {
            add(KeySpec(if (shifted) "⇧" else "↑", "SHIFT", 1.35f))
            addAll("ZXCVBNM".map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) })
            add(KeySpec("⌫", "BACKSPACE", 1.35f))
        }
        val row4 = listOf(
            KeySpec("?123", "SYMBOLS", 1.35f), KeySpec(","), KeySpec("🌐", "GLOBE", 1.0f),
            KeySpec("space", "SPACE", 3.9f), KeySpec("."), KeySpec("↵", "ENTER", 1.25f)
        )
        return listOf(row1, row2, row3, row4)
    }

    private fun layoutKeys(): List<PlacedKey> {
        val rows = rows()
        val outer = dp(5f)
        val gap = dp(4f)
        val rowGap = dp(6f)
        val previewReserve = dp(40f)
        val availableHeight = height - outer * 2 - previewReserve - rowGap * (rows.size - 1)
        val rowHeight = max(dp(42f), availableHeight / rows.size)
        val result = mutableListOf<PlacedKey>()

        rows.forEachIndexed { rowIndex, row ->
            val totalFlex = row.sumOf { it.flex.toDouble() }.toFloat()
            val availableWidth = width - outer * 2 - gap * (row.size - 1)
            var x = outer
            val top = outer + previewReserve + rowIndex * (rowHeight + rowGap)
            row.forEach { key ->
                val w = availableWidth * (key.flex / totalFlex)
                result += PlacedKey(key, RectF(x, top, x + w, top + rowHeight))
                x += w + gap
            }
        }
        return result
    }

    private fun displayLabel(key: KeySpec): String = if (key.letter) {
        if (shifted) key.label.uppercase() else key.label.lowercase()
    } else key.label

    private fun canPreview(key: KeySpec): Boolean = key.code.length == 1

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(26, 26, 26))
        placed = layoutKeys()

        placed.forEach { item ->
            val pressed = active?.key == item.key && active?.rect == item.rect
            val special = item.key.code.length > 1 && item.key.code !in setOf("SPACE")
            keyPaint.color = when {
                pressed -> Color.rgb(88, 88, 88)
                special -> Color.rgb(66, 66, 66)
                else -> Color.rgb(54, 54, 54)
            }
            canvas.drawRoundRect(item.rect, dp(7f), dp(7f), keyPaint)

            val label = displayLabel(item.key)
            textPaint.textSize = if (label.length > 4) dp(14f) else dp(20f)
            textPaint.color = Color.WHITE
            val baseline = item.rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            canvas.drawText(label, item.rect.centerX(), baseline, textPaint)
        }

        active?.takeIf { canPreview(it.key) }?.let { drawKeyPreview(canvas, it) }
    }

    private fun drawKeyPreview(canvas: Canvas, item: PlacedKey) {
        val previewWidth = max(dp(58f), item.rect.width() * 1.35f)
        val previewHeight = dp(62f)
        val overlap = dp(8f)
        val desiredLeft = item.rect.centerX() - previewWidth / 2f
        val left = desiredLeft.coerceIn(dp(3f), width - previewWidth - dp(3f))
        val bottom = item.rect.top + overlap
        val top = max(dp(2f), bottom - previewHeight)
        val popup = RectF(left, top, left + previewWidth, bottom)

        keyPaint.color = Color.rgb(62, 72, 76)
        canvas.drawRoundRect(popup, dp(13f), dp(13f), keyPaint)

        textPaint.textSize = dp(34f)
        textPaint.color = Color.WHITE
        val baseline = popup.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f - dp(1f)
        canvas.drawText(displayLabel(item.key), popup.centerX(), baseline, textPaint)
    }

    private fun keyAt(x: Float, y: Float): PlacedKey? = placed.firstOrNull { it.rect.contains(x, y) }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (placed.isEmpty()) placed = layoutKeys()
                active = keyAt(event.x, event.y)
                backspaceRepeated = false
                active?.let {
                    listener?.onPressFeedback(this)
                    if (it.key.code == "BACKSPACE") repeatHandler.postDelayed(repeatBackspace, 380)
                }
                invalidate()
                return active != null
            }
            MotionEvent.ACTION_MOVE -> {
                val next = keyAt(event.x, event.y)
                if (next?.key != active?.key) {
                    repeatHandler.removeCallbacks(repeatBackspace)
                    active = next
                    backspaceRepeated = false
                    active?.let {
                        listener?.onPressFeedback(this)
                        if (it.key.code == "BACKSPACE") repeatHandler.postDelayed(repeatBackspace, 380)
                    }
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                repeatHandler.removeCallbacks(repeatBackspace)
                val released = keyAt(event.x, event.y)
                val selected = active
                if (selected != null && released?.key == selected.key) {
                    if (selected.key.code != "BACKSPACE" || !backspaceRepeated) listener?.onKey(selected.key.code)
                    performClick()
                }
                active = null
                backspaceRepeated = false
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                repeatHandler.removeCallbacks(repeatBackspace)
                active = null
                backspaceRepeated = false
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }
}
