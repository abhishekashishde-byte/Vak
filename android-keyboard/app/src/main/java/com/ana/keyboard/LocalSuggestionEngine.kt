package com.ana.keyboard

import android.content.Context
import android.view.textservice.SpellCheckerSession
import android.view.textservice.SuggestionsInfo
import android.view.textservice.TextInfo
import android.view.textservice.TextServicesManager
import java.util.Locale
import java.util.concurrent.Executors

class LocalSuggestionEngine(
    private val context: Context,
    private val onResult: (word: String, suggestions: List<String>, looksLikeTypo: Boolean) -> Unit
) : SpellCheckerSession.SpellCheckerSessionListener {

    private data class Pending(
        val word: String,
        val local: CoreLexicon.Result
    )

    private val manager = context.getSystemService(Context.TEXT_SERVICES_MANAGER_SERVICE) as TextServicesManager
    private val offline = OfflineFrequencyLexicon(context.applicationContext)
    private val worker = Executors.newSingleThreadExecutor()
    private var session: SpellCheckerSession? = null
    private var badge = ""
    private var sequence = 0
    private val requests = mutableMapOf<Int, Pending>()
    private var personalWords = emptySet<String>()
    private var learnedCorrections = emptyMap<String, String>()

    init {
        worker.execute { offline.warmUp() }
    }

    fun setLanguage(inputBadge: String) {
        if (badge == inputBadge && session != null) {
            refreshUserData()
            return
        }
        badge = inputBadge
        refreshUserData()
        session?.close()
        requests.clear()
        val locale = when (inputBadge) {
            "DE" -> Locale.GERMANY
            "HIN" -> Locale.forLanguageTag("en-IN")
            else -> Locale.ENGLISH
        }
        session = manager.newSpellCheckerSession(null, locale, this, true)
    }

    fun refreshUserData() {
        val effectiveBadge = if (badge.isBlank()) "EN" else badge
        personalWords = KeyboardPrefs.personalDictionary(context, effectiveBadge)
            .map { it.lowercase() }
            .toSet()
        learnedCorrections = KeyboardPrefs.learnedCorrections(context, effectiveBadge)
            .mapKeys { it.key.lowercase() }
            .mapValues { it.value.lowercase() }
    }

    fun localResult(word: String): CoreLexicon.Result {
        val clean = word.trim().lowercase()
        if (clean in personalWords) return CoreLexicon.Result(emptyList(), false)
        learnedCorrections[clean]?.let { replacement ->
            return CoreLexicon.Result(listOf(replacement), true)
        }
        val effectiveBadge = if (badge.isBlank()) "EN" else badge
        return offline.suggestions(clean, effectiveBadge)
            ?: CoreLexicon.suggestions(clean, effectiveBadge)
    }

    fun decodeGlide(sequence: String): String? {
        val clean = sequence.trim().lowercase()
        learnedCorrections[clean]?.let { return it }
        val effectiveBadge = if (badge.isBlank()) "EN" else badge
        return offline.decodeGlide(clean, effectiveBadge)
            ?: CoreLexicon.decodeGlide(clean, effectiveBadge)
    }

    fun request(word: String) {
        val clean = word.trim()
        if (clean.length < 2) {
            onResult(clean, emptyList(), false)
            return
        }

        val lower = clean.lowercase()
        if (lower in personalWords) {
            onResult(clean, emptyList(), false)
            return
        }
        learnedCorrections[lower]?.let { replacement ->
            onResult(clean, listOf(replacement), true)
            return
        }

        val effectiveBadge = if (badge.isBlank()) "EN" else badge
        worker.execute {
            val local = offline.suggestions(clean, effectiveBadge)
                ?: CoreLexicon.suggestions(clean, effectiveBadge)
            onResult(clean, local.suggestions, local.highConfidenceTypo)
        }

        if (session == null) setLanguage(effectiveBadge)
        val currentSession = session ?: return
        val fallback = CoreLexicon.suggestions(clean, effectiveBadge)
        val id = ++sequence
        synchronized(requests) { requests[id] = Pending(clean, fallback) }
        currentSession.getSuggestions(TextInfo(clean, 0, id), 5)
    }

    override fun onGetSuggestions(results: Array<SuggestionsInfo>) {
        results.forEach { info ->
            val pending = synchronized(requests) { requests.remove(info.sequence) } ?: return@forEach
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
            if (merged.isNotEmpty() || platformTypo || pending.local.highConfidenceTypo) {
                onResult(
                    pending.word,
                    merged,
                    platformTypo || pending.local.highConfidenceTypo
                )
            }
        }
    }

    override fun onGetSentenceSuggestions(results: Array<out android.view.textservice.SentenceSuggestionsInfo>?) = Unit

    fun close() {
        synchronized(requests) { requests.clear() }
        session?.close()
        session = null
        worker.shutdownNow()
    }
}
