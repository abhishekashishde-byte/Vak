package com.ana.keyboard

import kotlin.math.min

/**
 * Small, product-owned fallback lexicon for fast, offline correction/glide decoding.
 * Android's spell checker remains the primary source; this only fills gaps when the
 * device spell checker is slow or unavailable.
 */
object CoreLexicon {
    data class Match(val word: String, val distance: Int, val rank: Int)
    data class Result(val suggestions: List<String>, val highConfidenceTypo: Boolean)

    private val english = words("""
        the of and to a in is you that it he was for on are as with his they i at be this have from or one had by word
        but not what all were when we there can an your which their said if do will each about how up out them then she many
        some so these would other into has more her two him see time could no make than first been its who now people my made over
        did down only way find use may water long little very after words called just where most know get through back much before
        good new write writing right work world still own should around another came come want because any give day most us great think
        say help low line differ turn cause same mean move does set three small put end why again off went old number part take place
        sentence sentence form home read hand port large spell add even land here must big high such follow act ask men change light kind
        need house picture try really point mother father answer found study learn plant cover food sun four between state keep eye never
        last let thought city tree cross hard start might story saw far sea draw left late run while press close night real life few stop
        open seem together next white children begin got walk example ease paper often always music those both mark book letter until mile
        river car feet care second group carry took rain eat room friend began idea fish mountain north once base hear horse cut sure watch
        color face wood main enough plain girl usual young ready above ever red list though feel talk bird soon body dog family direct pose
        leave song measure door product black short numeral class wind question happen complete ship area half rock order fire south problem
        piece told knew pass since top whole king street inch multiply nothing course stay wheel full force blue object decide surface deep
        moon island foot yet busy test record boat common gold possible plane age dry wonder laugh thousand ago ran check game shape yes hot
        miss brought heat snow bed bring sit perhaps fill east weight language among unit power town fine certain fly fall lead cry dark machine
        note wait plan figure star box noun field rest correct able pound done beauty drive stood contain front teach week final gave green quick
        develop ocean warm free minute strong special mind behind clear tail produce fact street inch lot step early hold west ground interest reach
        fast five six table travel less morning ten simple several vowel toward war lay against pattern slow center love person money serve appear
        road map rain rule govern pull cold notice voice unit create reply message email keyboard typing type typed swipe swiped glide finger fingers
        correction correct corrected suggestion suggestions suggest spelling spell mistake mistakes wrong meaningful meaning suddenly sudden thinks
        think background image tint tinting feature required clipboard access provider mic microphone voice translate translation fix tone shorter
        birthday happy wonderful day filled happiness beautiful memories natural polite formal informal manager late german english hindi hinglish
        app button key keys layout distance letters letter fast faster lag lags smooth smoother responsive response press pressed popup theme settings
        word words writing wrote written write writer user users text textfield field input output insert inserted remove removed delete deleted select
        selected copy copied paste pasted local offline online device privacy cloud sound vibration emoji emojis gif search tool tools option options
        yuck word world work would could should which while where there their then this these those suddenly typing spelling correction keyboard
    """)

    private val german = words("""
        der die das und ist in zu den von mit sich des auf für im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei
        einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei wir was werden kann
        gegen vom können schon wenn habe seine mark ihre dann unter wir soll ich eines jahr zwei jahren diese dieser wieder keine uhr seiner worden
        will zwischen immer millionen was sagte gibt alle seit muss wurden beim doch jetzt drei jahre mit neue neuen damit bereits da auch ihr seine
        nach ohne sondern selbst ersten nun etwa heute weil ihm seinen menschen deutschland anderen wer vielen mir zeit gegen hätte leben machen
        sagen gut neu schreiben richtig arbeit welt wort wörter tastatur tippen schnell korrektur korrekt korrigieren vorschlag vorschläge rechts
        links oben unten sprache deutsch englisch hindi nachricht antwort email freund freundlich höflich formell informell bitte danke hallo morgen
        heute gestern später früher termin manager kunde lieferant familie geburtstag alles gute wünsche schönen tag glück liebe erinnerungen
        schreiben geschrieben text eingabe ausgabe kopieren einfügen zwischenablage mikrofon stimme übersetzen übersetzung kürzer ton hintergrund bild
        einstellungen thema farbe vibration ton taste tasten layout gleiten wischen wortvorschlag rechtschreibung fehler falsch richtig plötzlich
    """)

    private val hinglish = words("""
        hai hain ho hun main mein mera meri mere tum tumhara tumhari tumhare aap aapka aapki aapke hum hamara hamari hamare kya kaise kahan kab
        kyun kyon nahi nahin haan han acha accha achha theek thik bilkul bahut bohot thoda zyada kam kal aaj parso abhi baad pehle phir fir
        kar karo karna karunga karungi karte karti karta kiya karke krna krdo bhej bhejo bhejna bol bolo bolna bata batao batana de do dena lena
        lo aa aao aana ja jao jana gaya gayi gaye mil milna milte baat baatein msg message ghar office kaam time late jaldi please pls thanks
        thankyou sorry bhai didi papa mummy dost yaar acha laga lagta hoga hoga nahi chahiye chaiye sakta sakti sakte raha rahi rahe wala wali wale
        aur ya lekin agar toh to bhi bas ek do teen sab kuch koi ko se ke ka ki me mai apna apni apne mujhe tumhe hume unko usko isko yeh ye woh wo
        birthday happy wish wishes mast badiya sahi galat problem help reply likh likho translate german english hindi hinglish formal casual polite
    """)

    private fun words(raw: String): List<String> = raw
        .trimIndent()
        .split(Regex("\\s+"))
        .map { it.trim().lowercase() }
        .filter { it.length >= 2 }
        .distinct()

    private fun listFor(badge: String): List<String> = when (badge) {
        "DE" -> german
        "HIN" -> hinglish + english.take(180)
        else -> english
    }
    private val englishNext = mapOf(
        "thank" to listOf("you", "you!", "you."),
        "thanks" to listOf("for", "a", "so"),
        "how" to listOf("are", "is", "was"),
        "are" to listOf("you", "we", "there"),
        "can" to listOf("you", "we", "I"),
        "could" to listOf("you", "we", "I"),
        "please" to listOf("send", "check", "let"),
        "let" to listOf("me", "us", "you"),
        "i" to listOf("will", "am", "have"),
        "we" to listOf("can", "will", "need"),
        "meeting" to listOf("today", "tomorrow", "is"),
        "happy" to listOf("birthday", "to", "for"),
        "good" to listOf("morning", "luck", "idea"),
        "see" to listOf("you", "if", "the"),
        "talk" to listOf("to", "about", "later"),
        "next" to listOf("week", "time", "meeting"),
        "very" to listOf("much", "good", "happy"),
        "will" to listOf("be", "send", "check"),
        "need" to listOf("to", "the", "more"),
        "want" to listOf("to", "the", "a"),
        "have" to listOf("a", "to", "been")
    )

    private val germanNext = mapOf(
        "vielen" to listOf("Dank", "Grüße"),
        "danke" to listOf("für", "dir", "Ihnen"),
        "guten" to listOf("Morgen", "Tag", "Abend"),
        "wie" to listOf("geht", "ist", "sieht"),
        "kannst" to listOf("du", "mir", "bitte"),
        "können" to listOf("Sie", "wir", "das"),
        "bitte" to listOf("prüfen", "schicken", "kurz"),
        "ich" to listOf("werde", "bin", "habe"),
        "wir" to listOf("können", "werden", "müssen"),
        "der" to listOf("Termin", "Kunde", "Plan"),
        "die" to listOf("Besprechung", "Frage", "Lösung"),
        "das" to listOf("ist", "kann", "Thema"),
        "nächste" to listOf("Woche", "Besprechung", "Schritt"),
        "morgen" to listOf("früh", "um", "kann"),
        "termin" to listOf("ist", "morgen", "verschieben"),
        "meeting" to listOf("ist", "heute", "morgen"),
        "vielleicht" to listOf("können", "ist", "morgen")
    )

    private val hinglishNext = mapOf(
        "kya" to listOf("hai", "karna", "hua"),
        "kaise" to listOf("ho", "hai", "karna"),
        "main" to listOf("kal", "abhi", "check"),
        "hum" to listOf("kal", "abhi", "check"),
        "tum" to listOf("kal", "please", "check"),
        "aap" to listOf("please", "kal", "check"),
        "kal" to listOf("meeting", "baat", "kar"),
        "abhi" to listOf("check", "bhej", "kar"),
        "please" to listOf("check", "bhej", "batana"),
        "meeting" to listOf("kal", "hai", "mein"),
        "thanks" to listOf("yaar", "bhai", "dost"),
        "bahut" to listOf("acha", "badiya", "thanks"),
        "theek" to listOf("hai", "h", "rahega"),
        "mujhe" to listOf("lagta", "bhej", "batana"),
        "baat" to listOf("karte", "karna", "hui"),
        "kar" to listOf("do", "lenge", "raha"),
        "bhej" to listOf("do", "dena", "diya")
    )

    private val emojiEnglish = mapOf(
        "birthday" to "🎂", "happy" to "😊", "love" to "❤️", "thanks" to "🙏", "thank" to "🙏",
        "laugh" to "😂", "funny" to "😂", "great" to "👍", "good" to "👍", "party" to "🎉",
        "congrats" to "🎉", "congratulations" to "🎉", "sad" to "😔", "sorry" to "🙏", "fire" to "🔥"
    )
    private val emojiGerman = mapOf(
        "geburtstag" to "🎂", "danke" to "🙏", "liebe" to "❤️", "lustig" to "😂", "super" to "👍",
        "gut" to "👍", "party" to "🎉", "glückwunsch" to "🎉", "traurig" to "😔", "sorry" to "🙏"
    )
    private val emojiHinglish = mapOf(
        "birthday" to "🎂", "thanks" to "🙏", "shukriya" to "🙏", "pyaar" to "❤️", "mast" to "🔥",
        "badiya" to "👍", "acha" to "👍", "party" to "🎉", "sorry" to "🙏", "yaar" to "😊"
    )


    fun suggestions(input: String, badge: String, max: Int = 5): Result {
        val clean = normalize(input)
        if (clean.length < 2) return Result(emptyList(), false)
        val list = listFor(badge)
        if (list.any { it == clean }) return Result(emptyList(), false)

        val maxDistance = when {
            clean.length <= 4 -> 1
            clean.length <= 8 -> 2
            else -> 2
        }
        val matches = mutableListOf<Match>()
        list.forEachIndexed { rank, candidate ->
            if (kotlin.math.abs(candidate.length - clean.length) > maxDistance) return@forEachIndexed
            if (candidate.first() != clean.first() && clean.length >= 4) return@forEachIndexed
            val distance = damerauLevenshtein(clean, candidate, maxDistance)
            if (distance <= maxDistance) matches += Match(candidate, distance, rank)
        }
        val ranked = matches.sortedWith(compareBy<Match> { it.distance }.thenBy { it.rank })
        val suggestions = ranked.take(max).map { it.word }
        val top = ranked.firstOrNull()
        val second = ranked.getOrNull(1)
        val confident = top != null && (
            top.distance == 1 ||
                (clean.length >= 7 && top.distance == 2 && (second == null || second.distance > top.distance))
            )
        return Result(suggestions, confident)
    }

    fun nextWords(previous: String, badge: String, max: Int = 3): List<String> {
        val clean = previous.trim().lowercase()
        if (clean.isBlank()) return emptyList()
        val map = when (badge) {
            "DE" -> germanNext
            "HIN" -> hinglishNext
            else -> englishNext
        }
        return map[clean].orEmpty().take(max)
    }

    fun emojiForWord(word: String, badge: String): String? {
        val clean = word.trim().lowercase()
        val map = when (badge) {
            "DE" -> emojiGerman
            "HIN" -> emojiHinglish
            else -> emojiEnglish
        }
        return map[clean]
    }

    fun decodeGlide(sequence: String, badge: String): String? {
        val clean = normalize(sequence).replace(Regex("(.)\\1+"), "$1")
        if (clean.length < 2) return null
        val list = listFor(badge)
        val maxDistance = when {
            clean.length <= 4 -> 2
            clean.length <= 7 -> 3
            else -> 4
        }
        var best: Match? = null
        var bestScore = Int.MAX_VALUE
        list.forEachIndexed { rank, candidate ->
            if (candidate.length < 2) return@forEachIndexed
            if (candidate.first() != clean.first()) return@forEachIndexed
            if (candidate.last() != clean.last()) return@forEachIndexed
            if (kotlin.math.abs(candidate.length - clean.length) > maxDistance) return@forEachIndexed
            val distance = damerauLevenshtein(clean, candidate, maxDistance)
            if (distance > maxDistance) return@forEachIndexed
            val score = distance * 1000 + min(rank, 999)
            if (score < bestScore) {
                bestScore = score
                best = Match(candidate, distance, rank)
            }
        }
        val match = best ?: return null
        val limit = when {
            match.word.length <= 4 -> 2
            match.word.length <= 7 -> 3
            else -> 4
        }
        return match.word.takeIf { match.distance <= limit }
    }

    private fun normalize(value: String): String = value.lowercase().filter { it in 'a'..'z' || it in 'ä'..'ü' || it == 'ß' }

    private fun damerauLevenshtein(a: String, b: String, cutoff: Int): Int {
        if (a == b) return 0
        if (kotlin.math.abs(a.length - b.length) > cutoff) return cutoff + 1
        var prevPrev = IntArray(b.length + 1)
        var prev = IntArray(b.length + 1) { it }
        var curr = IntArray(b.length + 1)
        for (i in 1..a.length) {
            curr[0] = i
            var rowMin = curr[0]
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                var value = minOf(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + cost
                )
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                    value = minOf(value, prevPrev[j - 2] + 1)
                }
                curr[j] = value
                rowMin = min(rowMin, value)
            }
            if (rowMin > cutoff) return cutoff + 1
            val temp = prevPrev
            prevPrev = prev
            prev = curr
            curr = temp
        }
        return prev[b.length]
    }
}
