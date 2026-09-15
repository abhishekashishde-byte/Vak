const TRANSCRIPTION_LANGUAGES = new Set(['en', 'de', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'pa', 'ml', 'kn', 'ur', 'fr', 'es', 'it'])

const cleanKeywords = input => {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const values = []
  for (const item of input) {
    const value = String(item || '')
      .replace(/[<>\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    if (!value) continue
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    values.push(value)
    if (values.length >= 40) break
  }
  return values
}

const cleanLanguages = input => {
  const values = Array.isArray(input) ? input : []
  const result = [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(value => TRANSCRIPTION_LANGUAGES.has(value)))]
  return result.length ? result.slice(0, 6) : ['en', 'de', 'hi']
}

function transcriptionSession(body = {}) {
  const keywords = cleanKeywords(body.keywords)
  const languages = cleanLanguages(body.languages)
  const context = String(body.context || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200)

  const prompt = [
    'Transcribe the meeting faithfully. Do not translate or summarize.',
    'The speakers may code-switch naturally between English, German, Hindi and Hinglish. Preserve what was actually said.',
    'Be especially careful with names, acronyms, SAP terminology, material and inspection terminology, numbers and transaction codes.',
    context,
  ].filter(Boolean).join(' ')

  return {
    type: 'transcription',
    audio: {
      input: {
        transcription: {
          model: 'gpt-live-transcribe',
          prompt,
          ...(keywords.length ? { keywords } : {}),
          ...(languages.length ? { languages } : {}),
          delay: 'low',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
        },
      },
    },
  }
}

function voiceSession() {
  return {
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
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' })

  const mode = String(req.body?.mode || '').trim().toLowerCase()
  const session = mode === 'transcription' ? transcriptionSession(req.body) : voiceSession()

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'ana-realtime-web',
      },
      body: JSON.stringify({ session }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || (mode === 'transcription' ? 'Could not create a live transcription session.' : 'Could not create a realtime voice session.'),
      })
    }

    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not create a realtime session.' })
  }
}
