package com.ana.keyboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreLexiconPredictionTest {
    @Test
    fun englishPredictionsUseEnglishModel() {
        assertEquals("are", CoreLexicon.nextWords("how", "EN").first())
        assertTrue("you" in CoreLexicon.nextWords("can", "EN"))
    }

    @Test
    fun germanPredictionsUseGermanModel() {
        assertEquals("Dank", CoreLexicon.nextWords("vielen", "DE").first())
        assertTrue("für" in CoreLexicon.nextWords("danke", "DE"))
    }

    @Test
    fun hinglishPredictionsUseHinglishModel() {
        assertEquals("hai", CoreLexicon.nextWords("kya", "HIN").first())
        assertTrue("check" in CoreLexicon.nextWords("please", "HIN"))
    }

    @Test
    fun emojiSuggestionsFollowSelectedLanguage() {
        assertEquals("🎂", CoreLexicon.emojiForWord("birthday", "EN"))
        assertEquals("🎂", CoreLexicon.emojiForWord("geburtstag", "DE"))
        assertEquals("👍", CoreLexicon.emojiForWord("badiya", "HIN"))
    }
}
