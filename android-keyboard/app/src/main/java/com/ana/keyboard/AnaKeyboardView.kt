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
import android.util.Log
import android.view.HapticFeedbackConstants
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

    data class GlidePoint(val x: Float, val y: Float)
    data class GlideTrace(
        val sequence: String,
        val points: List<GlidePoint>,
        val keyCenters: Map<Char, GlidePoint>
    )

    interface Listener {
        fun onKey(code: String)
        fun onKeyCandidates(candidates: List<SpatialTouchDecoder.Candidate>) {
            candidates.firstOrNull()?.let { onKey(it.code) }
        }
        fun onGlide(trace: GlideTrace)
        fun onPressFeedback(view: View)
        fun onReplaceLastKey(text: String) {}
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
    private var symbolPage = 1
    private var enterLabel = "Enter"
    private var placed = emptyList<PlacedKey>()
    private var active: PlacedKey? = null
    private var backgroundBitmap: Bitmap? = null
    private var alternatePopup: AlternatePopup? = null
    private var backspaceRepeated = false
    private var cachedPalette: Palette? = null
    private var adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)
    private var calibrationBadge = KeyboardPrefs.inputBadge(context)
    private var touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()
    private var calibrationDirty = 0
    private var keyPopupEnabled = KeyboardPrefs.keyPopupEnabled(context)
    private var backgroundTintPercent = KeyboardPrefs.backgroundTintPercent(context)
    private var keyOpacityPercent = KeyboardPrefs.keyOpacityPercent(context)
    private var spaceCursorMoved = false
    private var spaceCursorAnchorX = 0f

    private data class PointerPress(
        val item: PlacedKey,
        val downX: Float,
        val downY: Float,
        var candidates: List<SpatialTouchDecoder.Candidate>,
        val downAt: Long = SystemClock.uptimeMillis(),
        var completed: Boolean = false,
        var upX: Float = downX,
        var upY: Float = downY
    )

    // Overlapping taps are queued by physical DOWN order and released only
    // when earlier taps have completed. This prevents dropped or reordered
    // letters even when two thumbs lift in the opposite order.
    private val pointerPresses = mutableMapOf<Int, PointerPress>()
    private val pointerOrder = mutableListOf<Int>()
    private var gesturePointerId = MotionEvent.INVALID_POINTER_ID
    private var multiTouchTyping = false
    private var spatialGeometry = emptyList<SpatialTouchDecoder.KeyGeometry>()
    private var decodedTapCount = 0L
    private var decodeNanos = 0L

    private val repeatHandler = Handler(Looper.getMainLooper())
    private val calibrationSaveHandler = Handler(Looper.getMainLooper())
    private val persistCalibrationLater = Runnable { persistTouchCalibration() }
    private val longPressHandler = Handler(Looper.getMainLooper())
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    private var downX = 0f
    private var downY = 0f
    private var downAt = 0L
    private var gliding = false
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
        alternatePopup = createAlternatePopup(current, options).apply { selectedIndex = 0 }
        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
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
        if (symbols == value && (!value || symbolPage == 1)) return
        symbols = value
        if (value) symbolPage = 1
        clearPressState()
        placed = emptyList()
        invalidate()
    }

    fun toggleSymbolPage() {
        if (!symbols) return
        symbolPage = if (symbolPage == 1) 2 else 1
        clearPressState()
        placed = emptyList()
        invalidate()
    }

    fun isSymbols(): Boolean = symbols

    fun setEnterLabel(value: String) {
        val next = value.trim().take(10).ifBlank { "Enter" }
        if (enterLabel == next) return
        enterLabel = next
        placed = emptyList()
        invalidate()
    }

    fun setBackgroundBitmap(bitmap: Bitmap?) {
        backgroundBitmap = bitmap
        invalidate()
    }

    fun refreshPreferences() {
        persistTouchCalibration()
        placed = emptyList()
        cachedPalette = null
        adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)
        calibrationBadge = KeyboardPrefs.inputBadge(context)
        touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()
        keyPopupEnabled = KeyboardPrefs.keyPopupEnabled(context)
        backgroundTintPercent = KeyboardPrefs.backgroundTintPercent(context)
        keyOpacityPercent = KeyboardPrefs.keyOpacityPercent(context)
        clearPressState()
        invalidate()
    }

    private fun letterRows(): Triple<String, String, String> = when (KeyboardPrefs.inputBadge(context)) {
        "DE" -> Triple("QWERTZUIOP", "ASDFGHJKL", "YXCVBNM")
        else -> Triple("QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")
    }

    private fun rows(): List<List<KeySpec>> {
        if (symbols) {
            val commonBottom = listOf(
                KeySpec("", "EMOJI", 0.86f),
                KeySpec(KeyboardPrefs.inputDisplayBadge(context), "LANGUAGE", 1.05f),
                KeySpec("", "SPACE", 5.10f * (KeyboardPrefs.spacebarScalePercent(context) / 100f)),
                KeySpec(".", ".", 0.72f),
                KeySpec(enterLabel, "ENTER", 1.56f)
            )
            return if (symbolPage == 1) {
                listOf(
                    "1234567890".map { KeySpec(it.toString()) },
                    listOf("@", "#", "€", "_", "%", "&", "-", "+", "(", ")").map { KeySpec(it) },
                    listOf(
                        KeySpec("ABC", "ABC", 1.35f), KeySpec("!"), KeySpec("?"), KeySpec(":"), KeySpec(";"),
                        KeySpec("/"), KeySpec("'"), KeySpec("\""), KeySpec("2/2", "SYMBOL_PAGE", 1.10f),
                        KeySpec("⌫", "BACKSPACE", 1.48f)
                    ),
                    commonBottom
                )
            } else {
                listOf(
                    listOf("[", "]", "{", "}", "<", ">", "=", "×", "÷", "±").map { KeySpec(it) },
                    listOf("£", "$", "¥", "₹", "¢", "©", "®", "™", "°", "•").map { KeySpec(it) },
                    listOf(
                        KeySpec("ABC", "ABC", 1.35f), KeySpec("\\"), KeySpec("|"), KeySpec("~"), KeySpec("^"),
                        KeySpec("§"), KeySpec("¶"), KeySpec("…"), KeySpec("1/2", "SYMBOL_PAGE", 1.10f),
                        KeySpec("⌫", "BACKSPACE", 1.48f)
                    ),
                    commonBottom
                )
            }
        }

        val (r1, r2, r3Letters) = letterRows()
        val result = mutableListOf<List<KeySpec>>()
        if (KeyboardPrefs.numberRowEnabled(context)) {
            result.add("1234567890".map { KeySpec(it.toString()) })
        }
        result.add(r1.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
        result.add(r2.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
        result.add(buildList {
            add(KeySpec("", "SHIFT", 1.62f))
            addAll(r3Letters.map { KeySpec(it.toString(), it.lowercase(), letter = true) })
            add(KeySpec("⌫", "BACKSPACE", 1.62f))
        })
        result.add(buildList {
            add(KeySpec("?123", "SYMBOLS", 1.42f))
            if (KeyboardPrefs.commaKeyEnabled(context)) add(KeySpec(",", ",", 0.70f))
            add(KeySpec("", "EMOJI", 0.82f))
            add(KeySpec(KeyboardPrefs.inputDisplayBadge(context), "LANGUAGE", 1.05f))
            add(KeySpec("", "SPACE", 5.05f * (KeyboardPrefs.spacebarScalePercent(context) / 100f)))
            if (KeyboardPrefs.fullStopKeyEnabled(context)) add(KeySpec(".", ".", 0.70f))
            add(KeySpec(enterLabel, "ENTER", 1.56f))
        })
        return result
    }

    private fun layoutKeys(): List<PlacedKey> {
        if (width <= 0 || height <= 0) return emptyList()
        val rows = rows()
        val outer = dp(6f)
        val gapDp = KeyboardPrefs.keyGapDp(context).toFloat()
        val gap = dp(gapDp)
        val rowGap = dp((gapDp * 0.92f).coerceAtLeast(2f))
        val usableHeight = height - outer * 2 - rowGap * (rows.size - 1)
        val rowHeight = max(dp(36f), usableHeight / rows.size)
        val result = mutableListOf<PlacedKey>()

        val oneHanded = KeyboardPrefs.oneHandedMode(context)
        val fullWidth = width - outer * 2
        val activeWidth = if (oneHanded == "off") fullWidth else fullWidth * (KeyboardPrefs.oneHandedWidthPercent(context) / 100f)
        val baseLeft = when (oneHanded) {
            "right" -> width - outer - activeWidth
            else -> outer
        }
        val baseRight = baseLeft + activeWidth

        val numberOffset = if (!symbols && KeyboardPrefs.numberRowEnabled(context)) 1 else 0
        val qRow = if (symbols) -1 else numberOffset
        val aRow = if (symbols) -1 else qRow + 1

        rows.forEachIndexed { rowIndex, row ->
            val inset = when {
                symbols -> 0f
                rowIndex == aRow -> dp(22f)
                else -> 0f
            }
            val leftBound = baseLeft + inset
            val rightBound = baseRight - inset
            val totalFlex = row.sumOf { it.flex.toDouble() }.toFloat()
            val availableWidth = rightBound - leftBound - gap * (row.size - 1)
            var x = leftBound
            val top = outer + rowIndex * (rowHeight + rowGap)

            row.forEach { key ->
                val keyWidth = availableWidth * (key.flex / totalFlex)
                val rect = RectF(x, top, x + keyWidth, top + rowHeight)
                result += PlacedKey(key, rect, rowIndex)
                x += keyWidth + gap
            }
        }
        spatialGeometry = buildSpatialGeometry(result)
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
        keyPopupEnabled && key.code.length == 1 && key.code.firstOrNull()?.isLetterOrDigit() == true

    private fun alternatesFor(key: KeySpec): List<String>? {
        if (!key.letter || symbols) return null
        val variants = when (key.code.lowercase()) {
            "q" -> listOf("1")
            "w" -> listOf("2")
            "e" -> listOf("é", "è", "ê", "ë", "3")
            "r" -> listOf("4")
            "t" -> listOf("5")
            "y" -> listOf("ÿ", "ý", "6")
            "u" -> listOf("ü", "ú", "ù", "û", "7")
            "i" -> listOf("í", "ì", "î", "ï", "8")
            "o" -> listOf("ö", "ó", "ò", "ô", "õ", "ø", "œ", "9")
            "p" -> listOf("0")
            "a" -> listOf("ä", "á", "à", "â", "ã", "å", "æ")
            "s" -> listOf("ß", "ś", "š")
            "d" -> listOf("#")
            "f" -> listOf("%")
            "g" -> listOf("&")
            "h" -> listOf("-")
            "j" -> listOf("+")
            "k" -> listOf("(")
            "l" -> listOf(")")
            "z" -> listOf("ž", "ź", "ż")
            "x" -> listOf("?")
            "c" -> listOf("ç", "ć", "č")
            "v" -> listOf("/")
            "b" -> listOf("\"")
            "n" -> listOf("ñ", "ń")
            "m" -> listOf("'")
            else -> emptyList()
        }
        if (variants.isEmpty()) return null
        return if (shifted) variants.map { value ->
            if (value.any { it.isLetter() }) value.uppercase() else value
        } else variants
    }

    private fun createAlternatePopup(item: PlacedKey, options: List<String>): AlternatePopup {
        val cell = dp(42f)
        val widthNeeded = (cell * options.size).coerceAtMost(width - dp(8f))
        val desiredLeft = item.rect.centerX() - widthNeeded / 2f
        val left = desiredLeft.coerceIn(dp(4f), width - widthNeeded - dp(4f))
        val bottom = max(dp(56f), item.rect.top + dp(5f))
        val top = max(dp(2f), bottom - dp(54f))
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
                Color.rgb(225, 228, 232), Color.rgb(250, 250, 250), Color.rgb(205, 209, 215),
                Color.rgb(183, 189, 198), Color.rgb(25, 25, 25), Color.rgb(65, 115, 245)
            )
            "midnight" -> Palette(
                Color.BLACK, Color.rgb(28, 28, 30), Color.rgb(43, 43, 46),
                Color.rgb(76, 78, 83), Color.WHITE, Color.rgb(100, 170, 255)
            )
            "gold" -> Palette(
                Color.rgb(17, 17, 17), Color.rgb(48, 48, 48), Color.rgb(63, 59, 46),
                Color.rgb(118, 96, 46), Color.WHITE, Color.rgb(230, 181, 65)
            )
            else -> Palette(
                Color.rgb(26, 26, 26), Color.rgb(54, 54, 54), Color.rgb(66, 66, 66),
                Color.rgb(86, 88, 92), Color.WHITE, Color.rgb(100, 170, 255)
            )
        }
        cachedPalette = value
        return value
    }

    private fun keyColor(base: Int, special: Boolean, pressed: Boolean, colors: Palette): Int {
        val color = when {
            pressed -> colors.pressedKey
            special -> colors.specialKey
            else -> colors.normalKey
        }
        val baseAlpha = (255 * keyOpacityPercent / 100).coerceIn(51, 255)
        val alpha = if (pressed) (baseAlpha + 26).coerceAtMost(255) else baseAlpha
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
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
            keyPaint.color = keyColor(colors.normalKey, special, pressed, colors)
            val rect = if (pressed) {
                RectF(item.rect.left - dp(1f), item.rect.top - dp(1f), item.rect.right + dp(1f), item.rect.bottom + dp(1f))
            } else item.rect
            val radius = dp(KeyboardPrefs.keyRadiusDp(context).toFloat())
            canvas.drawRoundRect(rect, radius, radius, keyPaint)
            if (KeyboardPrefs.keyBordersEnabled(context)) {
                keyPaint.style = Paint.Style.STROKE
                keyPaint.strokeWidth = dp(0.8f)
                keyPaint.color = Color.argb(if (KeyboardPrefs.theme(context) == "light") 46 else 62, Color.red(colors.text), Color.green(colors.text), Color.blue(colors.text))
                canvas.drawRoundRect(rect, radius, radius, keyPaint)
                keyPaint.style = Paint.Style.FILL
            }

            if (!drawSpecialIcon(canvas, item, rect, colors)) {
                val label = displayLabel(item.key)
                val labelScale = KeyboardPrefs.keyLabelScalePercent(context) / 100f
                textPaint.textSize = (if (label.length > 4) dp(13f) else dp(20f)) * labelScale
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
        val alpha = (backgroundTintPercent * 255 / 100).coerceIn(0, 204)
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
        trailPaint.strokeWidth = dp(4.2f)
        canvas.drawPath(path, trailPaint)
        trailPaint.alpha = 255
    }

    private fun drawKeyPreview(canvas: Canvas, item: PlacedKey, colors: Palette) {
        val previewWidth = max(dp(56f), item.rect.width() * 1.30f)
        val previewHeight = dp(58f)
        val desiredLeft = item.rect.centerX() - previewWidth / 2f
        val left = desiredLeft.coerceIn(dp(3f), width - previewWidth - dp(3f))
        val bottom = max(dp(58f), item.rect.top + dp(5f))
        val top = max(dp(2f), bottom - previewHeight)
        val popup = RectF(left, top, left + previewWidth, bottom)

        keyPaint.style = Paint.Style.FILL
        keyPaint.color = colors.pressedKey
        canvas.drawRoundRect(popup, dp(13f), dp(13f), keyPaint)

        textPaint.textSize = dp(32f)
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

    private fun calibrationFor(item: PlacedKey): KeyboardPrefs.TouchCalibration? {
        if (!adaptiveTouch || !item.key.letter) return null
        return touchCalibration[item.key.code.lowercase()]?.takeIf { it.count >= 6 }
    }

    private fun shiftX(item: PlacedKey): Float = (calibrationFor(item)?.dx ?: 0f) * item.rect.width()
    private fun shiftY(item: PlacedKey): Float = (calibrationFor(item)?.dy ?: 0f) * item.rect.height()

    private fun calibratedContains(item: PlacedKey, x: Float, y: Float, toleranceX: Float = 0f, toleranceY: Float = 0f): Boolean {
        val sx = shiftX(item)
        val sy = shiftY(item)
        return x >= item.rect.left + sx - toleranceX && x <= item.rect.right + sx + toleranceX &&
            y >= item.rect.top + sy - toleranceY && y <= item.rect.bottom + sy + toleranceY
    }

    private fun buildSpatialGeometry(keys: List<PlacedKey>): List<SpatialTouchDecoder.KeyGeometry> =
        keys.map { item ->
            val sx = shiftX(item)
            val sy = shiftY(item)
            SpatialTouchDecoder.KeyGeometry(
                code = item.key.code,
                left = item.rect.left + sx,
                top = item.rect.top + sy,
                right = item.rect.right + sx,
                bottom = item.rect.bottom + sy,
                letter = item.key.letter
            )
        }

    private fun spatialCandidates(x: Float, y: Float): List<SpatialTouchDecoder.Candidate> {
        if (spatialGeometry.isEmpty() && placed.isNotEmpty()) spatialGeometry = buildSpatialGeometry(placed)
        val started = System.nanoTime()
        val result = SpatialTouchDecoder.decode(x, y, spatialGeometry)
        decodeNanos += System.nanoTime() - started
        decodedTapCount++
        if (decodedTapCount % 250L == 0L) {
            val averageUs = decodeNanos / decodedTapCount / 1_000L
            Log.d("AnaTyping", "spatial decode avg=${averageUs}us taps=$decodedTapCount")
        }
        return result
    }

    private fun forgivingSpaceAt(x: Float, y: Float): PlacedKey? {
        val space = placed.firstOrNull { it.key.code == "SPACE" } ?: return null
        val rowKeys = placed.filter { it.row == space.row }
        if (rowKeys.isEmpty()) return null

        val rowTop = rowKeys.minOf { it.rect.top }
        val rowBottom = rowKeys.maxOf { it.rect.bottom }
        if (y < rowTop - dp(10f) || y > max(height.toFloat(), rowBottom + dp(10f))) return null

        // Direct taps on another visible bottom-row key remain deliberate.
        // Everything in the dead space immediately surrounding the spacebar
        // belongs to Space instead of being decoded as a neighbouring control.
        val exact = rowKeys.firstOrNull { it.rect.contains(x, y) }
        if (exact != null) return if (exact.key.code == "SPACE") space else null

        val leftNeighbourRight = rowKeys
            .filter { it.rect.right <= space.rect.left }
            .maxOfOrNull { it.rect.right } ?: space.rect.left
        val rightNeighbourLeft = rowKeys
            .filter { it.rect.left >= space.rect.right }
            .minOfOrNull { it.rect.left } ?: space.rect.right

        val captureLeft = minOf(space.rect.left - dp(12f), leftNeighbourRight)
        val captureRight = maxOf(space.rect.right + dp(12f), rightNeighbourLeft)
        return if (x in captureLeft..captureRight) space else null
    }

    private fun keyAt(x: Float, y: Float): PlacedKey? {
        forgivingSpaceAt(x, y)?.let { return it }
        val candidate = spatialCandidates(x, y).firstOrNull() ?: return null
        return placed.firstOrNull { it.key.code == candidate.code }
    }

    private fun resolvePointerCandidates(
        press: PointerPress,
        upX: Float,
        upY: Float
    ): List<SpatialTouchDecoder.Candidate> {
        val movement = hypot(upX - press.downX, upY - press.downY)
        val elapsed = SystemClock.uptimeMillis() - press.downAt
        if (movement > max(dp(24f), touchSlop * 2.8f) || elapsed > 420L) return press.candidates

        // Fast taps often leave the screen a few pixels away from where they began.
        // Blend DOWN strongly with UP instead of trusting either coordinate alone.
        val intentX = press.downX * 0.76f + upX * 0.24f
        val intentY = press.downY * 0.82f + upY * 0.18f
        return spatialCandidates(intentX, intentY).ifEmpty { press.candidates }
    }

    private fun recordSuccessfulTouch(
        item: PlacedKey,
        pressX: Float,
        pressY: Float,
        upX: Float,
        upY: Float
    ) {
        if (!adaptiveTouch || !item.key.letter || symbols) return
        if (hypot(upX - pressX, upY - pressY) > max(dp(18f), touchSlop * 2.2f)) return
        val width = item.rect.width().coerceAtLeast(1f)
        val height = item.rect.height().coerceAtLeast(1f)
        // Include confident edge/gap taps so calibration learns where the user
        // actually lands instead of learning only already-perfect taps.
        val sampleDx = ((pressX - item.rect.centerX()) / width).coerceIn(-0.30f, 0.30f)
        val sampleDy = ((pressY - item.rect.centerY()) / height).coerceIn(-0.30f, 0.30f)
        val key = item.key.code.lowercase()
        val old = touchCalibration[key] ?: KeyboardPrefs.TouchCalibration(0f, 0f, 0)
        val alpha = if (old.count < 18) 0.16f else 0.045f
        val next = KeyboardPrefs.TouchCalibration(
            dx = (old.dx * (1f - alpha) + sampleDx * alpha).coerceIn(-0.16f, 0.16f),
            dy = (old.dy * (1f - alpha) + sampleDy * alpha).coerceIn(-0.16f, 0.16f),
            count = (old.count + 1).coerceAtMost(100000)
        )
        touchCalibration[key] = next
        calibrationDirty++
        if (calibrationDirty % 12 == 0) spatialGeometry = buildSpatialGeometry(placed)
        // Never serialize calibration during an active typing burst.
        calibrationSaveHandler.removeCallbacks(persistCalibrationLater)
        calibrationSaveHandler.postDelayed(persistCalibrationLater, 2200L)
    }

    private fun persistTouchCalibration() {
        if (calibrationDirty <= 0) return
        KeyboardPrefs.saveTouchCalibration(context, touchCalibration, calibrationBadge)
        calibrationDirty = 0
    }

    private fun glideKeyAt(x: Float, y: Float): PlacedKey? = placed.firstOrNull { item ->
        if (!item.key.letter) return@firstOrNull false
        val center = RectF(item.rect)
        center.inset(item.rect.width() * 0.22f, item.rect.height() * 0.16f)
        center.contains(x, y)
    }

    private fun appendPotentialGlide(item: PlacedKey?) {
        val code = item?.key?.takeIf { it.letter }?.code ?: return
        if (potentialGlideLetters.lastOrNull() != code) potentialGlideLetters += code
    }

    private fun appendGlide(item: PlacedKey?, x: Float, y: Float) {
        val code = item?.key?.takeIf { it.letter }?.code
        if (code != null && glideLetters.lastOrNull() != code) glideLetters += code
        val last = glidePoints.lastOrNull()
        if (last == null || hypot(x - last.first, y - last.second) >= dp(3.5f)) glidePoints += x to y
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
        if (alternatesFor(item.key) != null) {
            longPressHandler.postDelayed(showAlternates, KeyboardPrefs.longPressDelayMs(context).toLong())
        }
    }

    private fun startGlideIfIntentional(event: MotionEvent) {
        if (gliding || symbols || !KeyboardPrefs.glideTypingEnabled(context) || active?.key?.letter != true) return
        val elapsed = event.eventTime - downAt
        val distance = hypot(event.x - downX, event.y - downY)
        val threshold = max(dp(42f), touchSlop * 4f)
        val enoughLetters = potentialGlideLetters.size >= 3 || (potentialGlideLetters.size >= 2 && distance >= dp(68f))
        if (elapsed < 110L || distance < threshold || !enoughLetters) return

        gliding = true
        repeatHandler.removeCallbacks(repeatBackspace)
        longPressHandler.removeCallbacks(showAlternates)
        alternatePopup = null
        glideLetters.clear()
        glideLetters.addAll(potentialGlideLetters)
        glidePoints.clear()
        glidePoints += downX to downY
        glidePoints += event.x to event.y
        invalidate()
    }

    private fun buildGlideTrace(sequence: String): GlideTrace {
        val safeWidth = width.coerceAtLeast(1).toFloat()
        val safeHeight = height.coerceAtLeast(1).toFloat()
        val points = glidePoints
            .filterIndexed { index, _ -> index == 0 || index == glidePoints.lastIndex || index % 2 == 0 }
            .take(64)
            .map { GlidePoint(it.first / safeWidth, it.second / safeHeight) }
        val centers = placed
            .filter { it.key.letter }
            .associate { item ->
                item.key.code.first() to GlidePoint(item.rect.centerX() / safeWidth, item.rect.centerY() / safeHeight)
            }
        return GlideTrace(sequence, points, centers)
    }

    private fun fadeTrail() {
        trailAnimator?.cancel()
        fadingTrail = glidePoints.toList()
        trailAlpha = 200
        trailAnimator = ValueAnimator.ofInt(200, 0).apply {
            duration = 170
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
        potentialGlideLetters.clear()
        glidePoints.clear()
        glideLetters.clear()
        spaceCursorMoved = false
        pointerPresses.clear()
        pointerOrder.clear()
        gesturePointerId = MotionEvent.INVALID_POINTER_ID
        multiTouchTyping = false
    }

    private fun beginPointer(event: MotionEvent, index: Int): PlacedKey? {
        val pointerId = event.getPointerId(index)
        val x = event.getX(index)
        val y = event.getY(index)
        val spaceIntent = forgivingSpaceAt(x, y)
        val candidates = if (spaceIntent != null) {
            listOf(SpatialTouchDecoder.Candidate("SPACE", 1f, 0f, false))
        } else {
            spatialCandidates(x, y)
        }
        val top = candidates.firstOrNull() ?: return null
        val item = spaceIntent ?: placed.firstOrNull { it.key.code == top.code } ?: return null

        pointerPresses[pointerId] = PointerPress(item, x, y, candidates)
        pointerOrder += pointerId
        listener?.onPressFeedback(this)

        if (pointerPresses.size == 1) {
            gesturePointerId = pointerId
            multiTouchTyping = false
            downX = x
            downY = y
            downAt = SystemClock.uptimeMillis()
            active = item
            alternatePopup = null
            backspaceRepeated = false
            gliding = false
            potentialGlideLetters.clear()
            glidePoints.clear()
            glideLetters.clear()
            spaceCursorMoved = false
            spaceCursorAnchorX = x

            if (item.key.letter && KeyboardPrefs.glideTypingEnabled(context) && !symbols) appendPotentialGlide(item)
            if (item.key.code == "BACKSPACE") repeatHandler.postDelayed(repeatBackspace, 370)
            else scheduleLongPress(item)
        } else {
            // Once fingers overlap, this sequence is fast typing. Do not let
            // long-press, glide, backspace-repeat, or space-drag state steal a tap.
            multiTouchTyping = true
            repeatHandler.removeCallbacks(repeatBackspace)
            longPressHandler.removeCallbacks(showAlternates)
            alternatePopup = null
            active = null
            backspaceRepeated = false
            gliding = false
            potentialGlideLetters.clear()
            glidePoints.clear()
            glideLetters.clear()
            spaceCursorMoved = false
        }

        invalidate()
        return item
    }

    private fun flushCompletedTypingPointers() {
        while (pointerOrder.isNotEmpty()) {
            val pointerId = pointerOrder.first()
            val press = pointerPresses[pointerId]
            if (press == null) {
                pointerOrder.removeAt(0)
                continue
            }
            if (!press.completed) return

            if (press.item.key.code.length == 1) listener?.onKeyCandidates(press.candidates)
            else listener?.onKey(press.item.key.code)
            recordSuccessfulTouch(
                press.item,
                press.downX,
                press.downY,
                press.upX,
                press.upY
            )
            pointerOrder.removeAt(0)
            pointerPresses.remove(pointerId)
        }
    }

    private fun completeTypingPointer(pointerId: Int, upX: Float, upY: Float) {
        val press = pointerPresses[pointerId] ?: return
        press.completed = true
        press.upX = upX
        press.upY = upY
        press.candidates = resolvePointerCandidates(press, upX, upY)
        flushCompletedTypingPointers()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (placed.isEmpty()) placed = layoutKeys()
                clearPressState()
                return beginPointer(event, event.actionIndex) != null
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                beginPointer(event, event.actionIndex)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (multiTouchTyping) return true

                val pointerIndex = event.findPointerIndex(gesturePointerId)
                if (pointerIndex < 0) return true
                val x = event.getX(pointerIndex)
                val y = event.getY(pointerIndex)

                if (active?.key?.code == "SPACE") {
                    // A normal Space tap may drift a little. Cursor mode starts only
                    // after a deliberate hold + horizontal move, so a sloppy tap
                    // still produces a space instead of silently disappearing.
                    val heldLongEnough = event.eventTime - downAt >= 170L
                    val movedFromDown = abs(x - downX)
                    if (!spaceCursorMoved) {
                        if (!heldLongEnough || movedFromDown < dp(12f)) return true
                        spaceCursorMoved = true
                        spaceCursorAnchorX = x
                        longPressHandler.removeCallbacks(showAlternates)
                    }

                    val step = dp(15f)
                    val rawSteps = ((x - spaceCursorAnchorX) / step).toInt().coerceIn(-12, 12)
                    if (rawSteps != 0) {
                        val code = if (rawSteps > 0) "CURSOR_RIGHT" else "CURSOR_LEFT"
                        repeat(kotlin.math.abs(rawSteps)) { listener?.onKey(code) }
                        spaceCursorAnchorX += rawSteps * step
                    }
                    return true
                }

                if (alternatePopup != null) {
                    updateAlternateSelection(x, y)
                    return true
                }

                val distance = hypot(x - downX, y - downY)
                val longPressCancelDistance = max(dp(18f), touchSlop * 2.5f)
                if (!gliding && distance > longPressCancelDistance) longPressHandler.removeCallbacks(showAlternates)

                if (active?.key?.letter == true && KeyboardPrefs.glideTypingEnabled(context) && !symbols) {
                    appendPotentialGlide(glideKeyAt(x, y))
                    startGlideIfIntentional(event)
                }

                if (gliding) {
                    appendGlide(glideKeyAt(x, y), x, y)
                    invalidate()
                }
                return true
            }

            MotionEvent.ACTION_POINTER_UP -> {
                val index = event.actionIndex
                val pointerId = event.getPointerId(index)
                completeTypingPointer(pointerId, event.getX(index), event.getY(index))
                if (pointerId == gesturePointerId) gesturePointerId = MotionEvent.INVALID_POINTER_ID
                performClick()
                invalidate()
                return true
            }

            MotionEvent.ACTION_UP -> {
                val index = event.actionIndex
                val pointerId = event.getPointerId(index)
                val upX = event.getX(index)
                val upY = event.getY(index)

                if (multiTouchTyping) {
                    completeTypingPointer(pointerId, upX, upY)
                    performClick()
                    clearPressState()
                    invalidate()
                    return true
                }

                repeatHandler.removeCallbacks(repeatBackspace)
                longPressHandler.removeCallbacks(showAlternates)

                if (gliding) {
                    appendGlide(glideKeyAt(upX, upY), upX, upY)
                    val sequence = glideLetters.joinToString("")
                    val trace = buildGlideTrace(sequence)
                    fadeTrail()
                    if (sequence.length >= 2) listener?.onGlide(trace)
                    performClick()
                    clearPressState()
                    invalidate()
                    return true
                }

                val press = pointerPresses[pointerId]
                val selected = press?.item ?: active
                val popup = alternatePopup
                if (selected != null) {
                    if (popup != null && popup.selectedIndex >= 0) {
                        listener?.onKey(popup.options[popup.selectedIndex])
                    } else if (selected.key.code == "SPACE" && spaceCursorMoved) {
                        // A horizontal spacebar drag is cursor control, not a Space keypress.
                    } else if (selected.key.code != "BACKSPACE" || !backspaceRepeated) {
                        if (selected.key.code.length == 1 && press != null) {
                            val resolved = resolvePointerCandidates(press, upX, upY)
                            listener?.onKeyCandidates(resolved)
                        } else {
                            listener?.onKey(selected.key.code)
                        }
                    }

                    if (press != null) {
                        recordSuccessfulTouch(selected, press.downX, press.downY, upX, upY)
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
        calibrationSaveHandler.removeCallbacksAndMessages(null)
        trailAnimator?.cancel()
        persistTouchCalibration()
        super.onDetachedFromWindow()
    }
}
