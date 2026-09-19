package com.ana.keyboard

/**
 * Tiny local tie-breaker for ambiguous physical taps.
 *
 * Spatial intent always dominates. Language context is only allowed to choose an
 * alternate key when its spatial probability is already very close to the top key.
 */
object TouchLanguageRanker {
    private val englishBigrams = setOf(
        "th","he","in","er","an","re","on","at","en","nd","ti","es","or","te","of","ed",
        "is","it","al","ar","st","to","nt","ng","se","ha","as","ou","io","le","ve","co",
        "me","de","hi","ri","ro","ic","ne","ea","ra","ce","li","ch","ll","be","ma","si","om"
    )
    private val germanBigrams = setOf(
        "er","en","ch","de","ei","te","in","nd","ie","ge","st","ne","be","es","un","re",
        "he","an","se","di","au","sc","ht","ic","ng","le","da","it","is","ra","zu","nn",
        "ss","tt","ll","mm","ei","eu","äu","sp","tr","fr","pr","gr","kl"
    )

    fun choose(
        candidates: List<SpatialTouchDecoder.Candidate>,
        currentPrefix: String,
        languageBadge: String,
        knownPrefixes: Set<String>
    ): String? {
        val top = candidates.firstOrNull() ?: return null
        if (!top.letter || top.code.length != 1 || candidates.size == 1) return top.code

        val prefix = currentPrefix.lowercase().takeLast(20)
        val last = prefix.lastOrNull()
        val bigrams = if (languageBadge == "DE") germanBigrams else englishBigrams

        var bestCode = top.code
        var bestScore = top.probability
        for (candidate in candidates.take(3)) {
            if (!candidate.letter || candidate.code.length != 1) continue
            // Never let language context overturn a clearly better spatial hit.
            if (top.probability - candidate.probability > 0.14f) continue

            val code = candidate.code.lowercase()
            var score = candidate.probability
            if (last != null && (last.toString() + code) in bigrams) score += 0.035f
            if ((prefix + code) in knownPrefixes) score += 0.085f

            if (score > bestScore) {
                bestScore = score
                bestCode = candidate.code
            }
        }
        return bestCode
    }

    fun buildPrefixSet(words: Collection<String>, maxPrefixLength: Int = 20): Set<String> {
        val result = HashSet<String>()
        for (word in words) {
            val clean = word.trim().lowercase()
            if (clean.length < 2) continue
            val end = minOf(clean.length, maxPrefixLength)
            for (i in 1..end) result += clean.substring(0, i)
        }
        return result
    }
}
