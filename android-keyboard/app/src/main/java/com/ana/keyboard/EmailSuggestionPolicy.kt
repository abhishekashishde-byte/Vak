package com.ana.keyboard

/**
 * Pure helpers for learned email autocomplete. Keeping parsing here makes the
 * behavior unit-testable and keeps addresses local to the keyboard.
 */
object EmailSuggestionPolicy {
    private const val TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-@"
    private val EMAIL_REGEX = Regex(
        """^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"""
    )

    fun normalizeEmail(value: String): String? {
        val clean = value.trim().trim('<', '>', '(', ')', '[', ']', '{', '}', ',', ';').take(254)
        if (clean.length < 6 || clean.count { it == '@' } != 1) return null
        if (!EMAIL_REGEX.matches(clean)) return null
        return clean
    }

    fun emailAtCursor(textBeforeCursor: String): String? =
        normalizeEmail(trailingToken(textBeforeCursor))

    /**
     * Returns null when Ana should stay in normal word-prediction mode.
     * An empty string is meaningful: an empty email field can show recent emails.
     */
    fun prefixAtCursor(textBeforeCursor: String, emailField: Boolean): String? {
        val token = trailingToken(textBeforeCursor)
        if (token.isEmpty()) return if (emailField) "" else null
        if (token.length > 160 || token.count { it == '@' } > 1) return null
        if (!emailField && '@' !in token) return null
        return token
    }

    private fun trailingToken(text: String): String {
        if (text.isEmpty()) return ""
        return text.takeLast(320).takeLastWhile { TOKEN_CHARS.indexOf(it) >= 0 }
    }
}
