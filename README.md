# Vak

Standalone AI translation app extracted from Saarthi's translation experience.

## v1
- Google authentication with Supabase
- Auto-detect source language
- German, English, Hindi, French, Spanish and Italian targets
- German Sie / du control
- GPT-5.6 Luna through a Vercel serverless endpoint
- Click translated words for contextual alternatives
- Replace a word without retranslating the whole text
- Save preferred terminology in a browser-local personal glossary
- Copy translated output

## Vercel environment variables
- `OPENAI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Google OAuth
Enable Google in Supabase Authentication > Providers and add the Vak production URL to the allowed redirect URLs.

Build command: `npm run build`
Output directory: `dist`
