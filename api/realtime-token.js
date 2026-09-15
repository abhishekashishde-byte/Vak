const ALLOWED_TRANSLATION_LANGUAGES = new Set([
  'de', 'en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'pa', 'ml', 'kn', 'ur', 'fr', 'es', 'it',
])

async function createTranslationToken(req, res, apiKey) {
  const requested = String(req.body?.targetLanguage || 'en').trim().toLowerCase()
  const targetLanguage = ALLOWED_TRANSLATION_LANGUAGES.has(requested) ? requested : 'en'

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            output: { language: targetLanguage },
          },
        },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Could not create live translation session',
      })
    }

    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not create live translation session' })
  }
}

async function createVoiceToken(req, res, apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'ana-realtime-web',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          audio: {
            output: { voice: 'marin' },
            input: {
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'high',
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Could not create a realtime voice session.',
      })
    }

    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not create a realtime voice session.' })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' })

  const mode = Array.isArray(req.query?.mode) ? req.query.mode[0] : req.query?.mode
  if (mode === 'translation') return createTranslationToken(req, res, apiKey)
  return createVoiceToken(req, res, apiKey)
}
