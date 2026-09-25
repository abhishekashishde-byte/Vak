package com.ana.keyboard

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private val bg = Color.rgb(30, 30, 31)
    private val card = Color.rgb(39, 39, 41)
    private val card2 = Color.rgb(49, 49, 52)
    private val textColor = Color.WHITE
    private val subColor = Color.rgb(188, 188, 193)
    private val accent = Color.rgb(230, 181, 65)
    private var currentScreen = "home"
    private var previewExpanded = true
    private var activePreview: SettingsKeyboardPreviewView? = null

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderHome()
    }

    override fun onBackPressed() {
        if (currentScreen != "home") renderHome() else super.onBackPressed()
    }

    private fun page(title: String): LinearLayout {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(30))
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        if (currentScreen != "home") {
            top.addView(TextView(this).apply {
                text = "‹"
                textSize = 42f
                setTextColor(textColor)
                gravity = Gravity.CENTER
                setOnClickListener { renderHome() }
            }, LinearLayout.LayoutParams(dp(50), dp(60)))
        }
        top.addView(TextView(this).apply {
            text = title
            textSize = if (currentScreen == "home") 28f else 26f
            setTextColor(textColor)
            setTypeface(typeface, Typeface.NORMAL)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(64), 1f))
        root.addView(top)

        outer.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        outer.addView(createTryoutArea(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(outer)
        return root
    }

    private fun createTryoutArea(): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(34, 34, 36))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(12), 0)
            setBackgroundColor(Color.rgb(60, 60, 62))
        }
        header.addView(TextView(this).apply {
            text = "Try out your setup"
            textSize = 17f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(52), 1f))

        val preview = SettingsKeyboardPreviewView(this)
        activePreview = preview
        val toggle = TextView(this).apply {
            text = if (previewExpanded) "⌄" else "⌃"
            textSize = 30f
            setTextColor(Color.BLACK)
            gravity = Gravity.CENTER
            background = rounded(accent, 18)
        }
        header.addView(toggle, LinearLayout.LayoutParams(dp(54), dp(44)))
        wrap.addView(header)

        val previewHolder = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = if (previewExpanded) View.VISIBLE else View.GONE
            addView(
                preview,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(KeyboardSizing.previewTotalHeightDp(this@MainActivity))
                )
            )
        }
        wrap.addView(previewHolder)

        toggle.setOnClickListener {
            previewExpanded = !previewExpanded
            previewHolder.visibility = if (previewExpanded) View.VISIBLE else View.GONE
            toggle.text = if (previewExpanded) "⌄" else "⌃"
            if (previewExpanded) preview.refreshFromSettings()
        }
        header.setOnClickListener { toggle.performClick() }
        return wrap
    }

    private fun renderHome() {
        currentScreen = "home"
        val root = page("Ana Keyboard settings")
        root.addView(summary("Every visible setting below is connected to real keyboard behaviour."))

        root.addView(menuRow("Ana account", accountSummary()) { renderAccount() })
        root.addView(menuRow("Languages", "Typing languages and Translate-to language") { renderLanguages() })
        root.addView(menuRow("Themes", themeSummary()) { renderTheme() })
        root.addView(menuRow("Typing", "Auto-correction, smart sentence correction and suggestions") { renderTyping() })
        root.addView(menuRow("Rich input", "Voice typing, clipboard and Writing Tool") { renderRichInput() })
        root.addView(menuRow("Layout & keys", "Keyboard size, one-handed mode, adaptive touch and keys") { renderLayoutKeys() })
        root.addView(menuRow("Sound & vibration", "Key click and vibration strength") { renderSoundVibration() })
        root.addView(menuRow("Dictionary & corrections", "Personal words, shortcuts and learned corrections") { renderDictionary() })
        root.addView(menuRow("Privacy & Ana", "Ana connection and local typing protection") { renderPrivacy() })

        root.addView(section("Setup"))
        root.addView(actionCard("Enable Ana Keyboard") { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) })
        root.addView(actionCard("Choose Ana Keyboard") {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        })
    }

    private fun accountSummary(): String =
        AnaAccountSync.signedInEmail(this)?.let { "Signed in as $it • keyboard learning sync on" }
            ?: "Sign in to sync words and corrections across devices"

    private fun renderAccount() {
        currentScreen = "account"
        val root = page("Ana account")
        val signedInEmail = AnaAccountSync.signedInEmail(this)

        if (signedInEmail != null) {
            root.addView(infoCard("Signed in", signedInEmail))
            root.addView(infoCard(
                "Cross-device learning",
                "Personal words, learned corrections and text shortcuts sync through your Ana account. Touch calibration stays on this device."
            ))
            root.addView(actionCard("Sync now") {
                Thread {
                    try {
                        val result = AnaAccountSync.syncNow(this)
                        runOnUiThread {
                            Toast.makeText(
                                this,
                                "Synced • ${result.remoteEntries} saved entries",
                                Toast.LENGTH_SHORT
                            ).show()
                            renderAccount()
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            Toast.makeText(this, error.message ?: "Sync failed", Toast.LENGTH_LONG).show()
                            renderAccount()
                        }
                    }
                }.start()
            })
            root.addView(actionCard("Sign out") {
                AnaAccountSync.signOut(this)
                Toast.makeText(this, "Signed out", Toast.LENGTH_SHORT).show()
                renderAccount()
            })
            return
        }

        root.addView(summary("Use the same Ana email and password on another Android device. Your keyboard learning follows the account, not the phone."))

        val email = EditText(this).apply {
            hint = "Email"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            isSingleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            background = rounded(card2, 14)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        val password = EditText(this).apply {
            hint = "Password"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            isSingleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            background = rounded(card2, 14)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        root.addView(email, marginParams(dp(5)).apply { height = dp(52) })
        root.addView(password, marginParams(dp(5)).apply { height = dp(52) })

        root.addView(actionCard("Sign in and sync") {
            val enteredEmail = email.text.toString().trim()
            val enteredPassword = password.text.toString()
            if (enteredEmail.isBlank() || enteredPassword.isBlank()) {
                Toast.makeText(this, "Enter email and password", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Signing in…", Toast.LENGTH_SHORT).show()
                Thread {
                    try {
                        val result = AnaAccountSync.signInAndSync(this, enteredEmail, enteredPassword)
                        runOnUiThread {
                            Toast.makeText(
                                this,
                                "Signed in • ${result.remoteEntries} saved entries",
                                Toast.LENGTH_LONG
                            ).show()
                            renderAccount()
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            Toast.makeText(this, error.message ?: "Sign in failed", Toast.LENGTH_LONG).show()
                        }
                    }
                }.start()
            }
        })

        root.addView(actionCard("Create Ana account") {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    android.net.Uri.parse(KeyboardPrefs.baseUrl(this))
                )
            )
        })
        root.addView(infoCard(
            "What is synced",
            "Only personal words, learned corrections and text shortcuts. Passwords are never stored; the signed-in session is encrypted with Android Keystore."
        ))
    }

    private fun renderLanguages() {
        currentScreen = "languages"
        val root = page("Languages")
        root.addView(summary("Typing layout and translation target are separate. You can type in English and translate to French, for example."))

        root.addView(section("Typing language"))
        KeyboardPrefs.inputLanguages.forEach { (name, badge) ->
            val layout = when (badge) {
                "DE" -> "QWERTZ • German"
                "HIN" -> "QWERTY • Roman Hindi / Hinglish"
                else -> "QWERTY • English"
            }
            root.addView(choiceRow("$name  ·  $badge", layout, KeyboardPrefs.inputLanguage(this) == name) {
                KeyboardPrefs.setInputLanguage(this, name)
                renderLanguages()
            })
        }

        root.addView(infoCard("Prediction follows this language", "Next-word predictions, autocorrect candidates, emoji suggestions and learned word-to-word patterns use the selected typing language. EN, DE and HIN keep separate local learning."))

        root.addView(section("Translate to"))
        root.addView(infoCard("Current target", "${KeyboardPrefs.target(this)}  ·  ${KeyboardPrefs.targetBadge(this)}"))
        val search = EditText(this).apply {
            hint = "Search translation language"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            textSize = 16f
            isSingleLine = true
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = rounded(card2, 16)
        }
        root.addView(search, marginParams(dp(5)))
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(results)

        fun fillTargets(query: String) {
            results.removeAllViews()
            val q = query.trim().lowercase()
            KeyboardPrefs.translationTargets
                .filter { q.isBlank() || it.name.lowercase().contains(q) || it.badge.lowercase().contains(q) }
                .forEach { target ->
                    results.addView(choiceRow(target.name, target.badge, KeyboardPrefs.target(this) == target.name) {
                        KeyboardPrefs.setTarget(this, target.name)
                        Toast.makeText(this, "Translate to ${target.name}", Toast.LENGTH_SHORT).show()
                        renderLanguages()
                    })
                }
        }
        search.addTextChangedListener(SimpleTextWatcher { fillTargets(it) })
        fillTargets("")
    }

    private fun renderTheme() {
        currentScreen = "theme"
        val root = page("Themes")
        root.addView(section("Keyboard theme"))
        listOf(
            Triple("Default dark", "dark", "Neutral dark keyboard"),
            Triple("Midnight", "midnight", "Deep black keyboard"),
            Triple("Ana Gold", "gold", "Dark keyboard with Ana gold accents"),
            Triple("Light", "light", "Light keys and background")
        ).forEach { (name, id, detail) ->
            root.addView(choiceRow(name, detail, KeyboardPrefs.theme(this) == id) {
                KeyboardPrefs.setTheme(this, id)
                renderTheme()
            })
        }

        root.addView(section("Background"))
        root.addView(summary("Optional. Pick one of Ana's built-in backgrounds, use a photo from your gallery, or leave it as None."))
        KeyboardBackgrounds.presets.forEach { preset ->
            root.addView(backgroundPresetCard(preset))
        }

        root.addView(section("Your photo"))
        val current = KeyboardPrefs.backgroundUri(this)
        root.addView(actionCard(if (current.isBlank()) "Choose photo from gallery" else "Change gallery photo") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            startActivityForResult(intent, REQUEST_BACKGROUND)
        })
        if (current.isNotBlank()) {
            root.addView(backgroundTintCard())
            root.addView(actionCard("Remove gallery photo") {
                KeyboardPrefs.setBackgroundUri(this, "")
                renderTheme()
            })
        }
        root.addView(infoCard("Photo privacy", "Gallery backgrounds stay on this device. Ana does not upload them."))

        root.addView(section("Key press animation"))
        root.addView(summary("Optional. This changes only the visual press effect and never delays character input."))
        listOf(
            Triple("Off", "off", "No animated key effect"),
            Triple("Subtle", "subtle", "A quick soft press with minimal movement"),
            Triple("Pop", "pop", "A slightly larger press with a short accent halo")
        ).forEach { (name, id, detail) ->
            root.addView(choiceRow(name, detail, KeyboardPrefs.keyPressAnimation(this) == id) {
                KeyboardPrefs.setKeyPressAnimation(this, id)
                activePreview?.refreshFromSettings()
                renderTheme()
            })
        }

        root.addView(actionCard("Reset visual customizations") {
            KeyboardPrefs.resetVisualCustomizations(this)
            activePreview?.refreshFromSettings()
            Toast.makeText(this, "Visual settings reset", Toast.LENGTH_SHORT).show()
            renderTheme()
        })
    }
    private fun renderTyping() {
        currentScreen = "typing"
        val root = page("Typing")
        root.addView(section("Corrections"))
        root.addView(switchRow("Auto-correction", "Correct confident spelling mistakes when you press Space", KeyboardPrefs.autoCorrectionEnabled(this)) {
            KeyboardPrefs.setAutoCorrectionEnabled(this, it)
        })
        root.addView(switchRow("Smart paragraph correction", "Off by default for privacy. If enabled, Ana checks the active paragraph after a pause. Choose below whether Ana applies safe changes automatically or waits for your approval.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {
            KeyboardPrefs.setSmartSentenceCorrectionEnabled(this, it)
        })
        root.addView(section("AI correction handling"))
        root.addView(choiceRow("Review before replacing", "Ana shows the full proposed change. Read it, then tap Accept to replace it or Reject to keep what you wrote.", KeyboardPrefs.smartCorrectionMode(this) == "review") {
            KeyboardPrefs.setSmartCorrectionMode(this, "review")
            renderTyping()
        })
        root.addView(choiceRow("Apply automatically", "Approve safe paragraph corrections by default. Ana replaces the active paragraph automatically after its safety checks.", KeyboardPrefs.smartCorrectionMode(this) == "auto") {
            KeyboardPrefs.setSmartCorrectionMode(this, "auto")
            renderTyping()
        })
        root.addView(switchRow("Word suggestions", "First choice is exactly what you typed; tap it to teach Ana that word", KeyboardPrefs.wordSuggestionsEnabled(this)) {
            KeyboardPrefs.setWordSuggestionsEnabled(this, it)
        })
        root.addView(switchRow("Auto-capitalisation", "Capitalise sentence starts", KeyboardPrefs.autoCapitalisationEnabled(this)) {
            KeyboardPrefs.setAutoCapitalisationEnabled(this, it)
        })
        root.addView(switchRow("Double-space full stop", "Double-tap Space for period + space", KeyboardPrefs.doubleSpacePeriodEnabled(this)) {
            KeyboardPrefs.setDoubleSpacePeriodEnabled(this, it)
        })
        root.addView(switchRow("Auto-space after punctuation", "Add a space after common punctuation", KeyboardPrefs.autoSpaceAfterPunctuation(this)) {
            KeyboardPrefs.setAutoSpaceAfterPunctuation(this, it)
        })
        root.addView(switchRow("Auto-space after suggestion", "Add a space after tapping a word, next-word or emoji suggestion", KeyboardPrefs.autoSpaceAfterSuggestion(this)) {
            KeyboardPrefs.setAutoSpaceAfterSuggestion(this, it)
        })
        root.addView(infoCard("Language-aware next word", "Ana predicts locally from the selected keyboard language first, then blends in your own local word-to-word learning for that language."))

        root.addView(section("Swipe typing"))
        root.addView(infoCard("Paused for stability", "Swipe typing is temporarily disabled. Ana now treats finger movement during fast typing as normal typing only while we prioritise zero-lag typing."))
    }

    private fun renderRichInput() {
        currentScreen = "rich"
        val root = page("Rich input")
        root.addView(section("Voice typing"))
        root.addView(switchRow("Voice typing", "Show the microphone button in the Ana toolbar", KeyboardPrefs.voiceTypingEnabled(this)) {
            KeyboardPrefs.setVoiceTypingEnabled(this, it)
        })
        root.addView(choiceRow("Clean dictation", "Live preview while speaking, then remove filler/false starts and resolve spoken self-corrections. Uses Ana AI after you finish speaking.", KeyboardPrefs.dictationMode(this) == "clean") {
            KeyboardPrefs.setDictationMode(this, "clean")
            renderRichInput()
        })
        root.addView(choiceRow("Exact dictation", "Insert the recognizer result as heard, without Ana AI cleanup.", KeyboardPrefs.dictationMode(this) == "exact") {
            KeyboardPrefs.setDictationMode(this, "exact")
            renderRichInput()
        })
        root.addView(switchRow("Prefer on-device recognition", "Optional. Uses Android's on-device recognizer when its language model is available. Leave off for the most compatible voice typing.", KeyboardPrefs.preferOnDeviceDictation(this)) {
            KeyboardPrefs.setPreferOnDeviceDictation(this, it)
        })
        root.addView(infoCard("Voice edit", "Select text in any app, tap Voice edit in Ana's toolbar, then say instructions such as “make this shorter”, “translate to German” or “make it formal”."))
        root.addView(infoCard("Mic permission vs Mic access", "Android has two controls. Ana needs microphone permission, and Android's global Mic access switch must also be ON. If permission is already allowed but the mic cannot listen, check Mic access in Quick Settings."))
        root.addView(actionCard("Microphone permission") {
            startActivity(Intent(this, MicrophonePermissionActivity::class.java))
        })

        root.addView(section("Clipboard"))
        root.addView(infoCard("Recent clips", "Ana stores up to 10 recent text clips locally when you open its clipboard panel."))
        root.addView(infoCard("Photos & screenshots", "Open Clipboard → Photos to choose a recent photo or screenshot with Android's system picker. If an image is already on the clipboard, Ana can offer Paste image when the current app supports rich image input."))
        root.addView(actionCard("Clear Ana clipboard history") {
            KeyboardPrefs.clearClipboardHistory(this)
            Toast.makeText(this, "Clipboard history cleared", Toast.LENGTH_SHORT).show()
        })

        root.addView(section("Toolbar"))
        root.addView(infoCard("Keep it compact", "Choose only the actions you use regularly. This keeps Ana's toolbar from getting wider every time new capabilities are added."))
        KeyboardPrefs.toolbarActionOptions.forEach { (id, label) ->
            root.addView(switchRow(label, "Show $label in the keyboard toolbar", KeyboardPrefs.toolbarActionEnabled(this, id)) {
                KeyboardPrefs.setToolbarActionEnabled(this, id, it)
            })
        }

        root.addView(section("Writing Tool"))
        root.addView(infoCard("Write", "Type or dictate what you want to say, then tap Write. Ana drafts the finished message in the currently selected Translate-to language."))
        root.addView(infoCard("Inline actions", "Translate, Correct, Shorter, Friendly, Formal, Du and Sie work directly on selected text—or on the current line when nothing is selected."))
        root.addView(infoCard("Snippets", "Your existing text shortcuts are Ana snippets: save triggers such as /thanks or /meeting in Dictionary & shortcuts and Ana expands them locally when you press Space."))
    }

    private fun renderLayoutKeys() {
        currentScreen = "layout"
        val root = page("Layout & keys")

        root.addView(section("Portrait height"))
        KeyboardSizing.options.forEach { size ->
            val detail = when (size) {
                "Small" -> "More screen space in portrait"
                "Large" -> "Taller portrait keys"
                else -> "Balanced portrait height"
            }
            root.addView(choiceRow(size, detail, KeyboardSizing.portraitSize(this) == size) {
                KeyboardSizing.setPortraitSize(this, size)
                renderLayoutKeys()
            })
        }

        root.addView(section("Landscape height"))
        KeyboardSizing.options.forEach { size ->
            val detail = when (size) {
                "Small" -> "Compact landscape layout"
                "Large" -> "Tall landscape keys"
                else -> "Balanced landscape height"
            }
            root.addView(choiceRow(size, detail, KeyboardSizing.landscapeSize(this) == size) {
                KeyboardSizing.setLandscapeSize(this, size)
                renderLayoutKeys()
            })
        }

        root.addView(section("Key feel & appearance"))
        root.addView(intSliderCard("Key transparency", "Adjust only the key background. Letters, icons and invisible touch targets stay fully visible and unchanged.", KeyboardPrefs.keyOpacityPercent(this), 20, 100, "%") {
            KeyboardPrefs.setKeyOpacityPercent(this, it)
        })
        root.addView(intSliderCard("Key spacing", "Distance between visible keys", KeyboardPrefs.keyGapDp(this), 2, 9, " dp") {
            KeyboardPrefs.setKeyGapDp(this, it)
        })
        root.addView(intSliderCard("Key roundness", "Corner radius of each key", KeyboardPrefs.keyRadiusDp(this), 3, 18, " dp") {
            KeyboardPrefs.setKeyRadiusDp(this, it)
        })
        root.addView(intSliderCard("Key label size", "Letter and symbol size", KeyboardPrefs.keyLabelScalePercent(this), 85, 125, "%") {
            KeyboardPrefs.setKeyLabelScalePercent(this, it)
        })
        root.addView(switchRow("Key borders", "Add a subtle outline to separate keys more clearly", KeyboardPrefs.keyBordersEnabled(this)) {
            KeyboardPrefs.setKeyBordersEnabled(this, it)
        })

        root.addView(section("One-handed mode"))
        root.addView(choiceRow("Off", "Full-width keyboard", KeyboardPrefs.oneHandedMode(this) == "off") {
            KeyboardPrefs.setOneHandedMode(this, "off")
            renderLayoutKeys()
        })
        root.addView(choiceRow("Left", "Shrink keys toward the left edge", KeyboardPrefs.oneHandedMode(this) == "left") {
            KeyboardPrefs.setOneHandedMode(this, "left")
            renderLayoutKeys()
        })
        root.addView(choiceRow("Right", "Shrink keys toward the right edge", KeyboardPrefs.oneHandedMode(this) == "right") {
            KeyboardPrefs.setOneHandedMode(this, "right")
            renderLayoutKeys()
        })
        root.addView(intSliderCard("One-handed width", "How much of the screen the compact keyboard uses", KeyboardPrefs.oneHandedWidthPercent(this), 68, 92, "%") {
            KeyboardPrefs.setOneHandedWidthPercent(this, it)
        })

        root.addView(section("Long press"))
        root.addView(intSliderCard("Long-press delay", "Higher values reduce accidental alternate-character popups during fast typing", KeyboardPrefs.longPressDelayMs(this), 260, 520, " ms") {
            KeyboardPrefs.setLongPressDelayMs(this, it)
        })

        root.addView(section("Adaptive touch"))
        root.addView(switchRow("Learn my touch pattern", "Ana quietly adjusts invisible letter hitboxes to your usual thumb drift. Raw touch coordinates are not stored.", KeyboardPrefs.adaptiveTouchEnabled(this)) {
            KeyboardPrefs.setAdaptiveTouchEnabled(this, it)
        })
        root.addView(infoCard("Portrait + landscape learning", "Ana learns separate per-key thumb drift for portrait and landscape. Only small offset averages and counts are stored locally; raw touch coordinates are not retained."))
        root.addView(actionCard("Reset touch calibration") {
            KeyboardPrefs.clearTouchCalibration(this)
            activePreview?.refreshFromSettings()
            Toast.makeText(this, "Touch calibration reset", Toast.LENGTH_SHORT).show()
        })

        root.addView(section("Default layout"))
        root.addView(infoCard("Number row on", "Ana starts with 1–0 above the letter rows. You can still change this under Layout & keys."))
        root.addView(infoCard("Context-aware Enter", "Ana follows the active field: Search/Go/Next/Done/Send for single-line action fields, while multiline messages, email bodies, notes and documents keep a normal newline."))

        root.addView(section("Spacebar"))
        root.addView(infoCard("Forgiving Space", "The spacebar has a larger invisible hit area. Hold briefly and slide left or right only when you intentionally want cursor control."))
        root.addView(intSliderCard("Spacebar width", "Make the central space target wider or more compact", KeyboardPrefs.spacebarScalePercent(this), 90, 135, "%") {
            KeyboardPrefs.setSpacebarScalePercent(this, it)
        })

        root.addView(section("Keys"))
        root.addView(switchRow("Number row", "Always show 1–0 above letters", KeyboardPrefs.numberRowEnabled(this)) {
            KeyboardPrefs.setNumberRowEnabled(this, it)
        })
        root.addView(switchRow("Comma key", "Show comma on the main keyboard", KeyboardPrefs.commaKeyEnabled(this)) {
            KeyboardPrefs.setCommaKeyEnabled(this, it)
        })
        root.addView(switchRow("Full stop key", "Show full stop on the main keyboard", KeyboardPrefs.fullStopKeyEnabled(this)) {
            KeyboardPrefs.setFullStopKeyEnabled(this, it)
        })
        root.addView(switchRow("Key pop-up", "Show the enlarged key indicator while pressing", KeyboardPrefs.keyPopupEnabled(this)) {
            KeyboardPrefs.setKeyPopupEnabled(this, it)
        })
        root.addView(switchRow("Ana toolbar", "Show Translate, Write, clipboard, voice and target language", KeyboardPrefs.toolbarEnabled(this)) {
            KeyboardPrefs.setToolbarEnabled(this, it)
        })
    }

    private fun renderSoundVibration() {
        currentScreen = "sound"
        val root = page("Sound & vibration")
        root.addView(switchRow("Keypress sound", "Play a click when a key is pressed", KeyboardPrefs.soundEnabled(this)) {
            KeyboardPrefs.setSoundEnabled(this, it)
            if (it) (getSystemService(AUDIO_SERVICE) as AudioManager).playSoundEffect(AudioManager.FX_KEY_CLICK, 0.35f)
        })
        root.addView(switchRow("Keyboard vibration", "Vibrate on every keypress", KeyboardPrefs.hapticEnabled(this)) {
            KeyboardPrefs.setHapticEnabled(this, it)
            if (it) previewVibration()
        })
        root.addView(vibrationStrengthCard())
    }

    private fun renderDictionary() {
        currentScreen = "dictionary"
        val root = page("Dictionary & corrections")
        val badge = KeyboardPrefs.inputBadge(this)
        root.addView(summary("Dictionary shown for ${KeyboardPrefs.inputLanguage(this)} ($badge). Change typing language under Languages to edit another dictionary."))

        root.addView(section("Personal dictionary"))
        val entryRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val wordInput = EditText(this).apply {
            hint = "Add a word"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            isSingleLine = true
            background = rounded(card2, 14)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        entryRow.addView(wordInput, LinearLayout.LayoutParams(0, dp(50), 1f))
        entryRow.addView(Button(this).apply {
            text = "Add"
            isAllCaps = false
            setTextColor(Color.BLACK)
            background = rounded(accent, 14)
            setOnClickListener {
                KeyboardPrefs.addPersonalWord(this@MainActivity, wordInput.text.toString(), badge)
                renderDictionary()
            }
        }, LinearLayout.LayoutParams(dp(82), dp(50)).apply { marginStart = dp(8) })
        root.addView(entryRow, marginParams(dp(5)))

        val words = KeyboardPrefs.personalDictionary(this, badge)
        if (words.isEmpty()) {
            root.addView(infoCard("No personal words yet", "Tap your exact typed word in the suggestion strip, or add names, SAP terms and Hinglish words here."))
        } else {
            words.forEach { word ->
                root.addView(removableRow(word, "Valid word") {
                    KeyboardPrefs.removePersonalWord(this, word, badge)
                    renderDictionary()
                })
            }
        }

        root.addView(section("Text shortcuts"))
        root.addView(infoCard("Expand as you type", "Create shortcuts such as @@ for an email address. They are local-first and sync to your Ana account when you are signed in."))
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
            root.addView(infoCard("No shortcuts yet", "Shortcuts are stored locally first and sync with your Ana account when signed in."))
        } else {
            shortcuts.toSortedMap().forEach { (trigger, expansion) ->
                root.addView(removableRow("$trigger  →  $expansion", "Local text shortcut") {
                    KeyboardPrefs.removeTextShortcut(this, trigger, badge)
                    renderDictionary()
                })
            }
        }

        root.addView(section("Learned corrections"))
        val learned = KeyboardPrefs.learnedCorrections(this, badge)
        if (learned.isEmpty()) {
            root.addView(infoCard("No learned corrections yet", "When you choose a correction from Ana's suggestion strip, Ana remembers that correction for this language."))
        } else {
            learned.toSortedMap().forEach { (wrong, correct) ->
                root.addView(removableRow("$wrong  →  $correct", "Learned correction") {
                    KeyboardPrefs.removeLearnedCorrection(this, wrong, badge)
                    renderDictionary()
                })
            }
            root.addView(actionCard("Clear learned corrections") {
                KeyboardPrefs.clearLearnedCorrections(this, badge)
                renderDictionary()
            })
        }
    }

    private fun renderPrivacy() {
        currentScreen = "privacy"
        val root = page("Privacy & Ana")
        root.addView(section("Ana connection"))
        val baseUrl = EditText(this).apply {
            hint = "https://your-ana-domain.com"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            setText(KeyboardPrefs.baseUrl(this@MainActivity))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = rounded(card2, 16)
        }
        root.addView(baseUrl, marginParams(dp(5)))
        root.addView(actionCard("Save Ana address") {
            val value = baseUrl.text.toString().trim()
            if (value.isNotBlank() && !value.startsWith("https://")) {
                Toast.makeText(this, "Use an https:// Ana address.", Toast.LENGTH_SHORT).show()
            } else {
                KeyboardPrefs.setBaseUrl(this, value)
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
            }
        })

        root.addView(section("Privacy"))
        root.addView(switchRow("Privacy Shield", "Before keyboard text goes to Ana AI, locally mask high-confidence emails, phone numbers, IBANs, monetary amounts, references, addresses and person/company names, then restore them after the AI reply.", KeyboardPrefs.privacyShieldEnabled(this)) {
            KeyboardPrefs.setPrivacyShieldEnabled(this, it)
        })
        root.addView(switchRow("Incognito mode", "Local typing stays available, but Ana AI, voice typing, learning and clipboard history are paused.", KeyboardPrefs.incognitoEnabled(this)) {
            KeyboardPrefs.setIncognitoEnabled(this, it)
        })
        root.addView(infoCard("LOCAL means local", "Ordinary keystrokes, local word correction and adaptive touch calibration stay on this device. If you sign in, only your saved words, learned corrections and shortcuts are synced to your Ana account."))
        root.addView(infoCard("ANA AI is visible", "The keyboard status changes from LOCAL to ANA AI whenever text is being sent to your Ana server. When Privacy Shield masks anything, the keyboard explicitly reports that protection in the status line."))
        root.addView(infoCard("Smart paragraph AI is opt-in", "Cloud paragraph checking is off by default. When enabled, choose Review before replacing or Apply automatically under Typing. Ana still runs safety checks before any paragraph replacement."))
        root.addView(infoCard("Per-app AI switch", "Use the AI app button in the keyboard toolbar to disable or enable Ana AI for the current app. Likely banking, wallet and authenticator apps start with Ana AI off unless you explicitly enable it."))
        root.addView(infoCard("Private fields", "Passwords, OTP / verification-code fields and apps that request no personalised learning automatically disable Ana AI, voice, suggestions and clipboard history."))
        root.addView(infoCard("Clipboard stays local", "Clipboard history is stored only on this device. Unpinned clips expire after 1 hour; pinned clips remain until you clear or unpin them. Incognito mode does not add clipboard history."))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_BACKGROUND && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
            }
            KeyboardPrefs.setBackgroundPreset(this, "none")
            KeyboardPrefs.setBackgroundUri(this, uri.toString())
            renderTheme()
        }
    }

    private fun intSliderCard(
        title: String,
        subtitle: String,
        current: Int,
        min: Int,
        max: Int,
        suffix: String,
        onChanged: (Int) -> Unit
    ): View {
        val wrap = cardContainer()
        val titleView = titleText("$title: $current$suffix")
        wrap.addView(titleView)
        wrap.addView(subText(subtitle))
        wrap.addView(SeekBar(this).apply {
            this.max = (max - min).coerceAtLeast(1)
            progress = (current - min).coerceIn(0, this.max)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val value = (min + progress).coerceIn(min, max)
                    onChanged(value)
                    titleView.text = "$title: $value$suffix"
                    activePreview?.refreshFromSettings()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        })
        return wrap
    }

    private fun vibrationStrengthCard(): View {
        val wrap = cardContainer()
        val value = TextView(this).apply {
            text = "Vibration strength: ${KeyboardPrefs.hapticStrengthMs(this@MainActivity)} ms"
            textSize = 17f
            setTextColor(textColor)
        }
        wrap.addView(value)
        wrap.addView(SeekBar(this).apply {
            max = 24
            progress = KeyboardPrefs.hapticStrengthMs(this@MainActivity) - 1
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val ms = progress + 1
                    KeyboardPrefs.setHapticStrengthMs(this@MainActivity, ms)
                    value.text = "Vibration strength: $ms ms"
                    if (KeyboardPrefs.hapticEnabled(this@MainActivity)) previewVibration()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        })
        return wrap
    }

    private fun previewVibration() {
        val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
        vibrator.vibrate(
            VibrationEffect.createOneShot(
                KeyboardPrefs.hapticStrengthMs(this).toLong(),
                VibrationEffect.DEFAULT_AMPLITUDE
            )
        )
    }

    private fun backgroundTintCard(): View {
        val wrap = cardContainer()
        val value = TextView(this).apply {
            text = "Background tint: ${KeyboardPrefs.backgroundTintPercent(this@MainActivity)}%"
            textSize = 17f
            setTextColor(textColor)
        }
        wrap.addView(value)
        wrap.addView(SeekBar(this).apply {
            max = 80
            progress = KeyboardPrefs.backgroundTintPercent(this@MainActivity)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    KeyboardPrefs.setBackgroundTintPercent(this@MainActivity, progress)
                    value.text = "Background tint: $progress%"
                    activePreview?.refreshFromSettings()
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        })
        return wrap
    }

    private fun menuRow(title: String, subtitle: String, onClick: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(11), dp(4), dp(11))
            setOnClickListener { onClick() }
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(title).apply { textSize = 20f })
        copy.addView(subText(subtitle))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply {
            text = "›"
            textSize = 30f
            setTextColor(subColor)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(34), dp(54)))
        return row
    }

    private fun choiceRow(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit): View {
        val wrap = cardContainer().apply { setOnClickListener { onClick() } }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(title))
        copy.addView(subText(subtitle))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply {
            text = if (selected) "✓" else ""
            textSize = 23f
            setTextColor(accent)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(42), dp(42)))
        wrap.addView(row)
        return wrap
    }

    private fun backgroundPresetCard(preset: KeyboardBackgrounds.Preset): View {
        val selected = KeyboardPrefs.backgroundUri(this).isBlank() &&
            KeyboardPrefs.backgroundPreset(this) == preset.id
        val wrap = cardContainer().apply {
            setOnClickListener {
                KeyboardPrefs.setBackgroundUri(this@MainActivity, "")
                KeyboardPrefs.setBackgroundPreset(this@MainActivity, preset.id)
                activePreview?.refreshFromSettings()
                renderTheme()
            }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(BackgroundPresetPreviewView(this, preset.id), LinearLayout.LayoutParams(dp(78), dp(54)).apply {
            marginEnd = dp(12)
        })
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(preset.name))
        copy.addView(subText(preset.detail))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply {
            text = if (selected) "✓" else ""
            textSize = 23f
            setTextColor(accent)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(42), dp(42)))
        wrap.addView(row)
        return wrap
    }
    private fun switchRow(title: String, subtitle: String, checked: Boolean, onChanged: (Boolean) -> Unit): View {
        val wrap = cardContainer()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(title))
        copy.addView(subText(subtitle))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(Switch(this).apply {
            isChecked = checked
            setOnCheckedChangeListener { _, value ->
                onChanged(value)
                activePreview?.refreshFromSettings()
            }
        })
        wrap.addView(row)
        return wrap
    }

    private fun removableRow(title: String, subtitle: String, onRemove: () -> Unit): View {
        val wrap = cardContainer()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(title))
        copy.addView(subText(subtitle))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(Button(this).apply {
            text = "Remove"
            isAllCaps = false
            textSize = 12f
            setTextColor(textColor)
            background = rounded(card2, 12)
            setOnClickListener { onRemove() }
        }, LinearLayout.LayoutParams(dp(88), dp(42)))
        wrap.addView(row)
        return wrap
    }

    private fun infoCard(title: String, subtitle: String): View = cardContainer().apply {
        addView(titleText(title))
        addView(subText(subtitle))
    }

    private fun actionCard(label: String, onClick: () -> Unit): View = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        setTextColor(textColor)
        background = rounded(card, 18)
        setOnClickListener { onClick() }
        layoutParams = marginParams(dp(5)).apply { height = dp(56) }
    }

    private fun cardContainer(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = rounded(card, 18)
        layoutParams = marginParams(dp(4))
        minimumHeight = dp(66)
        gravity = Gravity.CENTER_VERTICAL
    }

    private fun titleText(value: String) = TextView(this).apply {
        text = value
        textSize = 17f
        setTextColor(textColor)
    }

    private fun subText(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(subColor)
        setPadding(0, dp(3), 0, 0)
    }

    private fun summary(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(subColor)
        setPadding(dp(4), 0, dp(4), dp(12))
    }

    private fun section(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(accent)
        setPadding(dp(6), dp(18), dp(6), dp(8))
    }

    private fun rounded(color: Int, radiusDp: Int) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(radiusDp).toFloat()
        setColor(color)
    }

    private fun marginParams(vertical: Int) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        topMargin = vertical
        bottomMargin = vertical
    }

    private fun themeSummary(): String {
        val base = when (KeyboardPrefs.theme(this)) {
            "light" -> "Light"
            "midnight" -> "Midnight"
            "gold" -> "Ana Gold"
            else -> "Default dark"
        }
        val background = when {
            KeyboardPrefs.backgroundUri(this).isNotBlank() -> "gallery photo"
            KeyboardPrefs.backgroundPreset(this) != "none" -> KeyboardBackgrounds.nameFor(KeyboardPrefs.backgroundPreset(this))
            else -> "no background"
        }
        return "$base • $background • ${KeyboardPrefs.keyPressAnimation(this)} press"
    }
    private class SimpleTextWatcher(private val onChanged: (String) -> Unit) : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = onChanged(s?.toString().orEmpty())
        override fun afterTextChanged(s: android.text.Editable?) = Unit
    }

    companion object {
        private const val REQUEST_BACKGROUND = 44
    }
}
