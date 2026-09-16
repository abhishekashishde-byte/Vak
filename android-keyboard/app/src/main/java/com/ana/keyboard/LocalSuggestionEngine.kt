package com.ana.keyboard

import android.content.Context
import android.view.textservice.SpellCheckerSession
import android.view.textservice.SuggestionsInfo
import android.view.textservice.TextInfo
import android.view.textservice.TextServicesManager
import java.util.Locale

class LocalSuggestionEngine(
    private val context: Context,
    private val onResult: (word: String, suggestions: List<String>, looksLikeTypo: Boolean) -> Unit
) : SpellCheckerSession.SpellCheckerSessionListener {

    private data class Pending(
        val word: String,
        val local: CoreLexicon.Result
    )

    private val manager = context.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE) as TextServicesManager
    private var session: SpellCheckerSession? = null
    private var badge = ""
    private var sequence = 0
    private val requests = mutableMapOf<Int, Pending>()

    fun setLanguage(inputBadge: String) {
        if (badge == inputBadge && session != null) return
        badge = inputBadge
        session?.close()
        requests.clear()
        val locale = when (inputBadge) {
            "DE" -> Locale.GERMANY
            "HIN" -> Locale.forLanguageTag("en-IN")
            else -> Locale.ENGLISH
        }
        session = manager.newSpellCheckerSession(null, locale, this, true)
    }

    fun localResult(word: String): CoreLexicon.Result =
        CoreLexicon.suggestions(word, if (badge.isBlank()) "EN" else badge)

    fun decodeGlide(sequence: String): String? =
        CoreLexicon.decodeGlide(sequence, if (badge.isBlank()) "EN" else badge)

    fun request(word: String) {
        val clean = word.trim()
        if (clean.length < 2) {
            onResult(clean, emptyList(), false)
            return
        }

        val local = localResult(clean)
        if (local.suggestions.isNotEmpty()) {
            onResult(clean, local.suggestions, local.highConfidenceTypo)
        }

        if (session == null) setLanguage(if (badge.isBlank()) "EN" else badge)
        val currentSession = session ?: run {
            if (local.suggestions.isEmpty()) onResult(clean, emptyList(), false)
            return
        }

        val id = ++sequence
        requests[id] = Pending(clean, local)
        currentSession.getSuggestions(TextInfo(clean, 0, id), 5)
    }

    override fun onGetSuggestions(results: Array<SuggestionsInfo>) {
        results.forEach { info ->
            val pending = requests.remove(info.sequence) ?: return@forEach
            val platform = mutableListOf<String>()
            for (i in 0 until info.suggestionsCount) {
                val value = info.getSuggestionAt(i)?.trim().orEmpty()
                if (value.isNotEmpty() && platform.none { existing -> existing.equals(value, ignoreCase = true) }) {
                    platform.add(value)
                }
            }
            val platformTypo = info.suggestionsAttributes and SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO != 0
            val merged = (platform + pending.local.suggestions)
                .filterNot { it.equals(pending.word, ignoreCase = true) }
                .distinctBy { it.lowercase() }
                .take(5)
            onResult(
                pending.word,
                merged,
                platformTypo || pending.local.highConfidenceTypo
            )
        }
    }

    override fun onGetSentenceSuggestions(results: Array<out android.view.textservice.SentenceSuggestionsInfo>?) = Unit

    fun close() {
        requests.clear()
        session?.close()
        session = null
    }
}
