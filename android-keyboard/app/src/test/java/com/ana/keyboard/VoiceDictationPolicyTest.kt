package com.ana.keyboard

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceDictationPolicyTest {
    @Test fun finalResultWins() {
        assertEquals("final words", VoiceDictationPolicy.bestText(" final words ", "partial words"))
    }

    @Test fun partialResultIsKeptWhenFinalIsEmpty() {
        assertEquals("partial words", VoiceDictationPolicy.bestText("", " partial words "))
    }

    @Test fun onDeviceClientFailureFallsBackNextTime() {
        assertTrue(VoiceDictationPolicy.shouldFallbackFromOnDevice(SpeechRecognizer.ERROR_CLIENT))
    }
}
