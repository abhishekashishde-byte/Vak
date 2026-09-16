package com.ana.keyboard

import android.content.Context
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * Offline word-frequency dictionary bundled into the APK by CI.
 * All expensive matching runs through LocalSuggestionEngine's worker thread.
 */
class OfflineFrequencyLexicon(private val context: Context) {
    private data class Entry(val word: String, val frequency: Long)
    private data class Dictionary(
        val exactFrequency: Map<String, Long>,
        val byFirstAndLength: Map<Char, Map<Int, List<Entry>>>,
        val entries: List<Entry>
    )

    private val dictionaries = mutableMapOf<String, Dictionary?>()

    fun suggestions(input: String, badge: String, max: Int = 5): CoreLexicon.Result? {
        val clean = normalize(input)
        if (clean.length < 2) return CoreLexicon.Result(emptyList(), false)
        val dict = dictionary(badge) ?: return null
        val exactFrequency = dict.exactFrequency[clean]

        if (exactFrequency != null && exactFrequency >= 5_000L) {
            return CoreLexicon.Result(emptyList(), false)
        }

        val maxCost = when {
            clean.length <= 4 -> 10
            clean.length <= 7 -> 16
            else -> 20
        }

        val candidates = ArrayList<Pair<Entry, Int>>()
        for (first in candidateFirstChars(clean.first())) {
            val buckets = dict.byFirstAndLength[first] ?: continue
            for (length in (clean.length - 2).coerceAtLeast(2)..(clean.length + 2)) {
                for (entry in buckets[length].orEmpty()) {
                    if (entry.word == clean) continue
                    val distance = weightedDamerau(clean, entry.word, maxCost)
                    if (distance <= maxCost) candidates += entry to distance
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

        val confident = if (exactFrequency != null) {
            top.second <= 10 && top.first.frequency >= exactFrequency.coerceAtLeast(1L) * 20L
        } else {
            when {
                top.second <= 6 -> true
                top.second <= 10 && (margin > 0 || top.first.frequency >= 20_000L) -> true
                clean.length >= 6 && top.second <= 16 && margin >= 4 -> true
                else -> false
            }
        }
        return CoreLexicon.Result(words, confident)
    }

    /** Decode against the actual finger path instead of every crossed key. */
    fun decodeGlide(trace: AnaKeyboardView.GlideTrace, badge: String): String? {
        val points = trace.points
        if (points.size < 2) return null
        val dict = dictionary(badge) ?: return null
        val centers = trace.keyCenters
        if (centers.isEmpty()) return null

        val start = points.first()
        val end = points.last()
        val sampledGesture = resample(points, 18)
        var best: Entry? = null
        var bestScore = Double.MAX_VALUE
        var secondScore = Double.MAX_VALUE

        for (entry in dict.entries) {
            val word = entry.word
            if (word.length !in 2..14) continue
            val firstCenter = centers[word.first()] ?: continue
            val lastCenter = centers[word.last()] ?: continue
            val startDistance = distance(start, firstCenter)
            val endDistance = distance(end, lastCenter)
            if (startDistance > 0.20f || endDistance > 0.22f) continue

            val wordPath = word.mapNotNull { centers[it] }
            if (wordPath.size != word.length) continue
            val sampledWord = resample(wordPath, 18)
            var geometric = 0.0
            for (i in sampledGesture.indices) {
                val dx = sampledGesture[i].x - sampledWord[i].x
                val dy = sampledGesture[i].y - sampledWord[i].y
                geometric += sqrt((dx * dx + dy * dy).toDouble())
            }
            geometric /= sampledGesture.size

            val complexityPenalty = abs(word.length - trace.sequence.length.coerceIn(2, 12)) * 0.004
            val endpointPenalty = (startDistance + endDistance) * 0.22
            val frequencyBonus = ln(entry.frequency.coerceAtLeast(1L).toDouble()) * 0.0017
            val score = geometric + complexityPenalty + endpointPenalty - frequencyBonus

            if (score < bestScore) {
                secondScore = bestScore
                bestScore = score
                best = entry
            } else if (score < secondScore) {
                secondScore = score
            }
        }

        val match = best ?: return decodeGlide(trace.sequence, badge)
        if (bestScore > 0.19) return decodeGlide(trace.sequence, badge)
        if (secondScore < Double.MAX_VALUE && secondScore - bestScore < 0.002 && match.frequency < 2_000L) {
            return decodeGlide(trace.sequence, badge)
        }
        return match.word
    }

    /** Sequence-only fallback when geometric confidence is poor. */
    fun decodeGlide(sequence: String, badge: String): String? {
        val trace = collapse(normalize(sequence))
        if (trace.length < 2) return null
        val dict = dictionary(badge) ?: return null

        var best: Entry? = null
        var bestScore = Int.MAX_VALUE
        for (entry in dict.entries) {
            val candidate = entry.word
            if (candidate.length !in 2..14) continue
            if (candidate.first() != trace.first() && !keyboardAdjacent(candidate.first(), trace.first())) continue
            val maxCost = when {
                candidate.length <= 4 -> 24
                candidate.length <= 7 -> 34
                else -> 44
            }
            val distance = weightedDamerau(trace, candidate, maxCost)
            if (distance > maxCost) continue
            val frequencyBonus = (ln(entry.frequency.coerceAtLeast(1L).toDouble()) * 2.0).toInt()
            val score = distance * 10 + abs(candidate.length - trace.length) * 5 - frequencyBonus
            if (score < bestScore) {
                bestScore = score
                best = entry
            }
        }
        return best?.word?.takeIf { bestScore < 300 }
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
                val exact = HashMap<String, Long>(entries.size * 2)
                entries.forEach { exact[it.word] = maxOf(exact[it.word] ?: 0L, it.frequency) }
                val unique = entries.distinctBy { it.word }
                val grouped = unique
                    .groupBy { it.word.first() }
                    .mapValues { (_, list) -> list.groupBy { it.word.length } }
                Dictionary(exact, grouped, unique)
            } catch (_: Exception) {
                null
            }
            dictionaries[key] = loaded
            return loaded
        }
    }

    private fun candidateFirstChars(first: Char): Set<Char> {
        val origin = qwertyPositions[first] ?: return setOf(first)
        return buildSet {
            add(first)
            qwertyPositions.forEach { (char, pos) ->
                val dx = origin.first - pos.first
                val dy = origin.second - pos.second
                if (dx * dx + dy * dy <= 2.1f) add(char)
            }
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

    private fun distance(a: AnaKeyboardView.GlidePoint, b: AnaKeyboardView.GlidePoint): Float {
        val dx = a.x - b.x
        val dy = a.y - b.y
        return sqrt(dx * dx + dy * dy)
    }

    private fun resample(points: List<AnaKeyboardView.GlidePoint>, count: Int): List<AnaKeyboardView.GlidePoint> {
        if (points.size == 1) return List(count) { points.first() }
        val cumulative = FloatArray(points.size)
        for (i in 1 until points.size) {
            cumulative[i] = cumulative[i - 1] + distance(points[i - 1], points[i])
        }
        val total = cumulative.last()
        if (total <= 0.0001f) return List(count) { points.first() }

        return List(count) { sampleIndex ->
            val target = total * sampleIndex / (count - 1).coerceAtLeast(1)
            var segment = 1
            while (segment < cumulative.size && cumulative[segment] < target) segment++
            if (segment >= cumulative.size) points.last()
            else {
                val startLength = cumulative[segment - 1]
                val segmentLength = (cumulative[segment] - startLength).coerceAtLeast(0.0001f)
                val t = (target - startLength) / segmentLength
                val a = points[segment - 1]
                val b = points[segment]
                AnaKeyboardView.GlidePoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
            }
        }
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
        val pa = qwertyPositions[a] ?: return false
        val pb = qwertyPositions[b] ?: return false
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
