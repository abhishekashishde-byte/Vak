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

        root.addView(menuRow("Languages", "Typing languages and Translate-to language") { renderLanguages() })
        root.addView(menuRow("Themes", themeSummary()) { renderTheme() })
        root.addView(menuRow("Typing", "Auto-correction, smart sentence correction and suggestions") { renderTyping() })
        root.addView(menuRow("Rich input", "Voice typing, clipboard and Writing Tool") { renderRichInput() })
        root.addView(menuRow("Layout & keys", "Keyboard size, number row, punctuation and toolbar") { renderLayoutKeys() })
        root.addView(menuRow("Sound & vibration", "Key click and vibration strength") { renderSoundVibration() })
        root.addView(menuRow("Dictionary & corrections", "Personal words and learned corrections") { renderDictionary() })
        root.addView(menuRow("Privacy & Ana", "Ana connection and local typing protection") { renderPrivacy() })

        root.addView(section("Setup"))
        root.addView(actionCard("Enable Ana Keyboard") { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) })
        root.addView(actionCard("Choose Ana Keyboard") {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        })
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

        root.addView(section("Custom background"))
        val current = KeyboardPrefs.backgroundUri(this)
        root.addView(actionCard(if (current.isBlank()) "Choose background image" else "Change background image") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            startActivityForResult(intent, REQUEST_BACKGROUND)
        })
        if (current.isNotBlank()) {
            root.addView(backgroundTintCard())
            root.addView(actionCard("Remove background image") {
                KeyboardPrefs.setBackgroundUri(this, "")
                renderTheme()
            })
        }
        root.addView(infoCard("Photo privacy", "The selected background stays on this device."))
    }

    private fun renderTyping() {
        currentScreen = "typing"
        val root = page("Typing")
        root.addView(section("Corrections"))
        root.addView(switchRow("Auto-correction", "Correct confident spelling mistakes when you press Space", KeyboardPrefs.autoCorrectionEnabled(this)) {
            KeyboardPrefs.setAutoCorrectionEnabled(this, it)
        })
        root.addView(switchRow("Smart sentence correction", "Automatically check the current sentence after you pause. Fixes grammar, completeness and contextual typing mistakes. The sentence is sent to your Ana server; normal word correction stays local.", KeyboardPrefs.smartSentenceCorrectionEnabled(this)) {
            KeyboardPrefs.setSmartSentenceCorrectionEnabled(this, it)
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
        root.addView(actionCard("Microphone permission") {
            startActivity(Intent(this, MicrophonePermissionActivity::class.java))
        })

        root.addView(section("Clipboard"))
        root.addView(infoCard("Recent clips", "Ana stores up to 10 recent text clips locally when you open its clipboard panel."))
        root.addView(actionCard("Clear Ana clipboard history") {
            KeyboardPrefs.clearClipboardHistory(this)
            Toast.makeText(this, "Clipboard history cleared", Toast.LENGTH_SHORT).show()
        })

        root.addView(section("Writing Tool"))
        root.addView(infoCard("Write", "Type or dictate what you want to say, then tap Write. Ana drafts the finished message in the currently selected Translate-to language."))
    }

    private fun renderLayoutKeys() {
        currentScreen = "layout"
        val root = page("Layout & keys")

        root.addView(section("Keyboard size"))
        KeyboardSizing.options.forEach { size ->
            val detail = when (size) {
                "Small" -> "More screen space"
                "Large" -> "Larger keys and taller keyboard"
                else -> "Balanced default size"
            }
            root.addView(choiceRow(size, detail, KeyboardSizing.size(this) == size) {
                KeyboardSizing.setSize(this, size)
                renderLayoutKeys()
            })
        }

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
        root.addView(infoCard("Normal typing stays local", "Ordinary keystrokes, local correction and glide decoding are not sent to Ana."))
        root.addView(infoCard("AI only on explicit action", "Text is sent only when you tap Write or Translate."))
        root.addView(infoCard("Password fields", "Ana AI, voice, suggestions and clipboard are disabled in password fields."))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_BACKGROUND && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
            }
            KeyboardPrefs.setBackgroundUri(this, uri.toString())
            renderTheme()
        }
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
        return if (KeyboardPrefs.backgroundUri(this).isBlank()) base else "$base • custom photo • ${KeyboardPrefs.backgroundTintPercent(this)}% tint"
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
