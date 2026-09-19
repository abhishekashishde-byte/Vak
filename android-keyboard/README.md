# Ana Keyboard (Android MVP)

Native Android IME companion for Ana.

## Current MVP

- Everyday QWERTY typing
- Press highlight on every key
- Optional haptic vibration
- Optional key-click sound
- Shift + double-tap caps lock
- Numbers/symbols layout
- Hold backspace to repeat delete
- Globe key to switch to the next installed keyboard
- Ana toolbar: Translate, Fix, Tone, Shorter
- Translation target cycling: German, English, Hindi, Hinglish
- Ana actions are disabled in password fields
- Normal typing is local; text is sent to Ana only after an explicit Ana action tap
- Safe replacement guard: if the user changes the draft while Ana is working, Ana does not overwrite it

## Install for testing

The GitHub Actions workflow builds a debug APK artifact named `ana-keyboard-debug`.

1. Download the workflow artifact and unzip it.
2. Install `app-debug.apk` on an Android device.
3. Open **Ana Keyboard**.
4. Enter the HTTPS address of the deployed Ana web app and save.
5. Keep vibration/sound enabled or adjust them.
6. Tap **Enable Ana Keyboard** and enable it in Android settings.
7. Tap **Choose Ana Keyboard** and select Ana Keyboard.
8. Open WhatsApp, Messages, Gmail, Teams, etc. and type normally.

For Ana actions, type or select text and tap Translate/Fix/Tone/Shorter. If nothing is selected, Ana operates on the current line before the cursor.

## Deliberately not in v0.1

This is a typing-quality MVP, not a full Gboard replacement yet. It does not yet include predictive suggestions, autocorrect dictionaries, swipe typing, emoji search, voice typing, multilingual layouts, clipboard history, or personal typing-model learning.


## v0.12 typing engine
Ana v0.12 adds spatial no-drop tap decoding, ordered multi-touch input, composing text, hot-path performance isolation, adaptive touch learning, and restore-safe learned corrections.
