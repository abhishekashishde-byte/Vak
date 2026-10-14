package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpatialWordDecoderTest {
    private fun tap(primary: Char, alternative: Char? = null): List<SpatialTouchDecoder.Candidate> =
        listOf(SpatialTouchDecoder.Candidate(primary.toString(), if (alternative == null) 1f else 0.55f, 0f, true)) +
            (if (alternative == null) emptyList() else listOf(SpatialTouchDecoder.Candidate(alternative.toString(), 0.45f, 0.2f, true)))

    @Test fun nearbyWrongKeyCanDecodeEngine() {
        val taps = "engin".map { tap(it) } + listOf(tap('w', 'e'))
        val result = SpatialWordDecoder(listOf("engine", "engines", "enter")).decode(taps)
        assertEquals("engine", result.first().text)
    }

    @Test fun unknownSequenceDoesNotCrash() {
        val decoder = SpatialWordDecoder(listOf("engine"))
        assertTrue(decoder.decode("xyz".map { tap(it) }).isEmpty())
    }

    @Test fun resetClearsPreviousWord() {
        val decoder = SpatialWordDecoder(listOf("engine", "car"))
        decoder.decode("engine".map { tap(it) })
        assertEquals("car", decoder.decode("car".map { tap(it) }).first().text)
    }
}
