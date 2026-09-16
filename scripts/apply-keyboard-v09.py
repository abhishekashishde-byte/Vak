from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')

def replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing patch anchor: {label}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# KeyboardPrefs: privacy-by-default, shortcuts, one-handed mode, adaptive touch
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/src/main/java/com/ana/keyboard/KeyboardPrefs.kt'
s = read(p)
s = replace(s,
'''    private const val KEY_PENDING_GIF_URI = "pending_gif_uri"\n''',
'''    private const val KEY_PENDING_GIF_URI = "pending_gif_uri"\n    private const val KEY_SHORTCUTS_PREFIX = "text_shortcuts_"\n    private const val KEY_ONE_HANDED_MODE = "one_handed_mode"\n    private const val KEY_ADAPTIVE_TOUCH = "adaptive_touch"\n    private const val KEY_TOUCH_CALIBRATION_PREFIX = "touch_calibration_"\n''', 'prefs constants')

s = replace(s,
'''    fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, true)\n''',
'''    fun smartSentenceCorrectionEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_SMART_SENTENCE_CORRECTION, false)\n''', 'smart sentence default')

anchor = '''    fun clearLearnedCorrections(context: Context, badge: String = inputBadge(context)) =\n        prefs(context).edit().remove(KEY_LEARNED_CORRECTIONS_PREFIX + badge).apply()\n\n'''
addition = r'''    fun clearLearnedCorrections(context: Context, badge: String = inputBadge(context)) =
        prefs(context).edit().remove(KEY_LEARNED_CORRECTIONS_PREFIX + badge).apply()

    fun textShortcuts(context: Context, badge: String = inputBadge(context)): Map<String, String> {
        val raw = prefs(context).getString(KEY_SHORTCUTS_PREFIX + badge, "{}") ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val trigger = keys.next().trim()
                    val expansion = json.optString(trigger).trim()
                    if (trigger.isNotBlank() && expansion.isNotBlank()) put(trigger, expansion)
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun setTextShortcut(context: Context, trigger: String, expansion: String, badge: String = inputBadge(context)) {
        val key = trigger.trim().take(24)
        val value = expansion.trim().take(500)
        if (key.isBlank() || value.isBlank() || key.any { it.isWhitespace() }) return
        val json = JSONObject()
        textShortcuts(context, badge).forEach { (existing, replacement) -> json.put(existing, replacement) }
        json.put(key, value)
        prefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
    }

    fun removeTextShortcut(context: Context, trigger: String, badge: String = inputBadge(context)) {
        val json = JSONObject()
        textShortcuts(context, badge).filterKeys { it != trigger }.forEach { (key, value) -> json.put(key, value) }
        prefs(context).edit().putString(KEY_SHORTCUTS_PREFIX + badge, json.toString()).apply()
    }

    fun oneHandedMode(context: Context): String {
        val value = prefs(context).getString(KEY_ONE_HANDED_MODE, "off") ?: "off"
        return value.takeIf { it in setOf("off", "left", "right") } ?: "off"
    }

    fun setOneHandedMode(context: Context, value: String) {
        val safe = value.takeIf { it in setOf("off", "left", "right") } ?: "off"
        prefs(context).edit().putString(KEY_ONE_HANDED_MODE, safe).apply()
    }

    fun adaptiveTouchEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ADAPTIVE_TOUCH, true)
    fun setAdaptiveTouchEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_ADAPTIVE_TOUCH, enabled).apply()

    data class TouchCalibration(val dx: Float, val dy: Float, val count: Int)

    fun touchCalibration(context: Context, badge: String = inputBadge(context)): Map<String, TouchCalibration> {
        val raw = prefs(context).getString(KEY_TOUCH_CALIBRATION_PREFIX + badge, "{}") ?: "{}"
        return try {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val item = json.optJSONObject(key) ?: continue
                    val dx = item.optDouble("dx", 0.0).toFloat().coerceIn(-0.10f, 0.10f)
                    val dy = item.optDouble("dy", 0.0).toFloat().coerceIn(-0.10f, 0.10f)
                    val count = item.optInt("count", 0).coerceIn(0, 100000)
                    if (key.length == 1 && count > 0) put(key.lowercase(), TouchCalibration(dx, dy, count))
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun saveTouchCalibration(context: Context, values: Map<String, TouchCalibration>, badge: String = inputBadge(context)) {
        val json = JSONObject()
        values.forEach { (key, value) ->
            if (key.length != 1 || value.count <= 0) return@forEach
            json.put(key.lowercase(), JSONObject().apply {
                put("dx", value.dx.coerceIn(-0.10f, 0.10f).toDouble())
                put("dy", value.dy.coerceIn(-0.10f, 0.10f).toDouble())
                put("count", value.count.coerceIn(1, 100000))
            })
        }
        prefs(context).edit().putString(KEY_TOUCH_CALIBRATION_PREFIX + badge, json.toString()).apply()
    }

    fun clearTouchCalibration(context: Context, badge: String = inputBadge(context)) =
        prefs(context).edit().remove(KEY_TOUCH_CALIBRATION_PREFIX + badge).apply()

'''
s = replace(s, anchor, addition, 'prefs feature functions')
write(p, s)

# ---------------------------------------------------------------------------
# AnaKeyboardView: one-handed geometry, spacebar cursor control, adaptive hitbox
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardView.kt'
s = read(p)
s = replace(s,
'''    private var backspaceRepeated = false\n    private var cachedPalette: Palette? = null\n''',
'''    private var backspaceRepeated = false\n    private var cachedPalette: Palette? = null\n    private var adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n    private var calibrationBadge = KeyboardPrefs.inputBadge(context)\n    private var touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n    private var calibrationDirty = 0\n    private var spaceCursorMoved = false\n    private var spaceCursorAnchorX = 0f\n''', 'view state')

s = replace(s,
'''    fun refreshPreferences() {\n        placed = emptyList()\n        cachedPalette = null\n        clearPressState()\n        invalidate()\n    }\n''',
'''    fun refreshPreferences() {\n        persistTouchCalibration()\n        placed = emptyList()\n        cachedPalette = null\n        adaptiveTouch = KeyboardPrefs.adaptiveTouchEnabled(context)\n        calibrationBadge = KeyboardPrefs.inputBadge(context)\n        touchCalibration = KeyboardPrefs.touchCalibration(context, calibrationBadge).toMutableMap()\n        clearPressState()\n        invalidate()\n    }\n''', 'view refresh')

old_layout = '''        val outer = dp(6f)\n        val gap = dp(5f)\n        val rowGap = dp(5f)\n        val usableHeight = height - outer * 2 - rowGap * (rows.size - 1)\n        val rowHeight = max(dp(36f), usableHeight / rows.size)\n        val result = mutableListOf<PlacedKey>()\n\n        val numberOffset = if (!symbols && KeyboardPrefs.numberRowEnabled(context)) 1 else 0\n'''
new_layout = '''        val outer = dp(6f)\n        val gap = dp(5f)\n        val rowGap = dp(5f)\n        val usableHeight = height - outer * 2 - rowGap * (rows.size - 1)\n        val rowHeight = max(dp(36f), usableHeight / rows.size)\n        val result = mutableListOf<PlacedKey>()\n\n        val oneHanded = KeyboardPrefs.oneHandedMode(context)\n        val fullWidth = width - outer * 2\n        val activeWidth = if (oneHanded == "off") fullWidth else fullWidth * 0.78f\n        val baseLeft = when (oneHanded) {\n            "right" -> width - outer - activeWidth\n            else -> outer\n        }\n        val baseRight = baseLeft + activeWidth\n\n        val numberOffset = if (!symbols && KeyboardPrefs.numberRowEnabled(context)) 1 else 0\n'''
s = replace(s, old_layout, new_layout, 'one handed layout prelude')
s = replace(s,
'''            val leftBound = outer + inset\n            val rightBound = width - outer - inset\n''',
'''            val leftBound = baseLeft + inset\n            val rightBound = baseRight - inset\n''', 'one handed bounds')

old_keyat = '''    private fun keyAt(x: Float, y: Float): PlacedKey? {\n        placed.firstOrNull { it.rect.contains(x, y) }?.let { return it }\n        val verticalTolerance = dp(3f)\n        val rowCandidates = placed.filter { y >= it.rect.top - verticalTolerance && y <= it.rect.bottom + verticalTolerance }\n        val nearest = rowCandidates.minByOrNull { abs(it.rect.centerX() - x) } ?: return null\n        val horizontalTolerance = dp(6f)\n        return nearest.takeIf { x >= it.rect.left - horizontalTolerance && x <= it.rect.right + horizontalTolerance }\n    }\n'''
new_keyat = r'''    private fun calibrationFor(item: PlacedKey): KeyboardPrefs.TouchCalibration? {
        if (!adaptiveTouch || !item.key.letter) return null
        return touchCalibration[item.key.code.lowercase()]?.takeIf { it.count >= 6 }
    }

    private fun shiftX(item: PlacedKey): Float = (calibrationFor(item)?.dx ?: 0f) * item.rect.width()
    private fun shiftY(item: PlacedKey): Float = (calibrationFor(item)?.dy ?: 0f) * item.rect.height()

    private fun calibratedContains(item: PlacedKey, x: Float, y: Float, toleranceX: Float = 0f, toleranceY: Float = 0f): Boolean {
        val sx = shiftX(item)
        val sy = shiftY(item)
        return x >= item.rect.left + sx - toleranceX && x <= item.rect.right + sx + toleranceX &&
            y >= item.rect.top + sy - toleranceY && y <= item.rect.bottom + sy + toleranceY
    }

    private fun keyAt(x: Float, y: Float): PlacedKey? {
        val direct = placed.filter { calibratedContains(it, x, y) }
        if (direct.isNotEmpty()) {
            return direct.minByOrNull { item ->
                val nx = (x - (item.rect.centerX() + shiftX(item))) / item.rect.width().coerceAtLeast(1f)
                val ny = (y - (item.rect.centerY() + shiftY(item))) / item.rect.height().coerceAtLeast(1f)
                nx * nx + ny * ny
            }
        }
        val verticalTolerance = dp(3f)
        val rowCandidates = placed.filter { calibratedContains(it, x, y, 0f, verticalTolerance) }
        val nearest = rowCandidates.minByOrNull { abs((it.rect.centerX() + shiftX(it)) - x) } ?: return null
        val horizontalTolerance = dp(6f)
        return nearest.takeIf { calibratedContains(it, x, y, horizontalTolerance, verticalTolerance) }
    }

    private fun recordSuccessfulTouch(item: PlacedKey, upX: Float, upY: Float) {
        if (!adaptiveTouch || !item.key.letter || symbols) return
        if (!item.rect.contains(downX, downY)) return // avoid reinforcing a previously shifted miss
        if (hypot(upX - downX, upY - downY) > max(dp(14f), touchSlop * 1.8f)) return
        val width = item.rect.width().coerceAtLeast(1f)
        val height = item.rect.height().coerceAtLeast(1f)
        val sampleDx = ((downX - item.rect.centerX()) / width).coerceIn(-0.20f, 0.20f)
        val sampleDy = ((downY - item.rect.centerY()) / height).coerceIn(-0.20f, 0.20f)
        val key = item.key.code.lowercase()
        val old = touchCalibration[key] ?: KeyboardPrefs.TouchCalibration(0f, 0f, 0)
        val alpha = if (old.count < 18) 0.16f else 0.045f
        val next = KeyboardPrefs.TouchCalibration(
            dx = (old.dx * (1f - alpha) + sampleDx * alpha).coerceIn(-0.10f, 0.10f),
            dy = (old.dy * (1f - alpha) + sampleDy * alpha).coerceIn(-0.10f, 0.10f),
            count = (old.count + 1).coerceAtMost(100000)
        )
        touchCalibration[key] = next
        calibrationDirty++
        if (calibrationDirty >= 16) persistTouchCalibration()
    }

    private fun persistTouchCalibration() {
        if (calibrationDirty <= 0) return
        KeyboardPrefs.saveTouchCalibration(context, touchCalibration, calibrationBadge)
        calibrationDirty = 0
    }
'''
s = replace(s, old_keyat, new_keyat, 'adaptive keyAt')

s = replace(s,
'''        glideLetters.clear()\n    }\n\n    override fun onTouchEvent(event: MotionEvent): Boolean {\n''',
'''        glideLetters.clear()\n        spaceCursorMoved = false\n    }\n\n    override fun onTouchEvent(event: MotionEvent): Boolean {\n''', 'clear cursor state')

s = replace(s,
'''                glidePoints.clear()\n                glideLetters.clear()\n\n                active?.let { item ->\n''',
'''                glidePoints.clear()\n                glideLetters.clear()\n                spaceCursorMoved = false\n                spaceCursorAnchorX = event.x\n\n                active?.let { item ->\n''', 'cursor down')

move_anchor = '''            MotionEvent.ACTION_MOVE -> {\n                if (alternatePopup != null) {\n'''
move_replacement = '''            MotionEvent.ACTION_MOVE -> {\n                if (active?.key?.code == "SPACE") {\n                    val step = dp(17f)\n                    val rawSteps = ((event.x - spaceCursorAnchorX) / step).toInt().coerceIn(-6, 6)\n                    if (rawSteps != 0) {\n                        val code = if (rawSteps > 0) "CURSOR_RIGHT" else "CURSOR_LEFT"\n                        repeat(kotlin.math.abs(rawSteps)) { listener?.onKey(code) }\n                        spaceCursorAnchorX += rawSteps * step\n                        spaceCursorMoved = true\n                        longPressHandler.removeCallbacks(showAlternates)\n                    }\n                    return true\n                }\n\n                if (alternatePopup != null) {\n'''
s = replace(s, move_anchor, move_replacement, 'space cursor move')

old_up = '''                val selected = active\n                val popup = alternatePopup\n                if (selected != null) {\n                    if (popup != null) {\n                        if (popup.selectedIndex >= 0) listener?.onKey(popup.options[popup.selectedIndex])\n                        else listener?.onKey(selected.key.code)\n                    } else if (selected.key.code != "BACKSPACE" || !backspaceRepeated) {\n                        listener?.onKey(selected.key.code)\n                    }\n                    performClick()\n                }\n'''
new_up = '''                val selected = active\n                val popup = alternatePopup\n                if (selected != null) {\n                    if (popup != null) {\n                        if (popup.selectedIndex >= 0) listener?.onKey(popup.options[popup.selectedIndex])\n                        else listener?.onKey(selected.key.code)\n                    } else if (selected.key.code == "SPACE" && spaceCursorMoved) {\n                        // A horizontal spacebar drag is cursor control, not a Space keypress.\n                    } else if (selected.key.code != "BACKSPACE" || !backspaceRepeated) {\n                        listener?.onKey(selected.key.code)\n                        recordSuccessfulTouch(selected, event.x, event.y)\n                    }\n                    performClick()\n                }\n'''
s = replace(s, old_up, new_up, 'space cursor up and calibration')

s = replace(s,
'''        trailAnimator?.cancel()\n        super.onDetachedFromWindow()\n''',
'''        trailAnimator?.cancel()\n        persistTouchCalibration()\n        super.onDetachedFromWindow()\n''', 'persist calibration detach')
write(p, s)

# ---------------------------------------------------------------------------
# AnaKeyboardService: local/AI indicator, cursor movement and text shortcuts
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt'
s = read(p)
s = replace(s,
'''import android.view.Gravity\nimport android.view.View\n''',
'''import android.view.Gravity\nimport android.view.KeyEvent\nimport android.view.View\n''', 'KeyEvent import')

s = replace(s,
'''    @Volatile private var smartSentenceInFlight = false\n\n    private var speechRecognizer: SpeechRecognizer? = null\n''',
'''    @Volatile private var smartSentenceInFlight = false\n    private var shortcutCache: Map<String, String> = emptyMap()\n\n    private var speechRecognizer: SpeechRecognizer? = null\n''', 'shortcut cache state')

s = replace(s,
'''                    KeyboardPrefs.setInputLanguage(this@AnaKeyboardService, name)\n                    suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this@AnaKeyboardService))\n                    keyboard.refreshPreferences()\n''',
'''                    KeyboardPrefs.setInputLanguage(this@AnaKeyboardService, name)\n                    suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this@AnaKeyboardService))\n                    shortcutCache = KeyboardPrefs.textShortcuts(this@AnaKeyboardService)\n                    keyboard.refreshPreferences()\n''', 'shortcut cache language')

s = replace(s,
'''        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n        clearSuggestions()\n''',
'''        suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n        shortcutCache = KeyboardPrefs.textShortcuts(this)\n        clearSuggestions()\n''', 'shortcut cache create')

s = replace(s,
'''            suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n            suggestionEngine.refreshUserData()\n            requestSuggestionsSoon()\n''',
'''            suggestionEngine.setLanguage(KeyboardPrefs.inputBadge(this))\n            suggestionEngine.refreshUserData()\n            shortcutCache = KeyboardPrefs.textShortcuts(this)\n            requestSuggestionsSoon()\n''', 'shortcut cache input view')

onkey_anchor = '''    override fun onKey(code: String) {\n        if (pendingGlide != null) flushPendingGlideFast()\n'''
onkey_new = '''    override fun onKey(code: String) {\n        if (code == "CURSOR_LEFT" || code == "CURSOR_RIGHT") {\n            smartSentenceToken++\n            mainHandler.removeCallbacks(smartSentenceRunnable)\n            moveCursor(if (code == "CURSOR_RIGHT") 1 else -1)\n            return\n        }\n        if (pendingGlide != null) flushPendingGlideFast()\n'''
s = replace(s, onkey_anchor, onkey_new, 'cursor key handling')

s = replace(s,
'''        showStatus("Checking sentence…")\n''',
'''        showStatus("ANA AI • checking sentence")\n''', 'AI sentence status')

handle_space_anchor = '''    private fun handleSpace() {\n        val connection = currentInputConnection ?: return\n        val wordBeforeSpace = currentWord()\n'''
handle_space_new = r'''    private fun handleSpace() {
        val connection = currentInputConnection ?: return
        if (expandTextShortcut(connection)) {
            connection.commitText(" ", 1)
            lastSpaceTap = SystemClock.elapsedRealtime()
            pendingDelimitedWord = null
            lastAutoCorrection = null
            clearSuggestions()
            refreshShiftFromEditor()
            showStatus("LOCAL • shortcut expanded")
            return
        }
        val wordBeforeSpace = currentWord()
'''
s = replace(s, handle_space_anchor, handle_space_new, 'shortcut expansion on space')

move_fn_anchor = '''    private fun handleShift() {\n'''
move_fn = r'''    private fun expandTextShortcut(connection: InputConnection): Boolean {
        if (isPasswordField() || shortcutCache.isEmpty()) return false
        val before = connection.getTextBeforeCursor(80, 0)?.toString().orEmpty()
        val trigger = Regex("([^\\s]{1,24})$").find(before)?.groupValues?.getOrNull(1) ?: return false
        val expansion = shortcutCache[trigger] ?: return false
        if (expansion.isBlank()) return false
        connection.deleteSurroundingText(trigger.length, 0)
        connection.commitText(expansion, 1)
        return true
    }

    private fun moveCursor(direction: Int) {
        val connection = currentInputConnection ?: return
        connection.finishComposingText()
        val keyCode = if (direction > 0) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        clearSuggestions()
    }

    private fun handleShift() {
'''
s = replace(s, move_fn_anchor, move_fn, 'shortcut and cursor helper')

s = replace(s,
'''            AnaApi.Action.WRITE -> "Ana is writing in $target…"\n            AnaApi.Action.FIX -> "Ana is correcting to $target…"\n            AnaApi.Action.TRANSLATE -> "Ana is translating to $target…"\n            else -> "Ana is working…"\n''',
'''            AnaApi.Action.WRITE -> "ANA AI • writing in $target…"\n            AnaApi.Action.FIX -> "ANA AI • correcting to $target…"\n            AnaApi.Action.TRANSLATE -> "ANA AI • translating to $target…"\n            else -> "ANA AI • working…"\n''', 'explicit AI status')

s = replace(s,
'''    private fun defaultStatus(): String = "Ana • local typing · AI when enabled"\n''',
'''    private fun defaultStatus(): String = "LOCAL • typing stays on device"\n''', 'local status')
write(p, s)

# ---------------------------------------------------------------------------
# Settings preview: cursor events must not become literal text
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/src/main/java/com/ana/keyboard/SettingsKeyboardPreviewView.kt'
s = read(p)
s = s.replace('Tap keys or glide to test your setup', 'Tap keys to test your setup')
s = replace(s,
'''            "SPACE" -> handleSpace()\n            "ENTER" -> appendText("\\n")\n''',
'''            "SPACE" -> handleSpace()\n            "CURSOR_LEFT", "CURSOR_RIGHT" -> Unit\n            "ENTER" -> appendText("\\n")\n''', 'preview cursor handling')
write(p, s)

# ---------------------------------------------------------------------------
# MainActivity settings UI
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/src/main/java/com/ana/keyboard/MainActivity.kt'
s = read(p)
s = s.replace('Keyboard size, number row, punctuation and toolbar', 'Keyboard size, one-handed mode, adaptive touch and keys')
s = s.replace('Personal words and learned corrections', 'Personal words, shortcuts and learned corrections')

s = replace(s,
'''        root.addView(switchRow("Smart sentence correction", "Automatically check the current sentence after you pause. Fixes grammar, completeness and contextual typing mistakes. The sentence is sent to your Ana server; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {\n''',
'''        root.addView(switchRow("Smart sentence correction", "Off by default for privacy. If you enable it, Ana sends only the current sentence to your Ana server after a pause; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {\n''', 'privacy smart setting')

layout_anchor = '''        root.addView(section("Keys"))\n'''
layout_insert = '''        root.addView(section("One-handed mode"))\n        root.addView(choiceRow("Off", "Full-width keyboard", KeyboardPrefs.oneHandedMode(this) == "off") {\n            KeyboardPrefs.setOneHandedMode(this, "off")\n            renderLayoutKeys()\n        })\n        root.addView(choiceRow("Left", "Shrink keys toward the left edge", KeyboardPrefs.oneHandedMode(this) == "left") {\n            KeyboardPrefs.setOneHandedMode(this, "left")\n            renderLayoutKeys()\n        })\n        root.addView(choiceRow("Right", "Shrink keys toward the right edge", KeyboardPrefs.oneHandedMode(this) == "right") {\n            KeyboardPrefs.setOneHandedMode(this, "right")\n            renderLayoutKeys()\n        })\n\n        root.addView(section("Adaptive touch"))\n        root.addView(switchRow("Learn my touch pattern", "Ana quietly adjusts invisible letter hitboxes to your usual thumb drift. Raw touch coordinates are not stored.", KeyboardPrefs.adaptiveTouchEnabled(this)) {\n            KeyboardPrefs.setAdaptiveTouchEnabled(this, it)\n        })\n        root.addView(infoCard("Local calibration", "Only small per-key offset averages and counts are stored on this device. The visible key layout never moves."))\n        root.addView(actionCard("Reset touch calibration") {\n            KeyboardPrefs.clearTouchCalibration(this)\n            activePreview?.refreshFromSettings()\n            Toast.makeText(this, "Touch calibration reset", Toast.LENGTH_SHORT).show()\n        })\n\n        root.addView(section("Spacebar"))\n        root.addView(infoCard("Cursor control", "Slide left or right across the spacebar to move the text cursor without inserting a space."))\n\n        root.addView(section("Keys"))\n'''
s = replace(s, layout_anchor, layout_insert, 'layout settings features')

shortcut_anchor = '''        root.addView(section("Learned corrections"))\n'''
shortcut_ui = r'''        root.addView(section("Text shortcuts"))
        root.addView(infoCard("Expand as you type", "Create private local shortcuts such as @@ for an email address. Type the shortcut, then press Space."))
        val shortcutTrigger = EditText(this).apply {
            hint = "Shortcut, e.g. @@"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            isSingleLine = true
            background = rounded(card2, 14)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        val shortcutExpansion = EditText(this).apply {
            hint = "Expansion"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            isSingleLine = true
            background = rounded(card2, 14)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        root.addView(shortcutTrigger, marginParams(dp(4)).apply { height = dp(50) })
        root.addView(shortcutExpansion, marginParams(dp(4)).apply { height = dp(50) })
        root.addView(actionCard("Add shortcut") {
            val trigger = shortcutTrigger.text.toString().trim()
            val expansion = shortcutExpansion.text.toString().trim()
            when {
                trigger.isBlank() || expansion.isBlank() -> Toast.makeText(this, "Enter both shortcut and expansion", Toast.LENGTH_SHORT).show()
                trigger.any { it.isWhitespace() } -> Toast.makeText(this, "Shortcut cannot contain spaces", Toast.LENGTH_SHORT).show()
                else -> {
                    KeyboardPrefs.setTextShortcut(this, trigger, expansion, badge)
                    renderDictionary()
                }
            }
        })
        val shortcuts = KeyboardPrefs.textShortcuts(this, badge)
        if (shortcuts.isEmpty()) {
            root.addView(infoCard("No shortcuts yet", "Shortcuts are stored locally for the selected typing language."))
        } else {
            shortcuts.toSortedMap().forEach { (trigger, expansion) ->
                root.addView(removableRow("$trigger  →  $expansion", "Local text shortcut") {
                    KeyboardPrefs.removeTextShortcut(this, trigger, badge)
                    renderDictionary()
                })
            }
        }

        root.addView(section("Learned corrections"))
'''
s = replace(s, shortcut_anchor, shortcut_ui, 'shortcut settings')

old_privacy = '''        root.addView(section("Privacy"))\n        root.addView(infoCard("Normal typing stays local", "Ordinary keystrokes, local correction and glide decoding are not sent to Ana."))\n        root.addView(infoCard("AI only on explicit action", "Text is sent only when you tap Write or Translate."))\n        root.addView(infoCard("Password fields", "Ana AI, voice, suggestions and clipboard are disabled in password fields."))\n'''
new_privacy = '''        root.addView(section("Privacy"))\n        root.addView(infoCard("LOCAL means local", "Ordinary keystrokes, word correction, personal dictionary, shortcuts and adaptive touch calibration stay on this device."))\n        root.addView(infoCard("ANA AI is visible", "The keyboard status changes from LOCAL to ANA AI whenever text is being sent to your Ana server for Translate, Write, Correct or an enabled smart sentence check."))\n        root.addView(infoCard("Smart sentence AI is opt-in", "Automatic cloud sentence correction is off by default. Turn it on under Typing only if you want it."))\n        root.addView(infoCard("Password fields", "Ana AI, voice, suggestions and clipboard are disabled in password fields."))\n'''
s = replace(s, old_privacy, new_privacy, 'privacy cards')
write(p, s)

# ---------------------------------------------------------------------------
# GIF picker: use Ana server proxy first; direct KLIPY v2/v1 fallback; real errors
# ---------------------------------------------------------------------------
gif_picker = r'''package com.ana.keyboard

import android.app.Activity
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors

class GifPickerActivity : Activity() {
    private data class GifItem(val previewUrl: String, val shareUrl: String, val title: String)

    private val io = Executors.newFixedThreadPool(4)
    private lateinit var results: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var search: EditText
    private var requestId = 0

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(22, 22, 24)
        window.navigationBarColor = Color.rgb(18, 18, 20)
        setContentView(buildUi())
        loadGifs("")
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(24, 24, 26))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        root.addView(TextView(this).apply {
            text = "GIFs"
            textSize = 23f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        val searchRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        search = EditText(this).apply {
            hint = "Search KLIPY"
            setHintTextColor(Color.rgb(155, 155, 160))
            setTextColor(Color.WHITE)
            setSingleLine(true)
            textSize = 16f
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setBackgroundColor(Color.rgb(48, 48, 52))
            setPadding(dp(14), 0, dp(14), 0)
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEARCH) { runSearch(); true } else false
            }
        }
        searchRow.addView(search, LinearLayout.LayoutParams(0, dp(48), 1f))
        searchRow.addView(Button(this).apply {
            text = "Search"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(58, 58, 62))
            setOnClickListener { runSearch() }
        }, LinearLayout.LayoutParams(dp(92), dp(48)).apply { marginStart = dp(8) })
        root.addView(searchRow)

        val stateRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        status = TextView(this).apply {
            text = "Trending GIFs"
            textSize = 13f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
        }
        progress = ProgressBar(this).apply { visibility = View.GONE }
        stateRow.addView(status, LinearLayout.LayoutParams(0, dp(42), 1f))
        stateRow.addView(progress, LinearLayout.LayoutParams(dp(30), dp(30)))
        root.addView(stateRow)

        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(2), 0, dp(6)) }
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(results, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val footer = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        footer.addView(Button(this).apply {
            text = "From phone"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(48, 48, 52))
            setOnClickListener { openPhoneGif() }
        }, LinearLayout.LayoutParams(dp(118), dp(44)))
        footer.addView(TextView(this).apply {
            text = "Powered by KLIPY"
            textSize = 12f
            setTextColor(Color.rgb(190, 190, 195))
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        root.addView(footer)
        return root
    }

    private fun runSearch() = loadGifs(search.text.toString().trim())

    private fun loadGifs(query: String) {
        val thisRequest = ++requestId
        progress.visibility = View.VISIBLE
        status.text = "Loading…"
        results.removeAllViews()
        io.execute {
            try {
                val items = fetchWithFallbacks(query)
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    status.text = if (items.isEmpty()) "No GIFs found" else if (query.isBlank()) "Trending GIFs" else "Results for “$query”"
                    render(items)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (thisRequest != requestId || isFinishing) return@runOnUiThread
                    progress.visibility = View.GONE
                    val detail = error.message?.take(90).orEmpty()
                    status.text = if (detail.isBlank()) "GIF search unavailable — choose one from your phone" else "GIF search unavailable: $detail"
                }
            }
        }
    }

    private fun fetchWithFallbacks(query: String): List<GifItem> {
        val errors = mutableListOf<String>()
        val encoded = URLEncoder.encode(query, "UTF-8")
        val base = KeyboardPrefs.baseUrl(this).trimEnd('/')
        if (base.startsWith("https://")) {
            val proxy = "$base/api/gifs?limit=18" + if (query.isBlank()) "" else "&q=$encoded"
            try { return fetchNormalized(proxy).takeIf { it.isNotEmpty() } ?: emptyList() }
            catch (e: Exception) { errors += "Ana proxy ${e.message.orEmpty()}" }
        }

        val v2 = if (query.isBlank()) {
            "https://api.klipy.com/v2/featured?key=$KLIPY_FALLBACK_KEY&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=18"
        } else {
            "https://api.klipy.com/v2/search?key=$KLIPY_FALLBACK_KEY&q=$encoded&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=18"
        }
        try { return fetchKlipyV2(v2) } catch (e: Exception) { errors += "KLIPY v2 ${e.message.orEmpty()}" }

        val action = if (query.isBlank()) "trending" else "search"
        val v1 = "https://api.klipy.com/api/v1/$KLIPY_FALLBACK_KEY/gifs/$action?page=1&per_page=18&customer_id=ana-keyboard&locale=en_US" +
            if (query.isBlank()) "" else "&q=$encoded"
        try { return fetchKlipyV1(v1) } catch (e: Exception) { errors += "KLIPY v1 ${e.message.orEmpty()}" }
        throw IllegalStateException(errors.lastOrNull()?.take(110) ?: "provider unavailable")
    }

    private fun openJson(endpoint: String): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = 7_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("User-Agent", "AnaKeyboard/0.9")
            val code = connection.responseCode
            if (code !in 200..299) {
                val errorBody = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                throw IllegalStateException("HTTP $code ${errorBody.take(70)}")
            }
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun fetchNormalized(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        val array = root.optJSONArray("results") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val preview = item.optString("preview").takeIf { it.startsWith("https://") } ?: continue
                val share = item.optString("share").takeIf { it.startsWith("https://") } ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun fetchKlipyV2(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        root.optJSONObject("errors")?.let { throw IllegalStateException(it.toString().take(90)) }
        val array = root.optJSONArray("results") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val formats = item.optJSONObject("media_formats") ?: continue
                fun media(name: String): String? = formats.optJSONObject(name)?.optString("url")?.takeIf { it.startsWith("https://") }
                val preview = media("tinygif") ?: media("mediumgif") ?: media("gif") ?: continue
                val share = media("gif") ?: media("mediumgif") ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun fetchKlipyV1(endpoint: String): List<GifItem> {
        val root = openJson(endpoint)
        val array = root.optJSONObject("data")?.optJSONArray("data") ?: return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                if (item.optString("type") == "ad") continue
                val file = item.optJSONObject("file") ?: continue
                fun media(size: String): String? = file.optJSONObject(size)?.optJSONObject("gif")?.optString("url")?.takeIf { it.startsWith("https://") }
                val preview = media("xs") ?: media("sm") ?: media("md") ?: media("hd") ?: continue
                val share = media("md") ?: media("sm") ?: media("hd") ?: preview
                add(GifItem(preview, share, item.optString("title", "GIF")))
            }
        }.take(18)
    }

    private fun render(items: List<GifItem>) {
        results.removeAllViews()
        items.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            pair.forEach { item ->
                row.addView(gifTile(item), LinearLayout.LayoutParams(0, dp(132), 1f).apply { setMargins(dp(3), dp(3), dp(3), dp(3)) })
            }
            if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, dp(132), 1f))
            results.addView(row)
        }
    }

    private fun gifTile(item: GifItem): ImageView = ImageView(this).apply {
        setBackgroundColor(Color.rgb(42, 42, 45))
        scaleType = ImageView.ScaleType.CENTER_CROP
        contentDescription = item.title
        setOnClickListener { chooseOnlineGif(item.shareUrl) }
        loadPreview(this, item.previewUrl)
    }

    private fun loadPreview(view: ImageView, url: String) {
        io.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 7_000
                connection.readTimeout = 10_000
                connection.setRequestProperty("User-Agent", "AnaKeyboard/0.9")
                connection.inputStream.use { input ->
                    val bytes = input.readBytes()
                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@use
                    runOnUiThread { if (!isFinishing) view.setImageBitmap(bitmap) }
                }
            } catch (_: Exception) {
            } finally { connection?.disconnect() }
        }
    }

    private fun chooseOnlineGif(remoteUrl: String) {
        val token = UUID.randomUUID().toString().replace("-", "")
        GifSourceStore.put(this, token, remoteUrl)
        val contentUri = Uri.Builder().scheme("content").authority(GIF_AUTHORITY).appendPath(token).build()
        KeyboardPrefs.setPendingGifUri(this, contentUri.toString())
        finish()
    }

    private fun openPhoneGif() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/gif"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(intent, REQUEST_GIF)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_GIF && resultCode == RESULT_OK) {
            val uri = data?.data
            if (uri != null) {
                try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { }
                KeyboardPrefs.setPendingGifUri(this, uri.toString())
            }
            finish()
        }
    }

    override fun onDestroy() { io.shutdownNow(); super.onDestroy() }

    companion object {
        private const val REQUEST_GIF = 71
        private const val GIF_AUTHORITY = "com.ana.keyboard.gifs"
        // Public development fallback only. Production should use KLIPY_API_KEY on the Ana server.
        private const val KLIPY_FALLBACK_KEY = "sandbox-mJokm7E2jH"
    }
}
'''
write('android-keyboard/app/src/main/java/com/ana/keyboard/GifPickerActivity.kt', gif_picker)

# ---------------------------------------------------------------------------
# Server-side GIF proxy with normalized response + CDN cache
# ---------------------------------------------------------------------------
gif_api = r'''const TEST_KEY = 'sandbox-mJokm7E2jH'

function cleanUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') ? value : ''
}

function normalizeV2(payload) {
  const source = Array.isArray(payload?.results) ? payload.results : []
  return source.slice(0, 24).map(item => {
    const formats = item?.media_formats || {}
    const preview = cleanUrl(formats?.tinygif?.url) || cleanUrl(formats?.mediumgif?.url) || cleanUrl(formats?.gif?.url)
    const share = cleanUrl(formats?.gif?.url) || cleanUrl(formats?.mediumgif?.url) || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

function normalizeV1(payload) {
  const source = Array.isArray(payload?.data?.data) ? payload.data.data : []
  return source.slice(0, 24).map(item => {
    if (item?.type === 'ad') return null
    const file = item?.file || {}
    const gif = size => cleanUrl(file?.[size]?.gif?.url)
    const preview = gif('xs') || gif('sm') || gif('md') || gif('hd')
    const share = gif('md') || gif('sm') || gif('hd') || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

async function getJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'AnaKeyboard/0.9' }, signal: controller.signal })
    const text = await response.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = {} }
    if (!response.ok) throw new Error(`KLIPY ${response.status}: ${data?.errors?.message?.[0] || data?.message || text.slice(0, 100)}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const q = String(req.query?.q || '').trim().slice(0, 80)
  const limit = Math.max(1, Math.min(24, Number(req.query?.limit) || 18))
  const key = process.env.KLIPY_API_KEY || TEST_KEY
  const encodedKey = encodeURIComponent(key)
  const encodedQ = encodeURIComponent(q)

  try {
    const v2 = q
      ? `https://api.klipy.com/v2/search?key=${encodedKey}&q=${encodedQ}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
      : `https://api.klipy.com/v2/featured?key=${encodedKey}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
    const data = await getJson(v2)
    const results = normalizeV2(data)
    if (results.length) {
      res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json({ provider: 'klipy', results })
    }
  } catch (firstError) {
    try {
      const action = q ? 'search' : 'trending'
      const v1 = `https://api.klipy.com/api/v1/${encodedKey}/gifs/${action}?page=1&per_page=${limit}&customer_id=ana-keyboard&locale=en_US${q ? `&q=${encodedQ}` : ''}`
      const data = await getJson(v1)
      const results = normalizeV1(data)
      if (results.length) {
        res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
        return res.status(200).json({ provider: 'klipy', results })
      }
    } catch (secondError) {
      return res.status(503).json({ error: 'GIF provider unavailable', detail: String(secondError?.message || firstError?.message || '').slice(0, 160), needsProductionKey: !process.env.KLIPY_API_KEY })
    }
  }
  return res.status(200).json({ provider: 'klipy', results: [] })
}
'''
write('api/gifs.js', gif_api)

# ---------------------------------------------------------------------------
# Version + env documentation
# ---------------------------------------------------------------------------
p = 'android-keyboard/app/build.gradle.kts'
s = read(p)
s = s.replace('versionCode = 8', 'versionCode = 9').replace('versionName = "0.8.0"', 'versionName = "0.9.0"')
write(p, s)

p = '.env.example'
s = read(p)
if 'KLIPY_API_KEY=' not in s:
    s += '\n# Ana Keyboard GIF search (use a KLIPY production key; never embed it in the APK)\nKLIPY_API_KEY=\n'
write(p, s)

print('Ana Keyboard v0.9 feature pack applied')
