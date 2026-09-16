package com.ana.keyboard

import android.content.Context
import kotlin.math.abs
import kotlin.math.ln

/**
 * Offline word-frequency dictionary bundled into the APK by CI.
 * Normal typing never makes a network request.
 */
class OfflineFrequencyLexicon(private val context: Context) {
    private data class Entry(val word: String, val frequency: Long)
    private data class Dictionary(
        val exact: Set<String>,
        val byFirstAndLength: Map<Char, Map<Int, List<Entry>>>
    )

    private val dictionaries = mutableMapOf<String, Dictionary?>()

    fun warmUp() {
        dictionary("EN")
        dictionary("DE")
    }

    fun suggestions(input: String, badge: String, max: Int = 5): CoreLexicon.Result? {
        val clean = normalize(input)
        if (clean.length < 2) return CoreLexicon.Result(emptyList(), false)
        val dict = dictionary(badge) ?: return null
        if (clean in dict.exact) return CoreLexicon.Result(emptyList(), false)

        val first = clean.first()
        val candidateFirstLetters = dict.byFirstAndLength.keys.filter { it == first || keyboardAdjacent(first, it) }
        if (candidateFirstLetters.isEmpty()) return CoreLexicon.Result(emptyList(), false)

        val maxEdit = when {
            clean.length <= 4 -> 10
            clean.length <= 7 -> 16
            else -> 20
        }

        val candidates = ArrayList<Pair<Entry, Int>>()
        for (candidateFirst in candidateFirstLetters) {
            val buckets = dict.byFirstAndLength[candidateFirst] ?: continue
            for (length in (clean.length - 2).coerceAtLeast(2)..(clean.length + 2)) {
                for (entry in buckets[length].orEmpty()) {
                    val distance = weightedDamerau(clean, entry.word, maxEdit)
                    if (distance <= maxEdit) candidates += entry to distance
                }
            }
        }
        if (candidates.isEmpty()) return CoreLexicon.Result(emptyList(), false)

        val ranked = candidates.sortedWith(
            compareBy<Pair<Entry, Int>> { it.second }
                .thenByDescending { it.first.frequency }
        )
        val words = ranked.take(max).map { it.first.word }
        val top = ranked.first()
        val second = ranked.getOrNull(1)
        val margin = if (second == null) 99 else second.second - top.second
        val confidence = when {
            top.second <= 6 -> true
            top.second <= 10 && (margin > 0 || top.first.frequency >= 20_000L) -> true
            clean.length >= 6 && top.second <= 16 && margin >= 4 -> true
            else -> false
        }
        return CoreLexicon.Result(words, confidence)
    }

    fun decodeGlide(sequence: String, badge: String): String? {
        val trace = collapse(normalize(sequence))
        if (trace.length < 3) return null
        val dict = dictionary(badge) ?: return null
        val firstLetters = dict.byFirstAndLength.keys.filter { it == trace.first() || keyboardAdjacent(trace.first(), it) }

        var best: Entry? = null
        var bestScore = Int.MAX_VALUE
        val minLength = 3
        val maxLength = (trace.length + 2).coerceAtMost(16)
        for (first in firstLetters) {
            val firstBuckets = dict.byFirstAndLength[first] ?: continue
            for (length in minLength..maxLength) {
                for (entry in firstBuckets[length].orEmpty()) {
                    if (entry.word.lastOrNull() != trace.lastOrNull() && !keyboardAdjacent(entry.word.last(), trace.last())) continue
                    val pathPenalty = glidePenalty(trace, entry.word)
                    if (pathPenalty >= 60) continue
                    val frequencyBonus = (ln(entry.frequency.coerceAtLeast(1).toDouble()) * 1.8).toInt()
                    val score = pathPenalty * 10 - frequencyBonus
                    if (score < bestScore) {
                        bestScore = score
                        best = entry
                    }
                }
            }
        }
        val match = best ?: return null
        return match.word.takeIf { bestScore < 230 }
    }

    private fun dictionary(badge: String): Dictionary? {
        val key = when (badge) {
            "DE" -> "DE"
            "EN" -> "EN"
            else -> return null
        }
        synchronized(dictionaries) {
            if (dictionaries.containsKey(key)) return dictionaries[key]
            val asset = if (key == "DE") "de_freq.txt" else "en_freq.txt"
            val loaded = try {
                val entries = ArrayList<Entry>(30_000)
                context.assets.open(asset).bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        val split = line.trim().split(Regex("\\s+"), limit = 2)
                        if (split.size != 2) return@forEach
                        val word = normalize(split[0])
                        if (word.length < 2 || word.length > 18) return@forEach
                        val frequency = split[1].toLongOrNull() ?: return@forEach
                        entries += Entry(word, frequency)
                    }
                }
                val exact = entries.mapTo(HashSet(entries.size * 2)) { it.word }
                val grouped = entries
                    .groupBy { it.word.first() }
                    .mapValues { (_, list) -> list.groupBy { it.word.length } }
                Dictionary(exact, grouped)
            } catch (_: Exception) {
                null
            }
            dictionaries[key] = loaded
            return loaded
        }
    }

    private fun normalize(value: String): String = value
        .lowercase()
        .filter { it in 'a'..'z' || it in 'ä'..'ü' || it == 'ß' }

    private fun collapse(value: String): String {
        if (value.isEmpty()) return value
        val out = StringBuilder(value.length)
        var last: Char? = null
        value.forEach { ch ->
            if (ch != last) out.append(ch)
            last = ch
        }
        return out.toString()
    }

    private fun glidePenalty(trace: String, word: String): Int {
        var endpointPenalty = 0
        if (trace.firstOrNull() != word.firstOrNull()) endpointPenalty += 6
        if (trace.lastOrNull() != word.lastOrNull()) endpointPenalty += 6

        var wi = 0
        var extras = 0
        trace.forEach { ch ->
            if (wi < word.length && ch == word[wi]) wi++ else extras++
        }
        if (wi == word.length) {
            return endpointPenalty + extras * 3 + abs(trace.length - word.length)
        }

        val edit = weightedDamerau(trace, word, 30)
        return endpointPenalty + edit + abs(trace.length - word.length) * 2
    }

    /** Costs are scaled by 10. Adjacent-key substitutions are cheaper. */
    private fun weightedDamerau(a: String, b: String, cutoff: Int): Int {
        if (a == b) return 0
        if (abs(a.length - b.length) * 10 > cutoff) return cutoff + 1

        var prevPrev = IntArray(b.length + 1) { it * 10 }
        var prev = IntArray(b.length + 1) { it * 10 }
        var curr = IntArray(b.length + 1)

        for (i in 1..a.length) {
            curr[0] = i * 10
            var rowMin = curr[0]
            for (j in 1..b.length) {
                val subCost = when {
                    a[i - 1] == b[j - 1] -> 0
                    keyboardAdjacent(a[i - 1], b[j - 1]) -> 6
                    else -> 10
                }
                var value = minOf(
                    prev[j] + 10,
                    curr[j - 1] + 10,
                    prev[j - 1] + subCost
                )
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                    value = minOf(value, prevPrev[j - 2] + 7)
                }
                curr[j] = value
                rowMin = minOf(rowMin, value)
            }
            if (rowMin > cutoff) return cutoff + 1
            val temp = prevPrev
            prevPrev = prev
            prev = curr
            curr = temp
        }
        return prev[b.length]
    }

    private fun keyboardAdjacent(a: Char, b: Char): Boolean {
        val positions = qwertyPositions
        val pa = positions[a] ?: return false
        val pb = positions[b] ?: return false
        val dx = pa.first - pb.first
        val dy = pa.second - pb.second
        return dx * dx + dy * dy <= 2.1f
    }

    companion object {
        private val qwertyPositions: Map<Char, Pair<Float, Float>> = buildMap {
            "qwertyuiop".forEachIndexed { i, c -> put(c, i.toFloat() to 0f) }
            "asdfghjkl".forEachIndexed { i, c -> put(c, (i + 0.5f) to 1f) }
            "zxcvbnm".forEachIndexed { i, c -> put(c, (i + 1.0f) to 2f) }
        }
    }
}
