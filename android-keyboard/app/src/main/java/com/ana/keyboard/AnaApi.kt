package com.ana.keyboard

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object AnaApi {
    enum class Action { TRANSLATE, FIX, TONE, SHORTER, WRITE }

    fun transform(baseUrl: String, text: String, action: Action, target: String): String {
        require(baseUrl.startsWith("https://")) { "Set the Ana https address in the Ana Keyboard app first." }
        require(text.isNotBlank()) { "There is no text to change." }

        val instructions = when (action) {
            Action.TRANSLATE -> "You are Ana Keyboard. Translate the user's text into $target. Preserve every fact, name, number, URL and intention. Make it sound natural to a native speaker. Return ONLY the finished replacement text, with no labels, explanations or quotation marks."
            Action.FIX -> "You are Ana Keyboard. Correct spelling, grammar and punctuation in the user's text while preserving its language, meaning, names, facts, tone and level of formality. Complete only an obviously unfinished phrase when the intended meaning is clear. Return ONLY the corrected replacement text."
            Action.TONE -> "You are Ana Keyboard. Rewrite the user's text in the same language so it sounds warm, natural and appropriately polite without becoming wordy. Preserve every factual detail and request. Return ONLY the replacement text."
            Action.SHORTER -> "You are Ana Keyboard. Rewrite the user's text in the same language to be shorter and clearer while preserving all important facts, requests, names, dates and numbers. Return ONLY the replacement text."
            Action.WRITE -> "You are Ana Keyboard's Writing Tool. The user's text is an instruction describing what they want to write. Draft the finished message in $target. Make it natural, clear and appropriate for everyday communication. Preserve every fact the user supplied and do not invent names, dates, promises, prices, commitments or personal details. Return ONLY the finished message, with no labels, explanations or quotation marks."
        }

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
}
