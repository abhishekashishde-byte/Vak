package com.ana.keyboard

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object AnaApi {
    enum class Action { TRANSLATE, FIX, TONE, SHORTER, WRITE }

    private val paragraphCache = object : LinkedHashMap<String, String>(24, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > 24
    }

    fun correctParagraph(baseUrl: String, text: String, languageHint: String): String {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no paragraph to correct." }

        val cacheKey = "$languageHint\u0000$text"
        synchronized(paragraphCache) {
            paragraphCache[cacheKey]?.let { return it }
        }

        val instructions = "You are Ana Keyboard's Smart Paragraph Correction. The user is typing in $languageHint. Keep the SAME language; do not translate. Review the ENTIRE paragraph, including earlier sentences that may still contain missed keyboard slips. Correct high-confidence spelling mistakes, missing or duplicated letters, nearby-key typos, grammar, punctuation, missing articles or prepositions, and clearly wrong word order. Use the surrounding paragraph to infer an intended word when the typed word is wrong but the meaning is clear. Leave uncertain names, specialist terms and intentional wording unchanged. Preserve the user's meaning, tone, paragraph structure, names, numbers, URLs and facts. Preserve text that is already correct; do not make stylistic rewrites and do not add new information. Return ONLY the corrected paragraph, with no labels, explanations or quotation marks."
        val corrected = request(baseUrl, text, instructions)
        synchronized(paragraphCache) { paragraphCache[cacheKey] = corrected }
        return corrected
    }

    private fun request(baseUrl: String, text: String, instructions: String): String {
        val endpoint = URL(baseUrl.trimEnd('/') + "/api/translate")
        val connection = endpoint.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 12_000
        connection.readTimeout = 25_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")

        val body = JSONObject()
            .put("text", text)
            .put("instructions", instructions)
            .toString()

        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val response = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        val json = JSONObject(response.ifBlank { "{}" })

        if (connection.responseCode !in 200..299) {
            throw IllegalStateException(json.optString("error", "Ana request failed (${connection.responseCode})."))
        }
        return json.optString("content").trim().ifBlank { throw IllegalStateException("Ana returned no text.") }
    }

    fun transform(baseUrl: String, text: String, action: Action, target: String): String {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no text to change." }

        val instructions = when (action) {
            Action.TRANSLATE -> "You are Ana Keyboard. Translate the user's text into $target. Preserve every fact, name, number, URL and intention. Make it sound natural to a native speaker. Return ONLY the finished replacement text, with no labels, explanations or quotation marks."
            Action.FIX -> "You are Ana Keyboard's Correct tool. Correct spelling, grammar, punctuation and wording so the final text is natural $target. If the user's text is partly or entirely in another language, convert it to $target while preserving its meaning, names, facts, tone and level of formality. Do not shorten it or invent information. Return ONLY the corrected replacement text, with no labels or explanations."
            Action.TONE -> "You are Ana Keyboard. Rewrite the user's text in the same language so it sounds warm, natural and appropriately polite without becoming wordy. Preserve every factual detail and request. Return ONLY the replacement text."
            Action.SHORTER -> "You are Ana Keyboard. Rewrite the user's text in the same language to be shorter and clearer while preserving all important facts, requests, names, dates and numbers. Return ONLY the replacement text."
            Action.WRITE -> "You are Ana Keyboard's Writing Tool. The user's text is an instruction describing what they want to write. Draft the finished message in $target. Make it natural, clear and appropriate for everyday communication. Preserve every fact the user supplied and do not invent names, dates, promises, prices, commitments or personal details. Return ONLY the finished message, with no labels, explanations or quotation marks."
        }

        return request(baseUrl, text, instructions)
    }
}
