# Vak

Standalone AI translation app extracted from Saarthi's translation experience.

## v1
- Auto-detect source language
- German, English, Hindi, French, Spanish and Italian targets
- German Sie / du control
- GPT-5.6 Luna through a Vercel serverless endpoint
- Click translated words for contextual alternatives
- Replace a word without retranslating the whole text
- Save preferred terminology in a browser-local personal glossary
- Copy translated output

## Vercel setup
Add `OPENAI_API_KEY` to the Production/Preview environment variables.

Build command: `npm run build`
Output directory: `dist`
