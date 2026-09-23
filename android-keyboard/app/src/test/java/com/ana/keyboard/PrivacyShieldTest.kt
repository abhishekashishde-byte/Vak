package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyShieldTest {
    @Test
    fun masksAndRestoresSensitiveValues() {
        val input = "Email Robert Mueller at robert@example.com about invoice 45829 and €18,500."
        val masked = PrivacyShield.mask(input)

        assertFalse(masked.text.contains("robert@example.com"))
        assertFalse(masked.text.contains("€18,500"))
        assertTrue(masked.count >= 2)
        assertEquals(input, masked.restore(masked.text))
    }

    @Test
    fun preservesRepeatedEntityWithOneStableToken() {
        val input = "robert@example.com then robert@example.com"
        val masked = PrivacyShield.mask(input)

        assertEquals(1, masked.replacements.size)
        assertEquals(input, masked.restore(masked.text))
    }

    @Test
    fun leavesOrdinaryTechnicalTextAlone() {
        val input = "Please check PP/DS and MRP tomorrow."
        val masked = PrivacyShield.mask(input)

        assertEquals(input, masked.text)
        assertEquals(0, masked.count)
    }
}
