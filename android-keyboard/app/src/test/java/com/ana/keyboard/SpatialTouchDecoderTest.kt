package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpatialTouchDecoderTest {
    private val keys = listOf(
        SpatialTouchDecoder.KeyGeometry("g", 0f, 0f, 50f, 60f, true),
        SpatialTouchDecoder.KeyGeometry("h", 55f, 0f, 105f, 60f, true),
        SpatialTouchDecoder.KeyGeometry("j", 110f, 0f, 160f, 60f, true)
    )

    @Test
    fun exactCenterWins() {
        val result = SpatialTouchDecoder.decode(80f, 30f, keys)
        assertEquals("h", result.first().code)
    }

    @Test
    fun keyGapStillProducesCharacter() {
        val result = SpatialTouchDecoder.decode(52.5f, 30f, keys)
        assertFalse(result.isEmpty())
        assertTrue(result.first().code == "g" || result.first().code == "h")
    }

    @Test
    fun probabilitiesAreOrdered() {
        val result = SpatialTouchDecoder.decode(51f, 30f, keys)
        assertTrue(result.size >= 2)
        assertTrue(result[0].probability >= result[1].probability)
    }
}
