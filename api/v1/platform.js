import {
  applyPlatformCors,
  audioExtension,
  collectResponseText,
  publicRequestId,
  requirePlatformKey,
} from '../../server/platform.js'

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } }

const clean = (value, max) => String(value || '').trim().slice(0, max)

async function translate(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Translation service is not configured.' })
  }

  const text = clean(req.body?.text, 24000)
  const target = clean(req.body?.target, 80)
  const source = clean(req.body?.source, 80) || 'auto-detect'
  const context = clean(req.body?.context, 1200)

  if (!text) return res.status(400).json({ error: 'Missing text.' })
  if (!target) return res.status(400).json({ error: 'Missing target language.' })

  const requestId = publicRequestId('tr')
  const instructions = [
    'You are Ana, a professional meaning-first translation engine used inside another software product.',
    `Translate from ${source} into ${target}.`,
    'Return only the translation. Do not explain it and do not wrap it in quotes.',
    'Preserve names, reference numbers, dates, amounts, units, formatting and intentional line breaks exactly where meaning allows.',
    'Preserve the speaker’s intent, tone and level of formality rather than translating mechanically word for word.',
    'Handle multilingual code-switching naturally. Do not translate a proper name merely because it resembles a common word.',
    context ? `Context for disambiguation only: ${context}` : '',
  ].filter(Boolean).join('\n')

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'ana-platform-translate',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        reasoning: { effort: 'low' },
        instructions,
        input: text,
        max_output_tokens: 6000,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Translation failed.',
        request_id: requestId,
      })
    }

    const translation = collectResponseText(data)
    if (!translation) {
      return res.status(502).json({
        error: 'Translation returned no text.',
        request_id: requestId,
      })
    }

    return res.status(200).json({ request_id: requestId, source, target, translation })
  } catch (error) {
    console.error('[platform/translate]', requestId, error?.message || error)
    return res.status(500).json({ error: 'Translation failed.', request_id: requestId })
  }
}

async function transcribe(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Transcription service is not configured.' })
  }

  const audio = String(req.body?.audio || '')
  const mimeType = String(req.body?.mimeType || 'audio/webm').slice(0, 100)
  const languageHint = String(req.body?.language || '').trim().slice(0, 40)
  if (!audio) return res.status(400).json({ error: 'Missing base64 audio.' })

  let bytes
  try {
    bytes = Buffer.from(audio, 'base64')
  } catch {
    return res.status(400).json({ error: 'Audio must be base64 encoded.' })
  }

  if (!bytes.length) return res.status(400).json({ error: 'Audio is empty.' })
  if (bytes.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Audio segment is too large. Send smaller chunks up to 8 MB.' })
  }

  const requestId = publicRequestId('stt')
  try {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mimeType }), `ana-audio.${audioExtension(mimeType)}`)
    form.append('model', 'gpt-transcribe')
    form.append('response_format', 'json')
    if (languageHint) form.append('language', languageHint)
    form.append(
      'prompt',
      'Transcribe exactly what is spoken. Preserve names, numbers, multilingual speech and code-switching. Do not translate or summarize.'
    )

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': 'ana-platform-transcribe',
      },
      body: form,
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Transcription failed.',
        request_id: requestId,
      })
    }

    const text = String(data?.text || '').trim()
    if (!text) return res.status(200).json({ request_id: requestId, text: '', speech_detected: false })
    return res.status(200).json({ request_id: requestId, text, speech_detected: true })
  } catch (error) {
    console.error('[platform/transcribe]', requestId, error?.message || error)
    return res.status(500).json({ error: 'Transcription failed.', request_id: requestId })
  }
}

export default async function handler(req, res) {
  if (applyPlatformCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requirePlatformKey(req, res)) return

  const operation = String(req.query?.op || '').trim().toLowerCase()
  if (operation === 'translate') return translate(req, res)
  if (operation === 'transcribe') return transcribe(req, res)
  return res.status(404).json({ error: 'Unknown Ana Platform operation.' })
}
