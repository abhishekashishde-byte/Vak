package com.ana.keyboard

/**
 * Small in-memory composing buffer. The editor sees one composing word instead of a
 * stream of unrelated single-character commits.
 */
class ComposingWordBuffer {
    private val text = StringBuilder()

    val isEmpty: Boolean get() = text.isEmpty()
    val length: Int get() = text.length

    fun value(): String = text.toString()

    fun append(value: String): String {
        text.append(value)
        return text.toString()
    }

    fun backspace(): String {
        if (text.isNotEmpty()) {
            val lastCodePoint = Character.codePointBefore(text, text.length)
            text.delete(text.length - Character.charCount(lastCodePoint), text.length)
        }
        return text.toString()
    }

    fun replace(value: String): String {
        text.setLength(0)
        text.append(value)
        return text.toString()
    }

    fun clear() {
        text.setLength(0)
    }
}
