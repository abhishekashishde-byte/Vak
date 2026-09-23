package com.ana.keyboard

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TypingQualityPolicyTest {
    @Test fun englishHighConfidenceCanAutoCorrect() {
        assertTrue(TypingQualityPolicy.allowAutomaticCorrection("EN", "teh", true))
    }

    @Test fun hinglishStaysSuggestionOnlyUnlessUserLearnsCorrection() {
        assertFalse(TypingQualityPolicy.allowAutomaticCorrection("HIN", "karna", true))
    }

    @Test fun longGermanCompoundStaysSuggestionOnly() {
        assertFalse(TypingQualityPolicy.allowAutomaticCorrection("DE", "Produktionsversion", true))
    }

    @Test fun lowConfidenceNeverAutoCorrects() {
        assertFalse(TypingQualityPolicy.allowAutomaticCorrection("EN", "AnaTerm", false))
    }
}
