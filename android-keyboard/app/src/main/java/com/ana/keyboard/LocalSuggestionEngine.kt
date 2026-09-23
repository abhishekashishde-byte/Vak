package com.ana.keyboard

import android.content.Context
import java.util.concurrent.Executors

/**
 * Local-only correction engine. Heavy dictionary and glide work runs on a worker
 * so a normal key press never waits for spell checking.
 */
class LocalSuggestionEngine(
    private val context: Context,
    private val onResult: (word: String, suggestions: List<String>, looksLikeTypo: Boolean) -> Unit,
    private val onNextResult: (previous: String, suggestions: List<String>) -> Unit = { _, _ -> }
) {
    private val offline = OfflineFrequencyLexicon(context.applicationContext)
    private val worker = Executors.newSingleThreadExecutor()

    @Volatile private var badge = "EN"
    @Volatile private var personalWords = emptySet<String>()
    @Volatile private var learnedCorrections = emptyMap<String, String>()

    fun setLanguage(inputBadge: String) {
        badge = inputBadge.ifBlank { "EN" }
        refreshUserData()
    }

    fun refreshUserData() {
        val effectiveBadge = badge.ifBlank { "EN" }
        personalWords = KeyboardPrefs.personalDictionary(context, effectiveBadge)
            .map { it.lowercase() }
            .toSet()
        learnedCorrections = KeyboardPrefs.learnedCorrections(context, effectiveBadge)
            .mapKeys { it.key.lowercase() }
            .mapValues { it.value.lowercase() }
    }

    /** Fast result only: small built-in lexicon + personal learning. Safe on the UI thread. */
    fun fastResult(word: String): CoreLexicon.Result {
        val clean = word.trim().lowercase()
        if (clean in personalWords) return CoreLexicon.Result(emptyList(), false)
        learnedCorrections[clean]?.let { return CoreLexicon.Result(listOf(it), true) }
        return CoreLexicon.suggestions(clean, badge.ifBlank { "EN" })
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
        learnedCorrections[lower]?.let {
            onResult(clean, listOf(it), true)
            return
        }

        val requestBadge = badge.ifBlank { "EN" }
        worker.execute {
            val result = offline.suggestions(clean, requestBadge)
                ?: CoreLexicon.suggestions(clean, requestBadge)
            if (requestBadge == badge) onResult(clean, result.suggestions, result.highConfidenceTypo)
        }
    }

    fun requestNext(previous: String) {
        val clean = previous.trim().lowercase()
        if (clean.length < 2) {
            onNextResult(clean, emptyList())
            return
        }
        val requestBadge = badge.ifBlank { "EN" }
        worker.execute {
            val learned = KeyboardPrefs.nextWordSuggestions(context, clean, requestBadge, 3)
            val builtIn = CoreLexicon.nextWords(clean, requestBadge, 3)
            val combined = (learned + builtIn)
                .distinctBy { it.lowercase() }
                .take(3)
            if (requestBadge == badge) onNextResult(clean, combined)
        }
    }

    fun learnTransition(previous: String, next: String) {
        val from = previous.trim().lowercase()
        val to = next.trim().lowercase()
        val requestBadge = badge.ifBlank { "EN" }
        if (from.length < 2 || to.length < 2 || from == to) return
        worker.execute { KeyboardPrefs.learnNextWord(context, from, to, requestBadge) }
    }

    fun decodeGlideAsync(trace: AnaKeyboardView.GlideTrace, onDecoded: (String?) -> Unit) {
        val requestBadge = badge.ifBlank { "EN" }
        val raw = trace.sequence.trim().lowercase()
        learnedCorrections[raw]?.let {
            onDecoded(it)
            return
        }
        worker.execute {
            val decoded = offline.decodeGlide(trace, requestBadge)
                ?: CoreLexicon.decodeGlide(raw, requestBadge)
            if (requestBadge == badge) onDecoded(decoded)
        }
    }

    fun close() {
        worker.shutdownNow()
    }
}
