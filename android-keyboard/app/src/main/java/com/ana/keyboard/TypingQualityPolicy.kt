package com.ana.keyboard

/**
 * Conservative automatic-correction policy.
 *
 * Suggestions may still be shown when this returns false. The goal is to avoid
 * silently replacing intentional Hinglish and legitimate long German compounds.
 * Explicitly learned corrections are handled before this policy.
 */
object TypingQualityPolicy {
    fun allowAutomaticCorrection(badge: String, typed: String, highConfidence: Boolean): Boolean {
        if (!highConfidence) return false
        val clean = typed.trim()
        if (clean.length < 2) return false
        if (badge == "HIN") return false
        if (badge == "DE" && clean.length >= 11) return false
        return true
    }
}
