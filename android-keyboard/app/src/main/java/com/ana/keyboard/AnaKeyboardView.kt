package com.ana.keyboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

class AnaKeyboardView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    interface Listener {
        fun onKey(code: String)
        fun onGlide(sequence: String)
        fun onPressFeedback(view: View)
    }

    data class KeySpec(
        val label: String,
        val code: String = label,
        val flex: Float = 1f,
        val letter: Boolean = false
    )

    data class PlacedKey(val key: KeySpec, val rect: RectF, val row: Int)

    data class AlternatePopup(
        val options: List<String>,
        val rect: RectF,
        var selectedIndex: Int = -1
    )

    var listener: Listener? = null

    private var shifted = false
    private var symbols = false
    private var placed = emptyList<PlacedKey>()
    private var active: PlacedKey? = null
    private var backgroundBitmap: Bitmap? = null
    private var alternatePopup: AlternatePopup? = null
    private var backspaceRepeated = false
    private var cachedPalette: Palette? = null

    private val repeatHandler = Handler(Looper.getMainLooper())
    private val longPressHandler = Handler(Looper.getMainLooper())
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    private var downX = 0f
    private var downY = 0f
    private var downAt = 0L
    private var gliding = false
    private val potentialGlidePoints = mutableListOf<Pair<Float, Float>>()
    private val potentialGlideLetters = mutableListOf<String>()
    private val glidePoints = mutableListOf<Pair<Float, Float>>()
    private val glideLetters = mutableListOf<String>()
    private var fadingTrail = emptyList<Pair<Float, Float>>()
    private var trailAlpha = 0
    private var trailAnimator: ValueAnimator? = null

    private val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL)
    }
    private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val repeatBackspace = object : Runnable {
        override fun run() {
            if (active?.key?.code != "BACKSPACE" || gliding) return
            backspaceRepeated = true
            listener?.onKey("BACKSPACE")
            repeatHandler.postDelayed(this, 48)
        }
    }

    private val showAlternates = Runnable {
        if (gliding) return@Runnable
        val current = active ?: return@Runnable
        val options = alternatesFor(current.key) ?: return@Runnable
        alternatePopup = createAlternatePopup(current, options)
        invalidate()
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
        clearPressState()
        placed = emptyList()
        invalidate()
    }

    fun isSymbols(): Boolean = symbols

    fun setBackgroundBitmap(bitmap: Bitmap?) {
        backgroundBitmap = bitmap
        invalidate()
    }

    fun refreshPreferences() {
        placed = emptyList()
        cachedPalette = null
        clearPressState()
        invalidate()
    }

    private fun letterRows(): Triple<String, String, String> = when (KeyboardPrefs.inputBadge(context)) {
        "DE" -> Triple("QWERTZUIOP", "ASDFGHJKL", "YXCVBNM")
        else -> Triple("QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
    }

    private fun rows(): List<List<KeySpec>> {
        if (symbols) {
            return listOf(
                "1234567890".map { KeySpec(it.toString()) },
                listOf("@", "#", "€", "_", "%", "&", "-", "+", "(", ")").map { KeySpec(it) },
                listOf(
                    KeySpec("ABC", "ABC", 1.38f), KeySpec("!"), KeySpec("?"), KeySpec(":"), KeySpec(";"),
                    KeySpec("/"), KeySpec("'"), KeySpec("\""), KeySpec("⌫", "BACKSPACE", 1.42f)
                ),
                listOf(
                    KeySpec("", "EMOJI", 1.0f),
                    KeySpec(",", ",", 0.82f),
                    KeySpec(KeyboardPrefs.inputBadge(context), "SPACE", 4.7f),
                    KeySpec(".", ".", 0.82f),
                    KeySpec("↵", "ENTER", 1.30f)
                )
            )
        }

        val (r1, r2, r3Letters) = letterRows()
        val result = mutableListOf<List<KeySpec>>()
        if (KeyboardPrefs.numberRowEnabled(context)) {
            result.add("1234567890".map { KeySpec(it.toString()) })
        }
        result.add(r1.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
        result.add(r2.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
        result.add(buildList {
            add(KeySpec("", "SHIFT", 1.48f))
            addAll(r3Letters.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
            add(KeySpec("⌫", "BACKSPACE", 1.48f))
        })
        result.add(buildList {
            add(KeySpec("?123", "SYMBOLS", 1.38f))
            if (KeyboardPrefs.commaKeyEnabled(context)) add(KeySpec(",", ",", 0.82f))
            add(KeySpec("", "EMOJI", 0.98f))
            add(
                KeySpec(
                    KeyboardPrefs.inputBadge(context),
                    "SPACE",
                    if (KeyboardPrefs.commaKeyEnabled(context) && KeyboardPrefs.fullStopKeyEnabled(context)) 4.65f else 5.25f
                )
            )
            if (KeyboardPrefs.fullStopKeyEnabled(context)) add(KeySpec(".", ".", 0.82f))
            add(KeySpec("↵", "ENTER", 1.30f))
        })
        return result
    }

    private fun layoutKeys(): List<PlacedKey> {
        if (width <= 0 || height <= 0) return emptyList()
        val rows = rows()
        val outer = dp(5f)
        val gap = dp(3f)
        val rowGap = dp(4f)
        val previewReserve = if (KeyboardPrefs.keyPopupEnabled(context)) dp(39f) else dp(5f)
        val usableHeight = height - outer * 2 - previewReserve - rowGap * (rows.size - 1)
        val rowHeight = max(dp(38f), usableHeight / rows.size)
        val result = mutableListOf<PlacedKey>()

        val numberOffset = if (!symbols && KeyboardPrefs.numberRowEnabled(context)) 1 else 0
        val qRow = if (symbols) -1 else numberOffset
        val aRow = if (symbols) -1 else qRow + 1

        rows.forEachIndexed { rowIndex, row ->
            val inset = when {
                symbols -> 0f
                rowIndex == aRow -> dp(18f)
                else -> 0f
            }
            val leftBound = outer + inset
            val rightBound = width - outer - inset
            val totalFlex = row.sumOf { it.flex.toDouble() }.toFloat()
            val availableWidth = rightBound - leftBound - gap * (row.size - 1)
            var x = leftBound
            val top = outer + previewReserve + rowIndex * (rowHeight + rowGap)

            row.forEach { key ->
                val keyWidth = availableWidth * (key.flex / totalFlex)
                val rect = RectF(x, top, x + keyWidth, top + rowHeight)
                result += PlacedKey(key, rect, rowIndex)
                x += keyWidth + gap
            }
        }
        return result
    }

    private fun displayLabel(key: KeySpec): String = when {
        key.code == "SHIFT" -> if (shifted) "⇧" else "↑"
        key.code == "EMOJI" -> ""
        key.letter && shifted -> key.label.uppercase()
        key.letter -> key.label.lowercase()
        else -> key.label
    }

    private fun canPreview(key: KeySpec): Boolean =
        KeyboardPrefs.keyPopupEnabled(context) && key.code.length == 1 && key.code.firstOrNull()?.isLetterOrDigit() == true

    private fun alternatesFor(key: KeySpec): List<String>? {
        if (!key.letter || symbols) return null
        val variants = when (key.code.lowercase()) {
            "a" -> listOf("ä", "á", "à", "â", "ã", "å", "æ")
            "c" -> listOf("ç", "ć", "č")
            "e" -> listOf("é", "è", "ê", "ë")
            "i" -> listOf("í", "ì", "î", "ï")
            "n" -> listOf("ñ", "ń")
            "o" -> listOf("ö", "ó", "ò", "ô", "õ", "ø", "œ")
            "s" -> listOf("ß", "ś", "š")
            "u" -> listOf("ü", "ú", "ù", "û")
            "y" -> listOf("ÿ", "ý")
            "z" -> listOf("ž", "ź", "ż")
            else -> emptyList()
        }
        if (variants.isEmpty()) return null
        return if (shifted) variants.map { it.uppercase() } else variants
    }

    private fun createAlternatePopup(item: PlacedKey, options: List<String>): AlternatePopup {
        val cell = dp(43f)
        val widthNeeded = (cell * options.size).coerceAtMost(width - dp(8f))
        val desiredLeft = item.rect.centerX() - widthNeeded / 2f
        val left = desiredLeft.coerceIn(dp(4f), width - widthNeeded - dp(4f))
        val bottom = item.rect.top + dp(7f)
        val top = max(dp(2f), bottom - dp(58f))
        return AlternatePopup(options, RectF(left, top, left + widthNeeded, bottom))
    }

    private data class Palette(
        val background: Int,
        val normalKey: Int,
        val specialKey: Int,
        val pressedKey: Int,
        val text: Int,
        val accent: Int
    )

    private fun palette(): Palette {
        cachedPalette?.let { return it }
        val value = when (KeyboardPrefs.theme(context)) {
            "light" -> Palette(
                Color.rgb(225, 228, 232), Color.argb(238, 250, 250, 250), Color.argb(238, 205, 209, 215),
                Color.rgb(183, 189, 198), Color.rgb(25, 25, 25), Color.rgb(65, 115, 245)
            )
            "midnight" -> Palette(
                Color.BLACK, Color.argb(220, 28, 28, 30), Color.argb(230, 43, 43, 46),
                Color.rgb(76, 78, 83), Color.WHITE, Color.rgb(100, 170, 255)
            )
            "gold" -> Palette(
                Color.rgb(17, 17, 17), Color.argb(225, 48, 48, 48), Color.argb(235, 63, 59, 46),
                Color.rgb(118, 96, 46), Color.WHITE, Color.rgb(230, 181, 65)
            )
            else -> Palette(
                Color.rgb(26, 26, 26), Color.argb(228, 54, 54, 54), Color.argb(235, 66, 66, 66),
                Color.rgb(86, 88, 92), Color.WHITE, Color.rgb(100, 170, 255)
            )
        }
        cachedPalette = value
        return value
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val colors = palette()
        canvas.drawColor(colors.background)
        drawBackgroundImage(canvas)
        if (placed.isEmpty()) placed = layoutKeys()

        placed.forEach { item ->
            val pressed = !gliding && active?.key == item.key && active?.row == item.row
            val special = item.key.code.length > 1 && item.key.code != "SPACE"
            keyPaint.style = Paint.Style.FILL
            keyPaint.color = when {
                pressed -> colors.pressedKey
                special -> colors.specialKey
                else -> colors.normalKey
            }
            val rect = if (pressed) {
                RectF(item.rect.left - dp(1f), item.rect.top - dp(1f), item.rect.right + dp(1f), item.rect.bottom + dp(1f))
            } else item.rect
            canvas.drawRoundRect(rect, dp(7f), dp(7f), keyPaint)

            if (!drawSpecialIcon(canvas, item, rect, colors)) {
                val label = displayLabel(item.key)
                textPaint.textSize = if (label.length > 4) dp(13f) else dp(20f)
                textPaint.color = colors.text
                val baseline = rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
                canvas.drawText(label, rect.centerX(), baseline, textPaint)
            }
        }

        drawTrail(canvas, colors)

        val popup = alternatePopup
        if (popup != null) drawAlternatePopup(canvas, popup, colors)
        else if (!gliding) active?.takeIf { canPreview(it.key) }?.let { drawKeyPreview(canvas, it, colors) }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (w != oldw || h != oldh) placed = emptyList()
        super.onSizeChanged(w, h, oldw, oldh)
    }

    private fun drawSpecialIcon(canvas: Canvas, item: PlacedKey, rect: RectF, colors: Palette): Boolean {
        if (item.key.code != "EMOJI") return false
        iconPaint.color = colors.text
        iconPaint.strokeWidth = dp(1.8f)
        val radius = minOf(rect.width(), rect.height()) * 0.22f
        canvas.drawCircle(rect.centerX(), rect.centerY(), radius, iconPaint)
        keyPaint.style = Paint.Style.FILL
        keyPaint.color = colors.text
        canvas.drawCircle(rect.centerX() - radius * 0.38f, rect.centerY() - radius * 0.26f, dp(1.5f), keyPaint)
        canvas.drawCircle(rect.centerX() + radius * 0.38f, rect.centerY() - radius * 0.26f, dp(1.5f), keyPaint)
        val smile = RectF(
            rect.centerX() - radius * 0.52f,
            rect.centerY() - radius * 0.05f,
            rect.centerX() + radius * 0.52f,
            rect.centerY() + radius * 0.58f
        )
        canvas.drawArc(smile, 18f, 144f, false, iconPaint)
        return true
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
        val alpha = (KeyboardPrefs.backgroundTintPercent(context) * 255 / 100).coerceIn(0, 204)
        if (alpha > 0) {
            keyPaint.style = Paint.Style.FILL
            keyPaint.color = Color.argb(alpha, 0, 0, 0)
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), keyPaint)
        }
    }

    private fun drawTrail(canvas: Canvas, colors: Palette) {
        if (!KeyboardPrefs.glideTrailEnabled(context)) return
        val points = if (gliding) glidePoints else fadingTrail
        if (points.size < 2) return
        val alpha = if (gliding) 210 else trailAlpha
        if (alpha <= 0) return

        val path = Path().apply {
            moveTo(points.first().first, points.first().second)
            points.drop(1).forEach { lineTo(it.first, it.second) }
        }
        trailPaint.color = colors.accent
        trailPaint.alpha = alpha
        trailPaint.strokeWidth = dp(4.5f)
        canvas.drawPath(path, trailPaint)
        trailPaint.alpha = 255
    }

    private fun drawKeyPreview(canvas: Canvas, item: PlacedKey, colors: Palette) {
        val previewWidth = max(dp(56f), item.rect.width() * 1.30f)
        val previewHeight = dp(60f)
        val desiredLeft = item.rect.centerX() - previewWidth / 2f
        val left = desiredLeft.coerceIn(dp(3f), width - previewWidth - dp(3f))
        val bottom = item.rect.top + dp(7f)
        val top = max(dp(2f), bottom - previewHeight)
        val popup = RectF(left, top, left + previewWidth, bottom)

        keyPaint.style = Paint.Style.FILL
        keyPaint.color = colors.pressedKey
        canvas.drawRoundRect(popup, dp(13f), dp(13f), keyPaint)

        textPaint.textSize = dp(33f)
        textPaint.color = colors.text
        val baseline = popup.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
        canvas.drawText(displayLabel(item.key), popup.centerX(), baseline, textPaint)
    }

    private fun drawAlternatePopup(canvas: Canvas, popup: AlternatePopup, colors: Palette) {
        keyPaint.style = Paint.Style.FILL
        keyPaint.color = colors.pressedKey
        canvas.drawRoundRect(popup.rect, dp(12f), dp(12f), keyPaint)
        val cellWidth = popup.rect.width() / popup.options.size
        popup.options.forEachIndexed { index, option ->
            val left = popup.rect.left + index * cellWidth
            if (popup.selectedIndex == index) {
                keyPaint.color = colors.accent
                canvas.drawRoundRect(
                    RectF(left + dp(2f), popup.rect.top + dp(3f), left + cellWidth - dp(2f), popup.rect.bottom - dp(3f)),
                    dp(9f), dp(9f), keyPaint
                )
            }
            textPaint.textSize = dp(23f)
            textPaint.color = colors.text
            val baseline = popup.rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            canvas.drawText(option, left + cellWidth / 2f, baseline, textPaint)
        }
    }

    private fun keyAt(x: Float, y: Float): PlacedKey? {
        placed.firstOrNull { it.rect.contains(x, y) }?.let { return it }
        val verticalTolerance = dp(3f)
        val rowCandidates = placed.filter { y >= it.rect.top - verticalTolerance && y <= it.rect.bottom + verticalTolerance }
        val nearest = rowCandidates.minByOrNull { abs(it.rect.centerX() - x) } ?: return null
        val horizontalTolerance = dp(6f)
        return nearest.takeIf { x >= it.rect.left - horizontalTolerance && x <= it.rect.right + horizontalTolerance }
    }

    private fun glideKeyAt(x: Float, y: Float): PlacedKey? = placed.firstOrNull { item ->
        if (!item.key.letter) return@firstOrNull false
        val center = RectF(item.rect)
        center.inset(item.rect.width() * 0.26f, item.rect.height() * 0.20f)
        center.contains(x, y)
    }

    private fun appendPotentialGlide(item: PlacedKey?, x: Float, y: Float) {
        val code = item?.key?.takeIf { it.letter }?.code ?: return
        if (potentialGlideLetters.lastOrNull() != code) {
            potentialGlideLetters += code
            potentialGlidePoints += x to y
        }
    }

    private fun appendGlide(item: PlacedKey?, x: Float, y: Float) {
        val code = item?.key?.takeIf { it.letter }?.code ?: return
        if (glideLetters.lastOrNull() != code) glideLetters += code
        val last = glidePoints.lastOrNull()
        if (last == null || hypot(x - last.first, y - last.second) >= dp(4f)) glidePoints += x to y
    }

    private fun updateAlternateSelection(x: Float, y: Float) {
        val popup = alternatePopup ?: return
        if (y > popup.rect.bottom + dp(18f) || y < popup.rect.top - dp(18f)) {
            popup.selectedIndex = -1
            invalidate()
            return
        }
        val cellWidth = popup.rect.width() / popup.options.size
        popup.selectedIndex = ((x - popup.rect.left) / cellWidth).toInt().coerceIn(0, popup.options.lastIndex)
        invalidate()
    }

    private fun scheduleLongPress(item: PlacedKey) {
        longPressHandler.removeCallbacks(showAlternates)
        if (alternatesFor(item.key) != null) longPressHandler.postDelayed(showAlternates, 360)
    }

    private fun startGlideIfIntentional(event: MotionEvent) {
        if (gliding || symbols || !KeyboardPrefs.glideTypingEnabled(context) || active?.key?.letter != true) return
        val elapsed = event.eventTime - downAt
        val distance = hypot(event.x - downX, event.y - downY)
        val threshold = max(dp(30f), touchSlop * 3f)
        if (elapsed < 85L || distance < threshold || potentialGlideLetters.size < 2) return

        gliding = true
        repeatHandler.removeCallbacks(repeatBackspace)
        longPressHandler.removeCallbacks(showAlternates)
        alternatePopup = null
        glideLetters.clear()
        glideLetters.addAll(potentialGlideLetters)
        glidePoints.clear()
        glidePoints.add(downX to downY)
        potentialGlidePoints.forEach { point ->
            if (glidePoints.lastOrNull() != point) glidePoints += point
        }
        invalidate()
    }

    private fun fadeTrail() {
        trailAnimator?.cancel()
        fadingTrail = glidePoints.toList()
        trailAlpha = 200
        trailAnimator = ValueAnimator.ofInt(200, 0).apply {
            duration = 180
            addUpdateListener {
                trailAlpha = it.animatedValue as Int
                invalidate()
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    fadingTrail = emptyList()
                    invalidate()
                }
            })
            start()
        }
    }

    private fun clearPressState() {
        repeatHandler.removeCallbacks(repeatBackspace)
        longPressHandler.removeCallbacks(showAlternates)
        active = null
        alternatePopup = null
        backspaceRepeated = false
        gliding = false
        potentialGlidePoints.clear()
        potentialGlideLetters.clear()
        glidePoints.clear()
        glideLetters.clear()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (placed.isEmpty()) placed = layoutKeys()
                downX = event.x
                downY = event.y
                downAt = SystemClock.uptimeMillis()
                active = keyAt(event.x, event.y)
                alternatePopup = null
                backspaceRepeated = false
                gliding = false
                potentialGlidePoints.clear()
                potentialGlideLetters.clear()
                glidePoints.clear()
                glideLetters.clear()

                active?.let { item ->
                    listener?.onPressFeedback(this)
                    if (item.key.letter && KeyboardPrefs.glideTypingEnabled(context) && !symbols) {
                        appendPotentialGlide(item, event.x, event.y)
                    }
                    if (item.key.code == "BACKSPACE") repeatHandler.postDelayed(repeatBackspace, 370)
                    else scheduleLongPress(item)
                }
                invalidate()
                return active != null
            }

            MotionEvent.ACTION_MOVE -> {
                if (alternatePopup != null) {
                    updateAlternateSelection(event.x, event.y)
                    return true
                }

                val distance = hypot(event.x - downX, event.y - downY)
                if (!gliding && distance > touchSlop * 1.5f) {
                    longPressHandler.removeCallbacks(showAlternates)
                }

                if (active?.key?.letter == true && KeyboardPrefs.glideTypingEnabled(context) && !symbols) {
                    appendPotentialGlide(glideKeyAt(event.x, event.y), event.x, event.y)
                    startGlideIfIntentional(event)
                }

                if (gliding) {
                    appendGlide(glideKeyAt(event.x, event.y), event.x, event.y)
                    invalidate()
                }
                return true
            }

            MotionEvent.ACTION_UP -> {
                repeatHandler.removeCallbacks(repeatBackspace)
                longPressHandler.removeCallbacks(showAlternates)

                if (gliding) {
                    appendGlide(glideKeyAt(event.x, event.y), event.x, event.y)
                    if (glidePoints.lastOrNull() != (event.x to event.y)) glidePoints += event.x to event.y
                    val sequence = glideLetters.joinToString("")
                    fadeTrail()
                    if (sequence.length >= 2) listener?.onGlide(sequence)
                    performClick()
                    clearPressState()
                    invalidate()
                    return true
                }

                val selected = active
                val popup = alternatePopup
                if (selected != null) {
                    if (popup != null) {
                        if (popup.selectedIndex >= 0) listener?.onKey(popup.options[popup.selectedIndex])
                        else listener?.onKey(selected.key.code)
                    } else if (selected.key.code != "BACKSPACE" || !backspaceRepeated) {
                        listener?.onKey(selected.key.code)
                    }
                    performClick()
                }
                clearPressState()
                invalidate()
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                clearPressState()
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

    override fun onDetachedFromWindow() {
        repeatHandler.removeCallbacksAndMessages(null)
        longPressHandler.removeCallbacksAndMessages(null)
        trailAnimator?.cancel()
        super.onDetachedFromWindow()
    }
}
