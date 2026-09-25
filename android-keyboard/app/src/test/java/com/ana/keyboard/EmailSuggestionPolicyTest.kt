package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EmailSuggestionPolicyTest {
    @Test
    fun acceptsNormalEmail() {
        assertEquals("ana.user+work@example.co.uk", EmailSuggestionPolicy.normalizeEmail("ana.user+work@example.co.uk"))
    }

    @Test
    fun rejectsIncompleteEmail() {
        assertNull(EmailSuggestionPolicy.normalizeEmail("ana@example"))
        assertNull(EmailSuggestionPolicy.normalizeEmail("ana@"))
    }

    @Test
    fun emailFieldCanSuggestBeforeTyping() {
        assertEquals("", EmailSuggestionPolicy.prefixAtCursor("", emailField = true))
        assertEquals("abh", EmailSuggestionPolicy.prefixAtCursor("abh", emailField = true))
    }

    @Test
    fun normalTextOnlySwitchesToEmailModeAfterAtSign() {
        assertNull(EmailSuggestionPolicy.prefixAtCursor("hello abh", emailField = false))
        assertEquals("abh@", EmailSuggestionPolicy.prefixAtCursor("hello abh@", emailField = false))
    }

    @Test
    fun extractsCompletedEmailAtCursor() {
        assertEquals("person@example.com", EmailSuggestionPolicy.emailAtCursor("Send to person@example.com"))
    }
}
