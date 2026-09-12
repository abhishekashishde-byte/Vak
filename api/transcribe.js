function extensionFor(mime = '') {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { audio, mimeType = 'audio/webm' } = req.body || {}
  if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Missing audio' })

  try {
    const bytes = Buffer.from(audio, 'base64')
    if (!bytes.length) return res.status(400).json({ error: 'Empty audio' })
    if (bytes.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Voice note is too long. Please keep it under about one minute.' })

    const form = new FormData()
    const ext = extensionFor(mimeType)
    form.append('file', new Blob([bytes], { type: mimeType }), `ana-briefing.${ext}`)
    form.append('model', 'gpt-transcribe')
    form.append('response_format', 'json')
    form.append('prompt', 'Transcribe exactly what the user says. Preserve multilingual speech and code-switching, including Hindi written/spoken with English words, German, English and names. Do not translate or summarize.')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    })

    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Transcription failed' })

    const text = String(data?.text || '').trim()
    if (!text) return res.status(502).json({ error: 'No speech was detected' })
    return res.status(200).json({ text })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Transcription failed' })
  }
}
