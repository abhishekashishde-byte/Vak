package com.ana.keyboard

import android.speech.SpeechRecognizer

object VoiceDictationPolicy {
    fun bestText(finalText: String?, partialText: String?): String =
        finalText?.trim().orEmpty().ifBlank { partialText?.trim().orEmpty() }

    fun shouldFallbackFromOnDevice(error: Int): Boolean = error in setOf(
        SpeechRecognizer.ERROR_CLIENT,
        SpeechRecognizer.ERROR_SERVER,
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT
    )
}
