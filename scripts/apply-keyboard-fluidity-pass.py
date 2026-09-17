from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / "android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardView.kt"
SERVICE = ROOT / "android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt"
GRADLE = ROOT / "android-keyboard/app/build.gradle.kts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return out


# ---------------- AnaKeyboardView: multi-touch + lighter draw/touch path ----------------
view = VIEW.read_text()

view = replace_once(
    view,
    """    interface Listener {\n        fun onKey(code: String)\n        fun onGlide(trace: GlideTrace)\n        fun onPressFeedback(view: View)\n    }""",
    """    interface Listener {\n        fun onKey(code: String)\n        fun onGlide(trace: GlideTrace)\n        fun onPressFeedback(view: View)\n        fun onReplaceLastKey(text: String)\n    }""",
    "listener replacement callback",
)

view = replace_once(
    view,
    """    private var adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n    private var calibrationBadge = KeyboardPrefs.inputBadge(context)\n    private var touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n    private var calibrationDirty = 0\n    private var spaceCursorMoved = false\n    private var spaceCursorAnchorX = 0f""",
    """    private var adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n    private var calibrationBadge = KeyboardPrefs.inputBadge(context)\n    private var touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n    private var calibrationDirty = 0\n    private var keyPopupEnabled = KeyboardPrefs.keyPopupEnabled(context)\n    private var backgroundTintPercent = KeyboardPrefs.backgroundTintPercent(context)\n    private var spaceCursorMoved = false\n    private var spaceCursorAnchorX = 0f\n\n    // Every physical pointer is tracked independently. This is essential for\n    // fast two-thumb typing where the next finger often lands before the\n    // previous finger has lifted.\n    private val pointerKeys = mutableMapOf<Int, PlacedKey>()\n    private val pointerDownPositions = mutableMapOf<Int, Pair<Float, Float>>()\n    private val committedPointers = mutableSetOf<Int>()\n    private var primaryPointerId = MotionEvent.INVALID_POINTER_ID""",
    "view cached prefs and pointer state",
)

view = replace_once(
    view,
    """        adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n        calibrationBadge = KeyboardPrefs.inputBadge(context)\n        touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n        clearPressState()""",
    """        adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n        calibrationBadge = KeyboardPrefs.inputBadge(context)\n        touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n        keyPopupEnabled = KeyboardPrefs.keyPopupEnabled(context)\n        backgroundTintPercent = KeyboardPrefs.backgroundTintPercent(context)\n        clearPressState()""",
    "refresh cached prefs",
)

view = replace_once(
    view,
    """    private fun canPreview(key: KeySpec): Boolean =\n        KeyboardPrefs.keyPopupEnabled(context) && key.code.length == 1 && key.code.firstOrNull()?.isLetterOrDigit() == true""",
    """    private fun canPreview(key: KeySpec): Boolean =\n        keyPopupEnabled && key.code.length == 1 && key.code.firstOrNull()?.isLetterOrDigit() == true""",
    "cached key popup",
)

view = replace_once(
    view,
    """        val alpha = (KeyboardPrefs.backgroundTintPercent(context) * 255 / 100).coerceIn(0, 204)""",
    """        val alpha = (backgroundTintPercent * 255 / 100).coerceIn(0, 204)""",
    "cached background tint",
)

view = regex_once(
    view,
    r"    private fun recordSuccessfulTouch\(item: PlacedKey, upX: Float, upY: Float\) \{.*?\n    \}\n\n    private fun persistTouchCalibration",
    """    private fun recordSuccessfulTouch(\n        item: PlacedKey,\n        pressX: Float,\n        pressY: Float,\n        upX: Float,\n        upY: Float\n    ) {\n        if (!adaptiveTouch || !item.key.letter || symbols) return\n        if (!item.rect.contains(pressX, pressY)) return // avoid reinforcing a previously shifted miss\n        if (hypot(upX - pressX, upY - pressY) > max(dp(14f), touchSlop * 1.8f)) return\n        val width = item.rect.width().coerceAtLeast(1f)\n        val height = item.rect.height().coerceAtLeast(1f)\n        val sampleDx = ((pressX - item.rect.centerX()) / width).coerceIn(-0.20f, 0.20f)\n        val sampleDy = ((pressY - item.rect.centerY()) / height).coerceIn(-0.20f, 0.20f)\n        val key = item.key.code.lowercase()\n        val old = touchCalibration[key] ?: KeyboardPrefs.TouchCalibration(0f, 0f, 0)\n        val alpha = if (old.count < 18) 0.16f else 0.045f\n        val next = KeyboardPrefs.TouchCalibration(\n            dx = (old.dx * (1f - alpha) + sampleDx * alpha).coerceIn(-0.10f, 0.10f),\n            dy = (old.dy * (1f - alpha) + sampleDy * alpha).coerceIn(-0.10f, 0.10f),\n            count = (old.count + 1).coerceAtMost(100000)\n        )\n        touchCalibration[key] = next\n        calibrationDirty++\n        // Persist less often. JSON/SharedPreferences serialization must not\n        // periodically interrupt a fast typing burst.\n        if (calibrationDirty >= 64) persistTouchCalibration()\n    }\n\n    private fun persistTouchCalibration""",
    "adaptive touch recorder",
)

view = replace_once(
    view,
    """        glideLetters.clear()\n        spaceCursorMoved = false\n    }\n\n    override fun onTouchEvent(event: MotionEvent): Boolean {""",
    """        glideLetters.clear()\n        spaceCursorMoved = false\n        pointerKeys.clear()\n        pointerDownPositions.clear()\n        committedPointers.clear()\n        primaryPointerId = MotionEvent.INVALID_POINTER_ID\n    }\n\n    private fun shouldCommitImmediately(item: PlacedKey): Boolean =\n        item.key.code.length == 1 && !(item.key.letter && KeyboardPrefs.glideTypingEnabled(context))\n\n    private fun beginPointer(event: MotionEvent, index: Int, primary: Boolean): PlacedKey? {\n        val pointerId = event.getPointerId(index)\n        val x = event.getX(index)\n        val y = event.getY(index)\n        val item = keyAt(x, y) ?: return null\n        pointerKeys[pointerId] = item\n        pointerDownPositions[pointerId] = x to y\n\n        // Ordinary text keys commit on DOWN. That preserves the exact physical\n        // tap order and prevents overlapping two-thumb taps from being dropped.\n        if (shouldCommitImmediately(item)) {\n            listener?.onKey(item.key.code)\n            committedPointers += pointerId\n        }\n        // Feedback happens after the text commit, never before it.\n        listener?.onPressFeedback(this)\n\n        if (primary) {\n            primaryPointerId = pointerId\n            downX = x\n            downY = y\n            downAt = SystemClock.uptimeMillis()\n            active = item\n            alternatePopup = null\n            backspaceRepeated = false\n            gliding = false\n            potentialGlideLetters.clear()\n            glidePoints.clear()\n            glideLetters.clear()\n            spaceCursorMoved = false\n            spaceCursorAnchorX = x\n\n            if (item.key.letter && KeyboardPrefs.glideTypingEnabled(context) && !symbols) appendPotentialGlide(item)\n            if (item.key.code == \"BACKSPACE\") repeatHandler.postDelayed(repeatBackspace, 370)\n            else scheduleLongPress(item)\n        } else {\n            // A second thumb means this is rapid tapping, not a long-press or glide.\n            longPressHandler.removeCallbacks(showAlternates)\n            alternatePopup = null\n            if (gliding) {\n                gliding = false\n                potentialGlideLetters.clear()\n                glidePoints.clear()\n                glideLetters.clear()\n            }\n        }\n        invalidate()\n        return item\n    }\n\n    private fun finishSecondaryPointer(pointerId: Int, upX: Float, upY: Float) {\n        val item = pointerKeys[pointerId] ?: return\n        if (pointerId !in committedPointers) listener?.onKey(item.key.code)\n        val down = pointerDownPositions[pointerId]\n        if (down != null) recordSuccessfulTouch(item, down.first, down.second, upX, upY)\n        pointerKeys.remove(pointerId)\n        pointerDownPositions.remove(pointerId)\n        committedPointers.remove(pointerId)\n    }\n\n    override fun onTouchEvent(event: MotionEvent): Boolean {""",
    "pointer helpers",
)

view = regex_once(
    view,
    r"    override fun onTouchEvent\(event: MotionEvent\): Boolean \{.*?\n    \}\n\n    override fun performClick",
    """    override fun onTouchEvent(event: MotionEvent): Boolean {\n        when (event.actionMasked) {\n            MotionEvent.ACTION_DOWN -> {\n                if (placed.isEmpty()) placed = layoutKeys()\n                pointerKeys.clear()\n                pointerDownPositions.clear()\n                committedPointers.clear()\n                primaryPointerId = MotionEvent.INVALID_POINTER_ID\n                val item = beginPointer(event, event.actionIndex, primary = true)\n                return item != null\n            }\n\n            MotionEvent.ACTION_POINTER_DOWN -> {\n                beginPointer(event, event.actionIndex, primary = false)\n                return true\n            }\n\n            MotionEvent.ACTION_MOVE -> {\n                val primaryIndex = event.findPointerIndex(primaryPointerId)\n                if (primaryIndex < 0) return true\n                val x = event.getX(primaryIndex)\n                val y = event.getY(primaryIndex)\n\n                if (active?.key?.code == \"SPACE\") {\n                    val step = dp(15f)\n                    val rawSteps = ((x - spaceCursorAnchorX) / step).toInt().coerceIn(-12, 12)\n                    if (rawSteps != 0) {\n                        val code = if (rawSteps > 0) \"CURSOR_RIGHT\" else \"CURSOR_LEFT\"\n                        repeat(kotlin.math.abs(rawSteps)) { listener?.onKey(code) }\n                        spaceCursorAnchorX += rawSteps * step\n                        spaceCursorMoved = true\n                        longPressHandler.removeCallbacks(showAlternates)\n                    }\n                    return true\n                }\n\n                if (alternatePopup != null) {\n                    updateAlternateSelection(x, y)\n                    return true\n                }\n\n                val distance = hypot(x - downX, y - downY)\n                val longPressCancelDistance = max(dp(18f), touchSlop * 2.5f)\n                if (!gliding && distance > longPressCancelDistance) longPressHandler.removeCallbacks(showAlternates)\n\n                if (active?.key?.letter == true && KeyboardPrefs.glideTypingEnabled(context) && !symbols) {\n                    appendPotentialGlide(glideKeyAt(x, y))\n                    startGlideIfIntentional(event)\n                }\n\n                if (gliding) {\n                    appendGlide(glideKeyAt(x, y), x, y)\n                    invalidate()\n                }\n                return true\n            }\n\n            MotionEvent.ACTION_POINTER_UP -> {\n                val index = event.actionIndex\n                val pointerId = event.getPointerId(index)\n                val upX = event.getX(index)\n                val upY = event.getY(index)\n\n                if (pointerId == primaryPointerId) {\n                    repeatHandler.removeCallbacks(repeatBackspace)\n                    longPressHandler.removeCallbacks(showAlternates)\n                    val selected = pointerKeys[pointerId] ?: active\n                    if (selected != null && pointerId !in committedPointers) {\n                        if (selected.key.code == \"SPACE\" && spaceCursorMoved) {\n                            // cursor drag: no space\n                        } else if (selected.key.code != \"BACKSPACE\" || !backspaceRepeated) {\n                            listener?.onKey(selected.key.code)\n                        }\n                    }\n                    val down = pointerDownPositions[pointerId]\n                    if (selected != null && down != null) recordSuccessfulTouch(selected, down.first, down.second, upX, upY)\n                    pointerKeys.remove(pointerId)\n                    pointerDownPositions.remove(pointerId)\n                    committedPointers.remove(pointerId)\n                    active = null\n                    primaryPointerId = MotionEvent.INVALID_POINTER_ID\n                    alternatePopup = null\n                    invalidate()\n                } else {\n                    finishSecondaryPointer(pointerId, upX, upY)\n                }\n                return true\n            }\n\n            MotionEvent.ACTION_UP -> {\n                val index = event.actionIndex\n                val pointerId = event.getPointerId(index)\n                val upX = event.getX(index)\n                val upY = event.getY(index)\n\n                if (pointerId != primaryPointerId) {\n                    finishSecondaryPointer(pointerId, upX, upY)\n                    performClick()\n                    clearPressState()\n                    invalidate()\n                    return true\n                }\n\n                repeatHandler.removeCallbacks(repeatBackspace)\n                longPressHandler.removeCallbacks(showAlternates)\n\n                if (gliding) {\n                    appendGlide(glideKeyAt(upX, upY), upX, upY)\n                    val sequence = glideLetters.joinToString(\"\")\n                    val trace = buildGlideTrace(sequence)\n                    fadeTrail()\n                    if (sequence.length >= 2) listener?.onGlide(trace)\n                    performClick()\n                    clearPressState()\n                    invalidate()\n                    return true\n                }\n\n                val selected = pointerKeys[pointerId] ?: active\n                val popup = alternatePopup\n                if (selected != null) {\n                    val alreadyCommitted = pointerId in committedPointers\n                    if (popup != null) {\n                        if (popup.selectedIndex >= 0) {\n                            val replacement = popup.options[popup.selectedIndex]\n                            if (alreadyCommitted) listener?.onReplaceLastKey(replacement)\n                            else listener?.onKey(replacement)\n                        } else if (!alreadyCommitted) {\n                            listener?.onKey(selected.key.code)\n                        }\n                    } else if (selected.key.code == \"SPACE\" && spaceCursorMoved) {\n                        // A horizontal spacebar drag is cursor control, not a Space keypress.\n                    } else if (!alreadyCommitted && (selected.key.code != \"BACKSPACE\" || !backspaceRepeated)) {\n                        listener?.onKey(selected.key.code)\n                    }\n                    val down = pointerDownPositions[pointerId]\n                    if (down != null) recordSuccessfulTouch(selected, down.first, down.second, upX, upY)\n                    performClick()\n                }\n                clearPressState()\n                invalidate()\n                return true\n            }\n\n            MotionEvent.ACTION_CANCEL -> {\n                clearPressState()\n                invalidate()\n                return true\n            }\n        }\n        return super.onTouchEvent(event)\n    }\n\n    override fun performClick""",
    "multi-touch event loop",
)

VIEW.write_text(view)

# ---------------- AnaKeyboardService: minimal synchronous key path ----------------
service = SERVICE.read_text()

service = replace_once(
    service,
    """    private var smartSentenceToken = 0\n    private var lastSmartSentenceChecked = \"\"\n    @Volatile private var smartSentenceInFlight = false\n    private var shortcutCache: Map<String, String> = emptyMap()""",
    """    private var smartSentenceToken = 0\n    private var lastSmartSentenceChecked = \"\"\n    @Volatile private var smartSentenceInFlight = false\n    private var shortcutCache: Map<String, String> = emptyMap()\n\n    // Cached once per input session so physical key taps never need to query\n    // SharedPreferences or rebuild dictionaries on the hot path.\n    private var cachedWordSuggestionsEnabled = true\n    private var cachedSmartSentenceEnabled = false\n    private var cachedAutoCorrectionEnabled = true\n    private var cachedDoubleSpacePeriodEnabled = true\n    private var cachedAutoSpacePunctuation = true\n    private var cachedHapticEnabled = true\n    private var cachedHapticStrengthMs = 6\n    private var cachedSoundEnabled = true\n    private var cachedInputBadge = \"EN\"\n    private var cachedPersonalWords: Set<String> = emptySet()\n    private var cachedLearnedCorrections: Map<String, String> = emptyMap()\n    private var typingIdleSawLetter = false\n    private var typingIdleSawPunctuation = false""",
    "service hot-path caches",
)

service = replace_once(
    service,
    """    private val smartSentenceRunnable = Runnable { runSmartSentenceCorrection() }""",
    """    private val smartSentenceRunnable = Runnable { runSmartSentenceCorrection() }\n\n    private val typingIdleRunnable = Runnable {\n        val sawLetter = typingIdleSawLetter\n        val sawPunctuation = typingIdleSawPunctuation\n        typingIdleSawLetter = false\n        typingIdleSawPunctuation = false\n\n        if (cachedWordSuggestionsEnabled && !isPasswordField()) {\n            showTypedWordCandidate()\n            requestSuggestionsSoon()\n        } else {\n            clearSuggestions()\n        }\n        if (sawLetter || sawPunctuation) scheduleSmartSentenceCorrection()\n    }""",
    "typing idle runnable",
)

service = replace_once(
    service,
    """    private val suggestionRunnable = Runnable {\n        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField()) {\n            clearSuggestions()\n            return@Runnable\n        }\n        val word = currentWord()\n        if (word.isNullOrBlank()) {\n            clearSuggestions()\n            return@Runnable\n        }\n        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n        suggestionEngine.request(word)\n    }""",
    """    private val suggestionRunnable = Runnable {\n        if (!cachedWordSuggestionsEnabled || isPasswordField()) {\n            clearSuggestions()\n            return@Runnable\n        }\n        val word = currentWord()\n        if (word.isNullOrBlank()) {\n            clearSuggestions()\n            return@Runnable\n        }\n        suggestionEngine.setLanguage(cachedInputBadge)\n        suggestionEngine.request(word)\n    }""",
    "cached suggestion runnable",
)

service = replace_once(
    service,
    """    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()\n\n    override fun onCreate()""",
    """    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()\n\n    private fun refreshTypingCache() {\n        cachedWordSuggestionsEnabled = KeyboardPrefs.wordSuggestionsEnabled(this)\n        cachedSmartSentenceEnabled = KeyboardPrefs.smartSentenceCorrectionEnabled(this)\n        cachedAutoCorrectionEnabled = KeyboardPrefs.autoCorrectionEnabled(this)\n        cachedDoubleSpacePeriodEnabled = KeyboardPrefs.doubleSpacePeriodEnabled(this)\n        cachedAutoSpacePunctuation = KeyboardPrefs.autoSpaceAfterPunctuation(this)\n        cachedHapticEnabled = KeyboardPrefs.hapticEnabled(this)\n        cachedHapticStrengthMs = KeyboardPrefs.hapticStrengthMs(this)\n        cachedSoundEnabled = KeyboardPrefs.soundEnabled(this)\n        cachedInputBadge = KeyboardPrefs.inputBadge(this)\n        cachedPersonalWords = KeyboardPrefs.personalDictionary(this, cachedInputBadge)\n            .map { it.lowercase() }.toSet()\n        cachedLearnedCorrections = KeyboardPrefs.learnedCorrections(this, cachedInputBadge)\n    }\n\n    private fun scheduleTypingIdleUpdate(letter: Boolean, punctuation: Boolean) {\n        typingIdleSawLetter = typingIdleSawLetter || letter\n        typingIdleSawPunctuation = typingIdleSawPunctuation || punctuation\n        mainHandler.removeCallbacks(typingIdleRunnable)\n        mainHandler.postDelayed(typingIdleRunnable, 55)\n    }\n\n    override fun onCreate()""",
    "typing cache helpers",
)

service = replace_once(
    service,
    """                    KeyboardPrefs.setInputLanguage(this@AnaKeyboardService, name)\n                    suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this@AnaKeyboardService))\n                    shortcutCache = KeyboardPrefs.textShortcuts(this@AnaKeyboardService)""",
    """                    KeyboardPrefs.setInputLanguage(this@AnaKeyboardService, name)\n                    refreshTypingCache()\n                    suggestionEngine.setLanguage(cachedInputBadge)\n                    shortcutCache = KeyboardPrefs.textShortcuts(this@AnaKeyboardService)""",
    "language cache refresh",
)

service = replace_once(
    service,
    """        loadBackgroundImage()\n        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n        shortcutCache = KeyboardPrefs.textShortcuts(this)""",
    """        loadBackgroundImage()\n        refreshTypingCache()\n        suggestionEngine.setLanguage(cachedInputBadge)\n        shortcutCache = KeyboardPrefs.textShortcuts(this)""",
    "create view cache refresh",
)

service = replace_once(
    service,
    """            showLetterKeyboard()\n            keyboard.refreshPreferences()\n            loadBackgroundImage()\n            if (::targetButton.isInitialized) targetButton.text = \"→ ${KeyboardPrefs.targetBadge(this)}\"\n            suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n            suggestionEngine.refreshUserData()\n            shortcutCache = KeyboardPrefs.textShortcuts(this)""",
    """            refreshTypingCache()\n            showLetterKeyboard()\n            keyboard.refreshPreferences()\n            loadBackgroundImage()\n            if (::targetButton.isInitialized) targetButton.text = \"→ ${KeyboardPrefs.targetBadge(this)}\"\n            suggestionEngine.setLanguage(cachedInputBadge)\n            suggestionEngine.refreshUserData()\n            shortcutCache = KeyboardPrefs.textShortcuts(this)""",
    "start input cache refresh",
)

service = replace_once(
    service,
    """    override fun onPressFeedback(view: View) {\n        if (KeyboardPrefs.hapticEnabled(this)) {\n            vibrator.vibrate(\n                VibrationEffect.createOneShot(\n                    KeyboardPrefs.hapticStrengthMs(this).toLong(),\n                    VibrationEffect.DEFAULT_AMPLITUDE\n                )\n            )\n        }\n        if (KeyboardPrefs.soundEnabled(this)) audioManager.playSoundEffect(AudioManager.FX_KEY_CLICK, 0.34f)\n    }\n\n    override fun onGlide""",
    """    override fun onPressFeedback(view: View) {\n        if (cachedHapticEnabled) {\n            vibrator.vibrate(\n                VibrationEffect.createOneShot(\n                    cachedHapticStrengthMs.toLong(),\n                    VibrationEffect.DEFAULT_AMPLITUDE\n                )\n            )\n        }\n        if (cachedSoundEnabled) audioManager.playSoundEffect(AudioManager.FX_KEY_CLICK, 0.34f)\n    }\n\n    override fun onReplaceLastKey(text: String) {\n        val connection = currentInputConnection ?: return\n        connection.deleteSurroundingText(1, 0)\n        connection.commitText(text, 1)\n        scheduleTypingIdleUpdate(text.any { it.isLetter() }, text in setOf(\",\", \".\", \"?\", \"!\", \":\", \";\"))\n    }\n\n    override fun onGlide""",
    "cached feedback and long-press replacement",
)

service = replace_once(
    service,
    """            else -> {\n                var typed = code\n                if (code.length == 1 && code[0].isLetter() && keyboard.isShifted()) typed = code.uppercase()\n                val punctuation = typed in setOf(\",\", \".\", \"?\", \"!\", \":\", \";\")\n                if (punctuation && KeyboardPrefs.autoSpaceAfterPunctuation(this)) connection.commitText(\"$typed \", 1)\n                else connection.commitText(typed, 1)\n                if (!capsLock && keyboard.isShifted() && typed.any { it.isLetter() }) keyboard.setShifted(false)\n                if (typed.any { it.isLetter() }) {\n                    showTypedWordCandidate()\n                    requestSuggestionsSoon()\n                    // A user may stop immediately after the final letter. Keep this\n                    // lightweight delayed check so no trailing Space is required.\n                    scheduleSmartSentenceCorrection()\n                } else {\n                    clearSuggestions()\n                    if (punctuation) scheduleSmartSentenceCorrection()\n                }\n            }""",
    """            else -> {\n                var typed = code\n                if (code.length == 1 && code[0].isLetter() && keyboard.isShifted()) typed = code.uppercase()\n                val punctuation = typed in setOf(\",\", \".\", \"?\", \"!\", \":\", \";\")\n                if (punctuation && cachedAutoSpacePunctuation) connection.commitText(\"$typed \", 1)\n                else connection.commitText(typed, 1)\n                if (!capsLock && keyboard.isShifted() && typed.any { it.isLetter() }) keyboard.setShifted(false)\n\n                // Suggestions, regex scans and sentence intelligence only run\n                // after a short typing idle period. The physical key path ends here.\n                scheduleTypingIdleUpdate(typed.any { it.isLetter() }, punctuation)\n            }""",
    "minimal character path",
)

service = replace_once(
    service,
    """    private fun requestSuggestionsSoon() {\n        mainHandler.removeCallbacks(suggestionRunnable)\n        if (!KeyboardPrefs.wordSuggestionsEnabled(this) || isPasswordField()) {\n            clearSuggestions()\n            return\n        }\n        mainHandler.postDelayed(suggestionRunnable, 130)\n    }\n\n    private fun scheduleSmartSentenceCorrection() {\n        smartSentenceToken++\n        mainHandler.removeCallbacks(smartSentenceRunnable)\n        if (!KeyboardPrefs.smartSentenceCorrectionEnabled(this) || isPasswordField()) return\n        mainHandler.postDelayed(smartSentenceRunnable, 950)\n    }""",
    """    private fun requestSuggestionsSoon() {\n        mainHandler.removeCallbacks(suggestionRunnable)\n        if (!cachedWordSuggestionsEnabled || isPasswordField()) {\n            clearSuggestions()\n            return\n        }\n        mainHandler.postDelayed(suggestionRunnable, 130)\n    }\n\n    private fun scheduleSmartSentenceCorrection() {\n        smartSentenceToken++\n        mainHandler.removeCallbacks(smartSentenceRunnable)\n        if (!cachedSmartSentenceEnabled || isPasswordField()) return\n        mainHandler.postDelayed(smartSentenceRunnable, 950)\n    }""",
    "cached delayed features",
)

service = replace_once(
    service,
    """        if (currentWord() != word || !KeyboardPrefs.wordSuggestionsEnabled(this)) return""",
    """        if (currentWord() != word || !cachedWordSuggestionsEnabled) return""",
    "cached result validation",
)

service = regex_once(
    service,
    r"    private fun immediateCorrection\(word: String\): String\? \{.*?\n    \}\n\n    private fun handleSpace",
    """    private fun immediateCorrection(word: String): String? {\n        if (!cachedAutoCorrectionEnabled) return null\n        if (word.length < 3) return null\n        if (word.firstOrNull()?.isUpperCase() == true) return null\n\n        cachedLearnedCorrections[word.lowercase()]?.let { return it }\n        if (word.lowercase() in cachedPersonalWords) return null\n\n        // Never run dictionary ranking synchronously on Space. If the current\n        // suggestion result is ready, use it; otherwise the existing async\n        // delimited-word path can correct just after the space is committed.\n        if (lastLooksLikeTypo && lastSuggestedWord == word) {\n            bestCorrection?.takeIf { !it.equals(word, ignoreCase = true) }?.let { return it }\n        }\n        return null\n    }\n\n    private fun handleSpace""",
    "non-blocking immediate correction",
)

service = service.replace("KeyboardPrefs.doubleSpacePeriodEnabled(this)", "cachedDoubleSpacePeriodEnabled")
service = service.replace("KeyboardPrefs.autoCorrectionEnabled(this)", "cachedAutoCorrectionEnabled")

# Only hot-path language lookups should use the cache. Global replacements here are safe
# because the cache is refreshed whenever an input session/language starts.
service = service.replace("suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))", "suggestionEngine.setLanguage(cachedInputBadge)")

service = replace_once(
    service,
    """            KeyboardPrefs.addPersonalWord(this, word)\n            suggestionEngine.refreshUserData()""",
    """            KeyboardPrefs.addPersonalWord(this, word)\n            refreshTypingCache()\n            suggestionEngine.refreshUserData()""",
    "refresh after personal word",
)

service = replace_once(
    service,
    """        KeyboardPrefs.learnCorrection(this, word, suggestion)\n        suggestionEngine.refreshUserData()""",
    """        KeyboardPrefs.learnCorrection(this, word, suggestion)\n        refreshTypingCache()\n        suggestionEngine.refreshUserData()""",
    "refresh after learned correction",
)

service = replace_once(
    service,
    """        KeyboardPrefs.addPersonalWord(this, record.original)\n        suggestionEngine.refreshUserData()""",
    """        KeyboardPrefs.addPersonalWord(this, record.original)\n        refreshTypingCache()\n        suggestionEngine.refreshUserData()""",
    "refresh after undo learn",
)

SERVICE.write_text(service)

# Version this as a distinct stability build.
gradle = GRADLE.read_text()
gradle = replace_once(gradle, 'versionCode = 9', 'versionCode = 10', 'versionCode')
gradle = replace_once(gradle, 'versionName = "0.9.0"', 'versionName = "0.10.0"', 'versionName')
GRADLE.write_text(gradle)

print("Applied Ana Keyboard v0.10 fluidity pass")
