package com.ana.keyboard

import kotlin.math.max

/**
 * Fast spatial decoder for tap typing.
 *
 * A mature keyboard must not require a touch to land inside one exact key rectangle.
 * We score every nearby key and return a small probability distribution. This turns
 * gaps/edge taps into an intent decision instead of a dropped character.
 */
object SpatialTouchDecoder {
    data class KeyGeometry(
        val code: String,
        val left: Float,
        val top: Float,
        val right: Float,
        val bottom: Float,
        val letter: Boolean
    )

    data class Candidate(
        val code: String,
        val probability: Float,
        val normalizedDistance: Float,
        val letter: Boolean
    )

    fun decode(
        x: Float,
        y: Float,
        keys: List<KeyGeometry>,
        maxCandidates: Int = 4
    ): List<Candidate> {
        if (keys.isEmpty()) return emptyList()
        val count = maxCandidates.coerceIn(1, 6)
        val topKeys = arrayOfNulls<KeyGeometry>(count)
        val topScores = FloatArray(count) { -1f }
        val topDistances = FloatArray(count) { Float.MAX_VALUE }

        for (key in keys) {
            val width = max(1f, key.right - key.left)
            val height = max(1f, key.bottom - key.top)
            val centerX = (key.left + key.right) * 0.5f
            val centerY = (key.top + key.bottom) * 0.5f

            // Wider horizontal sigma because fast thumb taps drift sideways more
            // than vertically. Row separation still strongly influences the score.
            val nx = (x - centerX) / (width * 0.72f)
            val ny = (y - centerY) / (height * 0.68f)
            val distance2 = nx * nx + ny * ny

            val inside = x >= key.left && x <= key.right && y >= key.top && y <= key.bottom
            val nearRow = y >= key.top - height * 0.38f && y <= key.bottom + height * 0.38f

            // Avoid exp()/sorting on the touch hot path. The inverse quadratic gives
            // a smooth probability-like score and is cheap enough for every tap.
            var score = 1f / (0.18f + distance2)
            if (inside) score *= 1.26f
            if (nearRow) score *= 1.08f else score *= 0.42f

            // Special keys should be deliberate; a nearby letter should not turn
            // into Shift/Backspace/Enter just because their rectangles are large.
            if (!key.letter && !inside) score *= 0.28f

            var insertAt = -1
            for (i in 0 until count) {
                if (score > topScores[i]) {
                    insertAt = i
                    break
                }
            }
            if (insertAt >= 0) {
                for (i in count - 1 downTo insertAt + 1) {
                    topScores[i] = topScores[i - 1]
                    topDistances[i] = topDistances[i - 1]
                    topKeys[i] = topKeys[i - 1]
                }
                topScores[insertAt] = score
                topDistances[insertAt] = distance2
                topKeys[insertAt] = key
            }
        }

        val valid = topKeys.indices.filter { topKeys[it] != null && topScores[it] > 0f }
        val sum = valid.sumOf { topScores[it].toDouble() }.toFloat().coerceAtLeast(0.0001f)
        return valid.map { i ->
            val key = topKeys[i]!!
            Candidate(
                code = key.code,
                probability = topScores[i] / sum,
                normalizedDistance = topDistances[i],
                letter = key.letter
            )
        }
    }
}
