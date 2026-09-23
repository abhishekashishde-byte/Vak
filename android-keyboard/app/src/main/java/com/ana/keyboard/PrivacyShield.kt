package com.ana.keyboard

/**
 * Conservative, local-only masking for text that is about to leave the device.
 *
 * Privacy Shield intentionally focuses on high-confidence patterns. It is not a
 * substitute for a full DLP system; its job is to reduce unnecessary exposure
 * without changing the user's text or silently blocking communication.
 */
object PrivacyShield {
    data class MaskedText(
        val text: String,
        val replacements: LinkedHashMap<String, String>
    ) {
        val count: Int get() = replacements.size

        fun restore(value: String): String {
            var output = value
            replacements.forEach { (token, original) ->
                output = output.replace(token, original)
            }
            return output
        }
    }

    private data class Rule(val label: String, val regex: Regex)

    private val rules = listOf(
        Rule("EMAIL", Regex("""\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b""", RegexOption.IGNORE_CASE)),
        Rule("IBAN", Regex("""\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b""", RegexOption.IGNORE_CASE)),
        Rule("PHONE", Regex("""(?<!\w)(?:\+\d{1,3}[\s()./-]*)?(?:\d[\s()./-]*){7,14}\d(?!\w)""")),
        Rule("URL", Regex("""\bhttps?://[^\s]+""", RegexOption.IGNORE_CASE)),
        Rule("AMOUNT", Regex("""(?<!\w)(?:€|\$|£|₹|EUR|USD|GBP|INR)\s?\d[\d.,]*(?:\s?(?:€|\$|£|₹|EUR|USD|GBP|INR))?\b""", RegexOption.IGNORE_CASE)),
        Rule("COMPANY", Regex("""\b(?:[A-ZÄÖÜ][\p{L}&.'-]*\s+){0,4}[A-ZÄÖÜ][\p{L}&.'-]*\s+(?:GmbH|AG|SE|UG|KG|Ltd\.?|Limited|Inc\.?|LLC|Pvt\.?\s+Ltd\.?)\b""")),
        Rule("ADDRESS", Regex("""\b(?:[A-ZÄÖÜ][\p{L}.'-]*\s+){0,3}(?:Straße|Strasse|Str\.|Weg|Allee|Platz|Road|Rd\.|Street|St\.|Avenue|Ave\.|Lane|Ln\.)\s*\d+[A-Za-z]?\b""", RegexOption.IGNORE_CASE)),
        Rule("ADDRESS", Regex("""\b\d{1,5}\s+(?:[A-ZÄÖÜ][\p{L}.'-]*\s+){1,4}(?:Road|Rd\.|Street|St\.|Avenue|Ave\.|Lane|Ln\.)\b""", RegexOption.IGNORE_CASE)),
        Rule("REFERENCE", Regex("""\b(?:invoice|rechnung|order|auftrag|reference|ref|ticket|kundennr|customer\s*no\.?|case)\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]{4,}\b""", RegexOption.IGNORE_CASE)),
        Rule("PERSON", Regex("""\b[A-ZÄÖÜ][a-zäöüß]{2,}(?:[-'][A-ZÄÖÜ]?[a-zäöüß]+)?\s+[A-ZÄÖÜ][a-zäöüß]{2,}(?:[-'][A-ZÄÖÜ]?[a-zäöüß]+)?\b"""))
    )

    fun mask(input: String): MaskedText {
        if (input.isBlank()) return MaskedText(input, linkedMapOf())

        var working = input
        val replacements = linkedMapOf<String, String>()
        val counters = mutableMapOf<String, Int>()

        rules.forEach { rule ->
            working = rule.regex.replace(working) { match ->
                // Do not re-mask tokens introduced by an earlier rule.
                if (match.value.startsWith("[") && match.value.endsWith("]")) {
                    match.value
                } else {
                    val existing = replacements.entries.firstOrNull { it.value == match.value }?.key
                    existing ?: run {
                        val next = (counters[rule.label] ?: 0) + 1
                        counters[rule.label] = next
                        val token = "[${rule.label}_${next}]"
                        replacements[token] = match.value
                        token
                    }
                }
            }
        }

        return MaskedText(working, replacements)
    }
}
