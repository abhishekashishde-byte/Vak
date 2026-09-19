package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Test

class TouchLanguageRankerTest {
    @Test
    fun spatialWinnerIsPreservedWhenClearlyAhead() {
        val candidates = listOf(
            SpatialTouchDecoder.Candidate("g", 0.80f, 0.1f, true),
            SpatialTouchDecoder.Candidate("h", 0.15f, 0.4f, true)
        )
        assertEquals("g", TouchLanguageRanker.choose(candidates, "ri", "EN", emptySet()))
    }

    @Test
    fun knownPrefixCanBreakCloseSpatialTie() {
        val candidates = listOf(
            SpatialTouchDecoder.Candidate("g", 0.51f, 0.2f, true),
            SpatialTouchDecoder.Candidate("h", 0.47f, 0.22f, true)
        )
        val prefixes = TouchLanguageRanker.buildPrefixSet(listOf("right"))
        assertEquals("g", TouchLanguageRanker.choose(candidates, "ri", "EN", prefixes))
    }
}
