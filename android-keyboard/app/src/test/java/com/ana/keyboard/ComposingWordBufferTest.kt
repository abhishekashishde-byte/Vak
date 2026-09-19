package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposingWordBufferTest {
    @Test
    fun appendAndBackspaceRemainOrdered() {
        val buffer = ComposingWordBuffer()
        "right".forEach { buffer.append(it.toString()) }
        assertEquals("right", buffer.value())
        buffer.backspace()
        assertEquals("righ", buffer.value())
        buffer.clear()
        assertTrue(buffer.isEmpty)
    }
}
