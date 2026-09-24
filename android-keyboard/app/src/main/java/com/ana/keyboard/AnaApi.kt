package com.ana.keyboard

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object AnaApi {
    enum class Action { TRANSLATE, FIX, TONE, SHORTER, WRITE, REPLY, FORMAL, FRIENDLY, DU, SIE }

    data class CloudResult(val text: String, val shieldedCount: Int)

    private val paragraphCache = object : LinkedHashMap<String, CloudResult>(24, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, CloudResult>?): Boolean = size > 24
    }

    fun correctParagraph(
        baseUrl: String,
        text: String,
        languageHint: String,
        privacyShield: Boolean = true,
        glossary: Collection<String> = emptyList()
    ): CloudResult {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no paragraph to correct." }

        val cacheKey = "$languageHint\u0000$privacyShield\u0000$text"
        synchronized(paragraphCache) {
            paragraphCache[cacheKey]?.let { return it }
        }

        val instructions = "You are Ana Keyboard's Smart Sentence Correction — Paragraph Mode. The user is typing in $languageHint. Keep the SAME language; do not translate. Review the ENTIRE paragraph, including earlier sentences that may still contain missed keyboard slips. Correct high-confidence spelling mistakes, missing or duplicated letters, nearby-key typos, grammar, punctuation, missing articles or prepositions, and clearly wrong word order. Use the surrounding paragraph to infer an intended word when the typed word is wrong but the meaning is clear. Leave uncertain names, specialist terms and intentional wording unchanged. Preserve the user's meaning, tone, paragraph structure, names, numbers, URLs and facts. Preserve text that is already correct; do not make stylistic rewrites and do not add new information. Return ONLY the corrected paragraph, with no labels, explanations or quotation marks."
        val corrected = request(baseUrl, text, withGlossary(instructions, glossary), privacyShield)
        synchronized(paragraphCache) { paragraphCache[cacheKey] = corrected }
        return corrected
    }

    private fun request(baseUrl: String, text: String, instructions: String, privacyShield: Boolean): CloudResult {
        val protected = if (privacyShield) PrivacyShield.mask(text) else PrivacyShield.MaskedText(text, linkedMapOf())
        val privacyInstruction = if (protected.count > 0) {
            "\n\nPRIVACY TOKENS: The input contains placeholders such as [PERSON_1], [EMAIL_1], [AMOUNT_1] or [IBAN_1]. Copy every placeholder EXACTLY and unchanged into the corresponding output. Never translate, alter, split, remove or invent a privacy token."
        } else ""
        val endpoint = URL(baseUrl.trimEnd('/') + "/api/translate")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 12_000
        connection.readTimeout = 25_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")

        val body = JSONObject()
            .put("text", protected.text)
            .put("instructions", instructions + privacyInstruction)
            .toString()

        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val response = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        val json = JSONObject(response.ifBlank { "{}" })

        if (connection.responseCode !in 200..299) {
            throw IllegalStateException(json.optString("error", "Ana request failed (${connection.responseCode})."))
        }
        val content = json.optString("content").trim().ifBlank { throw IllegalStateException("Ana returned no text.") }
        return CloudResult(protected.restore(content), protected.count)
    }

    fun transform(
        baseUrl: String,
        text: String,
        action: Action,
        target: String,
        privacyShield: Boolean = true,
        glossary: Collection<String> = emptyList()
    ): CloudResult {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no text to change." }

        val instructions = when (action) {
            Action.TRANSLATE -> "You are Ana Keyboard. Translate the user's text into $target. Preserve every fact, name, number, URL and intention. Make it sound natural to a native speaker. Return ONLY the finished replacement text, with no labels, explanations or quotation marks."
            Action.FIX -> "You are Ana Keyboard's Correct tool. Correct spelling, grammar, punctuation and wording so the final text is natural $target. If the user's text is partly or entirely in another language, convert it to $target while preserving its meaning, names, facts, tone and level of formality. Do not shorten it or invent information. Return ONLY the corrected replacement text, with no labels or explanations."
            Action.TONE -> "You are Ana Keyboard. Rewrite the user's text in the same language so it sounds warm, natural and appropriately polite without becoming wordy. Preserve every factual detail and request. Return ONLY the replacement text."
            Action.SHORTER -> "You are Ana Keyboard. Rewrite the user's text in the same language to be shorter and clearer while preserving all important facts, requests, names, dates and numbers. Return ONLY the replacement text."
            Action.WRITE -> "You are Ana Keyboard's Writing Tool. The user's text is an instruction describing what they want to write. Draft the finished message in $target. Make it natural, clear and appropriate for everyday communication. Preserve every fact the user supplied and do not invent names, dates, promises, prices, commitments or personal details. Return ONLY the finished message, with no labels, explanations or quotation marks."
            Action.REPLY -> "You are Ana Keyboard's Reply tool. The supplied text contains a received message and may also include a user instruction about how to answer. Write ONLY the final ready-to-send reply in $target. Respond naturally to the received message and follow any explicit reply instruction. Never invent facts, names, dates, promises, availability, prices, commitments or personal details the user did not provide. Do not quote or repeat the source message unless needed for clarity. Return ONLY the reply, with no labels, explanations or quotation marks."
            Action.FORMAL -> "Rewrite the user's text in the SAME language in a polished professional/formal tone. Preserve every fact, request, name, number and intention. Do not add information. Return ONLY the replacement text."
            Action.FRIENDLY -> "Rewrite the user's text in the SAME language so it sounds friendly, natural and human, without becoming overly casual or changing facts. Return ONLY the replacement text."
            Action.DU -> "Rewrite German text using natural informal 'du' forms consistently. If the text is not German, translate it into natural German using 'du'. Preserve every fact and do not invent information. Return ONLY the replacement text."
            Action.SIE -> "Rewrite German text using natural formal 'Sie' forms consistently. If the text is not German, translate it into natural German using 'Sie'. Preserve every fact and do not invent information. Return ONLY the replacement text."
        }

        return request(baseUrl, text, withGlossary(instructions, glossary), privacyShield)
    }
    fun reply(
        baseUrl: String,
        message: String,
        instruction: String,
        target: String,
        privacyShield: Boolean = true,
        glossary: Collection<String> = emptyList()
    ): CloudResult {
        require(message.isNotBlank()) { "Copy or select the message you want to reply to first." }
        val payload = buildString {
            append("RECEIVED MESSAGE:\n")
            append(message.trim().take(8000))
            if (instruction.isNotBlank()) {
                append("\n\nUSER REPLY INSTRUCTION:\n")
                append(instruction.trim().take(1200))
            }
        }
        val instructions = "You are Ana Keyboard's Reply tool. Write the final ready-to-send reply in $target to the RECEIVED MESSAGE. If USER REPLY INSTRUCTION is present, follow it precisely. Match the context and level of formality naturally. Never invent facts, names, dates, promises, availability, prices, commitments or personal details not supplied by the user. Do not explain what you are doing. Do not quote the source message unless necessary. Return ONLY the reply text."
        return request(baseUrl, payload, withGlossary(instructions, glossary), privacyShield)
    }

    fun cleanDictation(
        baseUrl: String,
        text: String,
        languageHint: String,
        privacyShield: Boolean = true,
        glossary: Collection<String> = emptyList()
    ): CloudResult {
        require(text.isNotBlank()) { "Nothing was dictated." }
        val languageRule = if (languageHint.contains("Hindi", ignoreCase = true)) {
            "Keep natural Hindi/Hinglish transliteration in Latin script unless the speaker clearly dictated another language."
        } else {
            "Keep the same language as the dictated speech."
        }
        val instructions = "You are Ana Keyboard's Clean Dictation engine. $languageRule Remove filler words and false starts only when meaning is clear. Resolve spoken self-corrections such as '4 pm, actually 3 pm' by keeping the corrected value. Add natural punctuation and capitalization. Preserve names, technical terminology, numbers, dates, URLs, commitments and meaning. Do not summarize, shorten or add information. Return ONLY the cleaned dictated text."
        return request(baseUrl, text, withGlossary(instructions, glossary), privacyShield)
    }

    fun voiceEdit(
        baseUrl: String,
        text: String,
        command: String,
        target: String,
        privacyShield: Boolean = true,
        glossary: Collection<String> = emptyList()
    ): CloudResult {
        require(text.isNotBlank()) { "Select text to edit first." }
        require(command.isNotBlank()) { "No voice editing instruction was heard." }
        val instructions = "You are Ana Keyboard's voice editing tool. Apply this user instruction to the supplied text: '${command.take(500)}'. Preserve facts, names, numbers, URLs and commitments unless the instruction explicitly asks to transform language or tone. Preferred target language when translation is requested: $target. Return ONLY the finished replacement text."
        return request(baseUrl, text, withGlossary(instructions, glossary), privacyShield)
    }

    private fun withGlossary(instructions: String, glossary: Collection<String>): String {
        val terms = glossary.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(40)
        if (terms.isEmpty()) return instructions
        return instructions + "\n\nUSER GLOSSARY — preserve these terms exactly unless the user explicitly asks to translate them: " + terms.joinToString(", ")
    }

}
