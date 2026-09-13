import { applyPlatformCors, audioExtension, publicRequestId, requirePlatformKey } from '../_platform.js'

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } }

export default async function handler(req, res) {
  if (applyPlatformCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requirePlatformKey(req, res)) return
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Transcription service is not configured.' })

  const audio = String(req.body?.audio || '')
  const mimeType = String(req.body?.mimeType || 'audio/webm').slice(0, 100)
  const languageHint = String(req.body?.language || '').trim().slice(0, 40)
  if (!audio) return res.status(400).json({ error: 'Missing base64 audio.' })

  let bytes
  try { bytes = Buffer.from(audio, 'base64') } catch { return res.status(400).json({ error: 'Audio must be base64 encoded.' }) }
  if (!bytes.length) return res.status(400).json({ error: 'Audio is empty.' })
  if (bytes.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Audio segment is too large. Send smaller chunks up to 8 MB.' })

  const requestId = publicRequestId('stt')
  try {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mimeType }), `ana-audio.${audioExtension(mimeType)}`)
    form.append('model', 'gpt-transcribe')
    form.append('response_format', 'json')
    if (languageHint) form.append('language', languageHint)
    form.append('prompt', 'Transcribe exactly what is spoken. Preserve names, numbers, multilingual speech and code-switching. Do not translate or summarize.')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': 'ana-platform-transcribe',
      },
      body: form,
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Transcription failed.', request_id: requestId })

    const text = String(data?.text || '').trim()
    if (!text) return res.status(200).json({ request_id: requestId, text: '', speech_detected: false })
    return res.status(200).json({ request_id: requestId, text, speech_detected: true })
  } catch (error) {
    console.error('[platform/transcribe]', requestId, error?.message || error)
    return res.status(500).json({ error: 'Transcription failed.', request_id: requestId })
  }
}
