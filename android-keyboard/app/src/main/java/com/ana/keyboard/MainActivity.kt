package com.ana.keyboard

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Space
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
            setBackgroundColor(Color.rgb(248, 248, 248))
        }

        root.addView(TextView(this).apply {
            text = "Ana Keyboard"
            textSize = 28f
            setTextColor(Color.rgb(20, 20, 20))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })

        root.addView(TextView(this).apply {
            text = "A normal everyday keyboard with Ana available only when you ask for it."
            textSize = 16f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(8), 0, dp(20))
        })

        root.addView(label("Ana web app address"))
        val baseUrl = EditText(this).apply {
            hint = "https://your-ana-domain.com"
            setText(KeyboardPrefs.baseUrl(this@MainActivity))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        root.addView(baseUrl, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val haptic = Switch(this).apply {
            text = "Key vibration"
            isChecked = KeyboardPrefs.hapticEnabled(this@MainActivity)
            setPadding(0, dp(14), 0, 0)
        }
        val sound = Switch(this).apply {
            text = "Key click sound"
            isChecked = KeyboardPrefs.soundEnabled(this@MainActivity)
        }
        root.addView(haptic)
        root.addView(sound)

        val save = Button(this).apply {
            text = "Save settings"
            isAllCaps = false
            setOnClickListener {
                val value = baseUrl.text.toString().trim()
                if (value.isNotBlank() && !value.startsWith("https://")) {
                    Toast.makeText(this@MainActivity, "Use an https:// Ana address.", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                KeyboardPrefs.setBaseUrl(this@MainActivity, value)
                KeyboardPrefs.setHapticEnabled(this@MainActivity, haptic.isChecked)
                KeyboardPrefs.setSoundEnabled(this@MainActivity, sound.isChecked)
                Toast.makeText(this@MainActivity, "Saved", Toast.LENGTH_SHORT).show()
            }
        }
        root.addView(save, withTopMargin(dp(16)))

        root.addView(Space(this), LinearLayout.LayoutParams(1, dp(18)))

        val enable = Button(this).apply {
            text = "1. Enable Ana Keyboard"
            isAllCaps = false
            setOnClickListener { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) }
        }
        root.addView(enable, withTopMargin(0))

        val choose = Button(this).apply {
            text = "2. Choose Ana Keyboard"
            isAllCaps = false
            setOnClickListener {
                (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
            }
        }
        root.addView(choose, withTopMargin(dp(8)))

        root.addView(TextView(this).apply {
            text = "Privacy: Ana AI buttons never read password fields. Outside password fields, text is sent to Ana only when you explicitly tap Translate, Fix, Tone or Shorter. Normal typing stays local on the device."
            textSize = 13f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(18), 0, 0)
        })

        setContentView(root)
    }

    private fun label(textValue: String) = TextView(this).apply {
        text = textValue
        textSize = 14f
        setTextColor(Color.DKGRAY)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun withTopMargin(margin: Int) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        topMargin = margin
        gravity = Gravity.CENTER_HORIZONTAL
    }
}
