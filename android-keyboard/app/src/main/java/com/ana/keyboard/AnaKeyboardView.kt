package com.ana.keyboard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
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
    private var backgroundBitmap: Bitmap? = null
    private val repeatHandler = Handler(Looper.getMainLooper())

    private val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
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

    fun setBackgroundBitmap(bitmap: Bitmap?) {
        backgroundBitmap = bitmap
        invalidate()
    }

    fun refreshPreferences() {
        placed = emptyList()
        invalidate()
    }

    private fun letterRows(): Triple<String, String, String> = when (KeyboardPrefs.inputBadge(context)) {
        "DE" -> Triple("QWERTZUIOP", "ASDFGHJKL", "YXCVBNM")
        else -> Triple("QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
    }

    private fun rows(): List<List<KeySpec>> {
        if (symbols) return listOf(
            "1234567890".map { KeySpec(it.toString()) },
            listOf("@", "#", "€", "_", "%", "&", "-", "+", "(", ")").map { KeySpec(it) },
            listOf(
                KeySpec("ABC", "ABC", 1.35f), KeySpec("!"), KeySpec("?"), KeySpec(":"), KeySpec(";"),
                KeySpec("/"), KeySpec("'"), KeySpec("\""), KeySpec("⌫", "BACKSPACE", 1.35f)
            ),
            listOf(
                KeySpec("=", "=", 1.15f), KeySpec(","), KeySpec("🌐", "GLOBE", 1.0f),
                KeySpec(KeyboardPrefs.inputBadge(context), "SPACE", 3.7f), KeySpec("."), KeySpec("↵", "ENTER", 1.25f)
            )
        )

        val (r1, r2, r3Letters) = letterRows()
        val result = mutableListOf<List<KeySpec>>()
        if (KeyboardPrefs.numberRowEnabled(context)) result.add("1234567890".map { KeySpec(it.toString()) })
        result.add(r1.map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) })
        result.add(r2.map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) })
        result.add(buildList {
            add(KeySpec(if (shifted) "⇧" else "↑", "SHIFT", 1.35f))
            addAll(r3Letters.map { KeySpec(it.toString(), it.toString().lowercase(), letter = true) })
            add(KeySpec("⌫", "BACKSPACE", 1.35f))
        })
        result.add(buildList {
            add(KeySpec("?123", "SYMBOLS", 1.35f))
            if (KeyboardPrefs.commaKeyEnabled(context)) add(KeySpec(","))
            add(KeySpec("🌐", "GLOBE", 1.0f))
            add(KeySpec(KeyboardPrefs.inputBadge(context), "SPACE", if (KeyboardPrefs.commaKeyEnabled(context) && KeyboardPrefs.fullStopKeyEnabled(context)) 3.5f else 4.3f))
            if (KeyboardPrefs.fullStopKeyEnabled(context)) add(KeySpec("."))
            add(KeySpec("↵", "ENTER", 1.25f))
        })
        return result
    }

    private fun layoutKeys(): List<PlacedKey> {
        val rows = rows()
        val outer = dp(5f)
        val gap = dp(4f)
        val rowGap = dp(5f)
        val previewReserve = if (KeyboardPrefs.keyPopupEnabled(context)) dp(40f) else dp(4f)
        val availableHeight = height - outer * 2 - previewReserve - rowGap * (rows.size - 1)
        val rowHeight = max(dp(38f), availableHeight / rows.size)
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

    private fun canPreview(key: KeySpec): Boolean = KeyboardPrefs.keyPopupEnabled(context) && key.code.length == 1

    private data class Palette(val background: Int, val normalKey: Int, val specialKey: Int, val pressedKey: Int, val text: Int, val preview: Int)

    private fun palette(): Palette = when (KeyboardPrefs.theme(context)) {
        "light" -> Palette(
            Color.rgb(225, 228, 232), Color.argb(238, 250, 250, 250), Color.argb(238, 205, 209, 215),
            Color.rgb(185, 190, 198), Color.rgb(25, 25, 25), Color.rgb(210, 214, 220)
        )
        "midnight" -> Palette(
            Color.BLACK, Color.argb(220, 28, 28, 30), Color.argb(230, 43, 43, 46),
            Color.rgb(78, 78, 82), Color.WHITE, Color.rgb(48, 55, 59)
        )
        "gold" -> Palette(
            Color.rgb(17, 17, 17), Color.argb(225, 48, 48, 48), Color.argb(235, 63, 59, 46),
            Color.rgb(118, 96, 46), Color.WHITE, Color.rgb(102, 82, 38)
        )
        else -> Palette(
            Color.rgb(26, 26, 26), Color.argb(228, 54, 54, 54), Color.argb(235, 66, 66, 66),
            Color.rgb(88, 88, 88), Color.WHITE, Color.rgb(62, 72, 76)
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val colors = palette()
        canvas.drawColor(colors.background)
        drawBackgroundImage(canvas)
        placed = layoutKeys()

        placed.forEach { item ->
            val pressed = active?.key == item.key && active?.rect == item.rect
            val special = item.key.code.length > 1 && item.key.code !in setOf("SPACE")
            keyPaint.color = when {
                pressed -> colors.pressedKey
                special -> colors.specialKey
                else -> colors.normalKey
            }
            canvas.drawRoundRect(item.rect, dp(7f), dp(7f), keyPaint)

            val label = displayLabel(item.key)
            textPaint.textSize = if (label.length > 4) dp(13f) else dp(20f)
            textPaint.color = colors.text
            val baseline = item.rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            canvas.drawText(label, item.rect.centerX(), baseline, textPaint)
        }

        active?.takeIf { canPreview(it.key) }?.let { drawKeyPreview(canvas, it, colors) }
    }

    private fun drawBackgroundImage(canvas: Canvas) {
        val bitmap = backgroundBitmap ?: return
        if (bitmap.width <= 0 || bitmap.height <= 0 || width <= 0 || height <= 0) return
        val sourceAspect = bitmap.width.toFloat() / bitmap.height
        val targetAspect = width.toFloat() / height
        val src = if (sourceAspect > targetAspect) {
            val cropWidth = (bitmap.height * targetAspect).toInt()
            val left = (bitmap.width - cropWidth) / 2
            Rect(left, 0, left + cropWidth, bitmap.height)
        } else {
            val cropHeight = (bitmap.width / targetAspect).toInt()
            val top = (bitmap.height - cropHeight) / 2
            Rect(0, top, bitmap.width, top + cropHeight)
        }
        canvas.drawBitmap(bitmap, src, Rect(0, 0, width, height), imagePaint)
        keyPaint.color = Color.argb(55, 0, 0, 0)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), keyPaint)
    }

    private fun drawKeyPreview(canvas: Canvas, item: PlacedKey, colors: Palette) {
        val previewWidth = max(dp(58f), item.rect.width() * 1.35f)
        val previewHeight = dp(62f)
        val overlap = dp(8f)
        val desiredLeft = item.rect.centerX() - previewWidth / 2f
        val left = desiredLeft.coerceIn(dp(3f), width - previewWidth - dp(3f))
        val bottom = item.rect.top + overlap
        val top = max(dp(2f), bottom - previewHeight)
        val popup = RectF(left, top, left + previewWidth, bottom)

        keyPaint.color = colors.preview
        canvas.drawRoundRect(popup, dp(13f), dp(13f), keyPaint)

        textPaint.textSize = dp(34f)
        textPaint.color = colors.text
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
