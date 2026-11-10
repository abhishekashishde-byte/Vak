package com.ana.keyboard

/**
 * Avoid inserting a sentence space while a user is composing a domain,
 * email, URL, version or decimal. A period alone is ambiguous: never
 * assume sentence termination without an explicit space.
 */
object SmartPeriodPolicy {
    fun shouldAutoSpace(before: String, after: String = "", emailField: Boolean = false): Boolean {
        if (emailField || after.isNotEmpty()) return false
        val token = before.takeLastWhile { !it.isWhitespace() }
        if (token.isEmpty()) return false
        if ('@' in token || "://" in token || token.startsWith("www.", true)) return false
        if (token.matches(Regex("[0-9]+([.,][0-9]+)*"))) return false
        if (token.matches(Regex("[a-zA-Z0-9_-]+(\\.[a-zA-Z0-9_-]+)+"))) return false
        // A trailing dot is often the beginning of a domain or abbreviation.
        // Space can always be entered explicitly by the user.
        return false
    }
}
