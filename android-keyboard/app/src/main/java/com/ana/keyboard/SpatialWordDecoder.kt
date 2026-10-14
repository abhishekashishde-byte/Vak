package com.ana.keyboard

import kotlin.math.ln
import kotlin.math.max

/**
 * Offline word-level beam decoder. Keeps alternative letters until a word boundary
 * rather than making an irreversible per-key decision.
 * No user text or touch coordinates leave the device.
 */
class SpatialWordDecoder(
    private val dictionary: Collection<String>,
    private val beamWidth: Int = 24
) {
    data class Hypothesis(val text: String, val score: Double)
    private val words = dictionary.map { it.lowercase() }.filter { it.length >= 2 }.distinct()
    private val wordSet = words.toHashSet()
    private val prefixes = HashSet<String>().apply {
        for (word in words) for (n in 1..word.length) add(word.substring(0, n))
    }
    private var beams = listOf(Hypothesis("", 0.0))

    fun reset() { beams = listOf(Hypothesis("", 0.0)) }

    fun append(candidates: List<SpatialTouchDecoder.Candidate>): List<Hypothesis> {
        val letters = candidates.filter { it.letter && it.code.length == 1 }
        if (letters.isEmpty()) return ranked()
        val next = HashMap<String, Double>()
        for (hypothesis in beams) for (candidate in letters) {
            val candidateText = hypothesis.text + candidate.code.lowercase()
            if (candidateText !in prefixes) continue
            val score = hypothesis.score + ln(max(0.00001, candidate.probability.toDouble()))
            if (score > (next[candidateText] ?: Double.NEGATIVE_INFINITY)) next[candidateText] = score
        }
        // Do not discard a user's literal input if the dictionary has no match.
        if (next.isNotEmpty()) beams = next.entries.sortedByDescending { it.value }
            .take(beamWidth.coerceIn(2, 128)).map { Hypothesis(it.key, it.value) }
        return ranked()
    }

    fun ranked(limit: Int = 3): List<Hypothesis> =
        beams.sortedWith(compareByDescending<Hypothesis> {
            it.score + if (it.text in wordSet) 0.35 else 0.0
        }).take(limit)

    fun completedWords(limit: Int = 3): List<Hypothesis> =
        ranked(beamWidth).filter { it.text in wordSet }.take(limit)

    fun decode(taps: List<List<SpatialTouchDecoder.Candidate>>, limit: Int = 3): List<Hypothesis> {
        reset()
        taps.forEach { append(it) }
        return completedWords(limit)
    }
}
