package com.ana.keyboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.View

object KeyboardBackgrounds {
    data class Preset(val id: String, val name: String, val detail: String)

    val presets = listOf(
        Preset("none", "None", "Use the normal keyboard background"),
        Preset("graphite", "Graphite", "Soft charcoal depth"),
        Preset("aurora", "Aurora", "Dark teal with a subtle violet glow"),
        Preset("midnight_blue", "Midnight blue", "Deep navy with cool highlights"),
        Preset("warm_sand", "Warm sand", "Muted warm neutral tones"),
        Preset("purple_haze", "Purple haze", "Deep plum with a soft violet wash"),
        Preset("ana_gold", "Ana gold", "Black with a restrained warm gold glow")
    )

    fun nameFor(id: String): String = presets.firstOrNull { it.id == id }?.name ?: "None"

    fun draw(canvas: Canvas, width: Int, height: Int, id: String, paint: Paint) {
        if (width <= 0 || height <= 0 || id == "none") return

        val w = width.toFloat()
        val h = height.toFloat()
        val (start, end) = when (id) {
            "graphite" -> Color.rgb(18, 20, 23) to Color.rgb(48, 50, 55)
            "aurora" -> Color.rgb(10, 31, 34) to Color.rgb(37, 21, 49)
            "midnight_blue" -> Color.rgb(8, 19, 35) to Color.rgb(24, 44, 66)
            "warm_sand" -> Color.rgb(53, 44, 36) to Color.rgb(92, 74, 57)
            "purple_haze" -> Color.rgb(29, 17, 39) to Color.rgb(70, 41, 82)
            "ana_gold" -> Color.rgb(14, 14, 14) to Color.rgb(51, 43, 25)
            else -> return
        }

        paint.shader = LinearGradient(0f, 0f, w, h, start, end, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, w, h, paint)

        val glowColor = when (id) {
            "aurora" -> Color.argb(92, 45, 132, 124)
            "midnight_blue" -> Color.argb(80, 54, 118, 170)
            "warm_sand" -> Color.argb(70, 196, 143, 91)
            "purple_haze" -> Color.argb(82, 153, 84, 188)
            "ana_gold" -> Color.argb(88, 230, 181, 65)
            else -> Color.argb(56, 255, 255, 255)
        }
        paint.shader = RadialGradient(w * 0.18f, h * 0.10f, maxOf(w, h) * 0.72f, glowColor, Color.TRANSPARENT, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, w, h, paint)

        paint.shader = null
    }
}

class BackgroundPresetPreviewView(
    context: Context,
    private val presetId: String
) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (presetId == "none") {
            canvas.drawColor(Color.rgb(30, 30, 31))
            return
        }
        KeyboardBackgrounds.draw(canvas, width, height, presetId, paint)
    }
}
