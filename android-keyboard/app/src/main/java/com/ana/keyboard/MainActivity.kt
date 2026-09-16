package com.ana.keyboard

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
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
    private val bg = Color.rgb(52, 52, 54)
    private val card = Color.rgb(31, 31, 33)
    private val card2 = Color.rgb(42, 42, 45)
    private val textColor = Color.WHITE
    private val subColor = Color.rgb(190, 190, 195)
    private val accent = Color.rgb(230, 181, 65)
    private var currentScreen = "home"

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderHome()
    }

    override fun onBackPressed() {
        if (currentScreen != "home") renderHome() else super.onBackPressed()
    }

    private fun page(title: String): LinearLayout {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(22), dp(18), dp(34))
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
                setPadding(0, 0, dp(16), 0)
                setOnClickListener { renderHome() }
            }, LinearLayout.LayoutParams(dp(52), dp(58)))
        }
        top.addView(TextView(this).apply {
            text = title
            textSize = if (currentScreen == "home") 30f else 28f
            setTextColor(textColor)
            setTypeface(typeface, Typeface.NORMAL)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(64), 1f))
        root.addView(top)
        setContentView(scroll)
        return root
    }

    private fun renderHome() {
        currentScreen = "home"
        val root = page("Ana Keyboard settings")
        root.addView(summary("A full everyday keyboard with Ana available when you ask for it."))

        root.addView(section("Keyboard"))
        root.addView(navRow("Languages", "English (QWERTY) • Deutsch (QWERTZ) • Hindi (Hinglish)") { renderLanguages() })
        root.addView(navRow("Preferences", "Keys, layout, sound, vibration and key pop-up") { renderPreferences() })
        root.addView(navRow("Theme", themeSummary()) { renderTheme() })

        root.addView(section("Typing"))
        root.addView(navRow("Corrections and suggestions", "Local spell-check suggestions and auto-correction") { renderCorrections() })
        root.addView(navRow("Glide typing", "Planned — not active yet") { renderComingSoon("Glide typing", listOf("Glide from letter to letter", "Glide trail", "Glide delete", "Space-bar cursor control")) })
        root.addView(navRow("Voice typing", "Planned — not active yet") { renderComingSoon("Voice typing", listOf("Tap-to-dictate", "Multilingual dictation", "Private voice controls")) })
        root.addView(navRow("Emojis, stickers and GIFs", "Emoji panel active • GIF search planned") { renderEmojiSettings() })
        root.addView(navRow("Clipboard", "Paste current and recent local clipboard items") { renderClipboardSettings() })

        root.addView(section("Ana"))
        root.addView(navRow("Ana & privacy", "Server address, AI actions and password protection") { renderAna() })

        root.addView(section("Setup"))
        root.addView(actionCard("Enable Ana Keyboard") { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) })
        root.addView(actionCard("Choose Ana Keyboard") {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        })
    }

    private fun renderLanguages() {
        currentScreen = "languages"
        val root = page("Languages")
        root.addView(summary("Choose the typing layout. You can also switch language from the Ana toolbar while typing."))
        root.addView(section("Typing languages"))
        KeyboardPrefs.inputLanguages.forEach { (name, badge) ->
            val layout = when (badge) {
                "DE" -> "QWERTZ • German layout"
                "HIN" -> "QWERTY • Roman Hindi / Hinglish"
                else -> "QWERTY • English"
            }
            root.addView(choiceRow("$name  ·  $badge", layout, KeyboardPrefs.inputLanguage(this) == name) {
                KeyboardPrefs.setInputLanguage(this, name)
                renderLanguages()
            })
        }
        root.addView(section("Translation target"))
        root.addView(infoCard("Ana Translate target", "The Translate button has its own target language. Tap the → language chip in the keyboard toolbar to change it."))
    }

    private fun renderPreferences() {
        currentScreen = "preferences"
        val root = page("Preferences")

        root.addView(section("Keys"))
        root.addView(switchRow("Number row", "Always show 1–0 above letters", KeyboardPrefs.numberRowEnabled(this)) { KeyboardPrefs.setNumberRowEnabled(this, it) })
        root.addView(switchRow("Comma key", "Show comma on the main keyboard", KeyboardPrefs.commaKeyEnabled(this)) { KeyboardPrefs.setCommaKeyEnabled(this, it) })
        root.addView(switchRow("Full stop key", "Show full stop on the main keyboard", KeyboardPrefs.fullStopKeyEnabled(this)) { KeyboardPrefs.setFullStopKeyEnabled(this, it) })
        root.addView(infoCard("Switch keyboards", "The globe key was removed from Ana. Use Android's keyboard switcher when you want to move to Gboard or another installed keyboard."))

        root.addView(section("Key tap"))
        root.addView(switchRow("Sound", "Play a click when tapping keys", KeyboardPrefs.soundEnabled(this)) { KeyboardPrefs.setSoundEnabled(this, it) })
        root.addView(switchRow("Keyboard vibration", "Vibrate on keypress", KeyboardPrefs.hapticEnabled(this)) { KeyboardPrefs.setHapticEnabled(this, it) })
        root.addView(vibrationStrengthCard())
        root.addView(switchRow("Key pop-up", "Show the enlarged key indicator while pressing", KeyboardPrefs.keyPopupEnabled(this)) { KeyboardPrefs.setKeyPopupEnabled(this, it) })

        root.addView(section("Shortcuts"))
        root.addView(switchRow("Double-space full stop", "Double-tap space to add a period followed by a space", KeyboardPrefs.doubleSpacePeriodEnabled(this)) { KeyboardPrefs.setDoubleSpacePeriodEnabled(this, it) })
        root.addView(switchRow("Auto-space after punctuation", "Add a space after common punctuation where appropriate", KeyboardPrefs.autoSpaceAfterPunctuation(this)) { KeyboardPrefs.setAutoSpaceAfterPunctuation(this, it) })
    }

    private fun renderTheme() {
        currentScreen = "theme"
        val root = page("Theme")
        root.addView(section("Ana themes"))
        listOf(
            Triple("Default dark", "dark", "Dark keys and neutral background"),
            Triple("Midnight", "midnight", "Deeper black keyboard"),
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
        root.addView(infoCard("Background image", if (current.isBlank()) "No custom image selected" else "Custom photo selected — applied behind the keys"))
        root.addView(actionCard(if (current.isBlank()) "Choose background image" else "Change background image") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            startActivityForResult(intent, REQUEST_BACKGROUND)
        })
        root.addView(backgroundTintCard())
        if (current.isNotBlank()) {
            root.addView(actionCard("Remove background image") {
                KeyboardPrefs.setBackgroundUri(this, "")
                renderTheme()
            })
        }
        root.addView(infoCard("Privacy", "Your selected background image stays on this device. It is not uploaded to Ana."))
    }

    private fun renderCorrections() {
        currentScreen = "corrections"
        val root = page("Corrections and suggestions")
        root.addView(section("Automatic corrections"))
        root.addView(switchRow("Auto-correction", "Correct likely misspellings when you press space", KeyboardPrefs.autoCorrectionEnabled(this)) { KeyboardPrefs.setAutoCorrectionEnabled(this, it) })
        root.addView(switchRow("Auto-capitalisation", "Capitalise sentence starts while using the keyboard", KeyboardPrefs.autoCapitalisationEnabled(this)) { KeyboardPrefs.setAutoCapitalisationEnabled(this, it) })
        root.addView(switchRow("Double-space full stop", "Period + space after double-tapping space", KeyboardPrefs.doubleSpacePeriodEnabled(this)) { KeyboardPrefs.setDoubleSpacePeriodEnabled(this, it) })

        root.addView(section("Suggestion strip"))
        root.addView(switchRow("Word suggestions", "Use Android's on-device spell checker for correction suggestions", KeyboardPrefs.wordSuggestionsEnabled(this)) { KeyboardPrefs.setWordSuggestionsEnabled(this, it) })
        root.addView(switchRow("Ana toolbar", "Show language, Translate, Fix, Tone and Shorter above the keys", KeyboardPrefs.toolbarEnabled(this)) { KeyboardPrefs.setToolbarEnabled(this, it) })
        root.addView(infoCard("Languages", "English and German use the phone's installed spelling dictionaries. Hinglish currently falls back to the device's English (India) dictionary, so suggestions are more limited."))
        root.addView(disabledRow("Next-word suggestions", "Planned — this is different from spelling correction and needs a proper prediction model"))
        root.addView(disabledRow("Smart replies", "Planned — not active yet"))
    }

    private fun renderEmojiSettings() {
        currentScreen = "emoji"
        val root = page("Emojis, stickers and GIFs")
        root.addView(section("Emoji"))
        root.addView(infoCard("Emoji panel", "Tap 😊 on the keyboard to open the emoji panel. Emoji insertion works locally."))
        root.addView(section("GIFs"))
        root.addView(disabledRow("GIF search", "The GIF button is prepared, but online search needs a GIF provider/API before it can be enabled safely."))
    }

    private fun renderClipboardSettings() {
        currentScreen = "clipboard"
        val root = page("Clipboard")
        root.addView(section("Clipboard access"))
        root.addView(infoCard("Tap 📋 on the keyboard", "Ana reads the system clipboard only when you open the clipboard panel. It does not monitor your clipboard in the background."))
        root.addView(infoCard("Recent clips", "Up to 10 recent text clips are stored locally on this device for quick pasting. Clipboard access is blocked in password fields."))
        root.addView(actionCard("Clear local clipboard history") {
            KeyboardPrefs.clearClipboardHistory(this)
            Toast.makeText(this, "Clipboard history cleared", Toast.LENGTH_SHORT).show()
        })
    }

    private fun renderAna() {
        currentScreen = "ana"
        val root = page("Ana & privacy")
        root.addView(section("Connection"))
        val baseUrl = EditText(this).apply {
            hint = "https://your-ana-domain.com"
            setHintTextColor(Color.GRAY)
            setTextColor(textColor)
            setText(KeyboardPrefs.baseUrl(this@MainActivity))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = rounded(card2, 18)
        }
        root.addView(baseUrl, marginParams(dp(6)))
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
        root.addView(infoCard("Normal typing stays local", "Ana does not send ordinary keystrokes to the server."))
        root.addView(infoCard("Local spelling suggestions", "Word correction uses Android's on-device spell-check service, not the Ana cloud API."))
        root.addView(infoCard("AI only on tap", "Text is sent only when you explicitly tap Translate, Fix, Tone or Shorter."))
        root.addView(infoCard("Password protection", "Ana AI, suggestions and clipboard access are disabled in password fields."))
    }

    private fun renderComingSoon(title: String, items: List<String>) {
        currentScreen = "coming"
        val root = page(title)
        root.addView(summary("This belongs in Ana Keyboard, but it is not active yet. I would rather show that clearly than pretend the feature works."))
        root.addView(section("Planned"))
        items.forEach { root.addView(disabledRow(it, "Coming later")) }
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
            text = "Vibration strength on keypress: ${KeyboardPrefs.hapticStrengthMs(this@MainActivity)} ms"
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
                    value.text = "Vibration strength on keypress: $ms ms"
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        })
        return wrap
    }

    private fun backgroundTintCard(): View {
        val wrap = cardContainer()
        val value = TextView(this).apply {
            text = "Background tint: ${KeyboardPrefs.backgroundTintPercent(this@MainActivity)}%"
            textSize = 17f
            setTextColor(textColor)
        }
        wrap.addView(value)
        wrap.addView(subText("0% keeps the photo bright. Higher values darken it so the keys stay readable."))
        wrap.addView(SeekBar(this).apply {
            max = 80
            progress = KeyboardPrefs.backgroundTintPercent(this@MainActivity)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    KeyboardPrefs.setBackgroundTintPercent(this@MainActivity, progress)
                    value.text = "Background tint: $progress%"
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        })
        return wrap
    }

    private fun navRow(title: String, subtitle: String, onClick: () -> Unit): View {
        val wrap = cardContainer().apply { setOnClickListener { onClick() } }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleText(title))
        copy.addView(subText(subtitle))
        row.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply { text = "›"; textSize = 32f; setTextColor(subColor); gravity = Gravity.CENTER })
        wrap.addView(row)
        return wrap
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
            textSize = 24f
            setTextColor(accent)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
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
            setOnCheckedChangeListener { _, value -> onChanged(value) }
        })
        wrap.addView(row)
        return wrap
    }

    private fun disabledRow(title: String, subtitle: String): View = cardContainer().apply {
        alpha = 0.58f
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            addView(titleText(title))
            addView(subText(subtitle))
        })
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
        background = rounded(card, 20)
        setOnClickListener { onClick() }
        layoutParams = marginParams(dp(6)).apply { height = dp(58) }
    }

    private fun cardContainer(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(16), dp(18), dp(16))
        background = rounded(card, 22)
        layoutParams = marginParams(dp(4))
        minimumHeight = dp(72)
        gravity = Gravity.CENTER_VERTICAL
    }

    private fun titleText(value: String) = TextView(this).apply {
        text = value
        textSize = 18f
        setTextColor(textColor)
    }

    private fun subText(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(subColor)
        setPadding(0, dp(4), 0, 0)
    }

    private fun summary(value: String) = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(subColor)
        setPadding(dp(4), 0, dp(4), dp(12))
    }

    private fun section(value: String) = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(accent)
        setPadding(dp(8), dp(22), dp(8), dp(10))
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
        val tint = KeyboardPrefs.backgroundTintPercent(this)
        return if (KeyboardPrefs.backgroundUri(this).isBlank()) base else "$base • Custom photo • $tint% tint"
    }

    companion object {
        private const val REQUEST_BACKGROUND = 44
    }
}
