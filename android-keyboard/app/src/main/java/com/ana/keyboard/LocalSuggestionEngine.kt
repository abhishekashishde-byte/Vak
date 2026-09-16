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

    private val manager = context.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE) as TextServicesManager
    private var session: SpellCheckerSession? = null
    private var badge = ""
    private var sequence = 0
    private val requests = mutableMapOf<Int, String>()

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

    fun request(word: String) {
        val clean = word.trim()
        if (clean.length < 2) {
            onResult(clean, emptyList(), false)
            return
        }
        if (session == null) setLanguage(if (badge.isBlank()) "EN" else badge)
        val currentSession = session ?: run {
            onResult(clean, emptyList(), false)
            return
        }
        val id = ++sequence
        requests[id] = clean
        currentSession.getSuggestions(TextInfo(clean, 0, id), 5)
    }

    override fun onGetSuggestions(results: Array<SuggestionsInfo>) {
        results.forEach { info ->
            val word = requests.remove(info.sequence) ?: return@forEach
            val suggestions = buildList {
                for (i in 0 until info.suggestionsCount) {
                    val value = info.getSuggestionAt(i)?.trim().orEmpty()
                    if (value.isNotEmpty() && none { it.equals(value, ignoreCase = true) }) add(value)
                }
            }
            val typo = info.suggestionsAttributes and SuggestionsInfo.RESULT_ATTR_LOOKS_LIKE_TYPO != 0
            onResult(word, suggestions, typo)
        }
    }

    override fun onGetSentenceSuggestions(results: Array<out android.view.textservice.SentenceSuggestionsInfo>?) = Unit

    fun close() {
        requests.clear()
        session?.close()
        session = null
    }
}
