function extensionFor(mime = '') {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

const MAX_VOICE_BYTES = 4 * 1024 * 1024
const MAX_MEETING_BYTES = 24 * 1024 * 1024

function safeMeetingAudioUrl(value = '') {
  try {
    const url = new URL(String(value))
    const configured = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
    if (!configured) return null
    const supabaseUrl = new URL(configured)
    if (url.protocol !== 'https:' || url.host !== supabaseUrl.host) return null
    if (!url.pathname.startsWith('/storage/v1/object/sign/ana-meeting-audio/')) return null
    return url.toString()
  } catch {
    return null
  }
}

function cleanContext(value = '') {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800)
}

async function meetingBytes(audioUrl, fallbackMime = '') {
  const safeUrl = safeMeetingAudioUrl(audioUrl)
  if (!safeUrl) throw Object.assign(new Error('Invalid meeting audio URL'), { status: 400 })

  const response = await fetch(safeUrl, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw Object.assign(new Error('Could not read the temporary meeting recording'), { status: 502 })

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_MEETING_BYTES) throw Object.assign(new Error('Meeting recording is too large for one final transcription pass.'), { status: 413 })

  const arrayBuffer = await response.arrayBuffer()
  const bytes = Buffer.from(arrayBuffer)
  if (!bytes.length) throw Object.assign(new Error('Empty meeting recording'), { status: 400 })
  if (bytes.length > MAX_MEETING_BYTES) throw Object.assign(new Error('Meeting recording is too large for one final transcription pass.'), { status: 413 })

  const mimeType = String(response.headers.get('content-type') || fallbackMime || 'audio/webm').split(';')[0]
  return { bytes, mimeType }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { audio, audioUrl, mimeType = 'audio/webm', meeting = false, contextHints = '' } = req.body || {}
  const isMeeting = Boolean(meeting || audioUrl)

  try {
    let bytes
    let resolvedMime = String(mimeType || 'audio/webm').split(';')[0]

    if (audioUrl) {
      const loaded = await meetingBytes(audioUrl, resolvedMime)
      bytes = loaded.bytes
      resolvedMime = loaded.mimeType || resolvedMime
    } else {
      if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Missing audio' })
      bytes = Buffer.from(audio, 'base64')
      if (!bytes.length) return res.status(400).json({ error: 'Empty audio' })
      const limit = isMeeting ? MAX_MEETING_BYTES : MAX_VOICE_BYTES
      if (bytes.length > limit) {
        return res.status(413).json({ error: isMeeting ? 'Meeting recording is too large for one final transcription pass.' : 'Voice note is too long. Please keep it under about one minute.' })
      }
    }

    const context = cleanContext(contextHints)
    const prompt = isMeeting
      ? [
          'This is a business meeting transcript. Transcribe faithfully and completely; do not translate, summarize, clean up, or omit speech.',
          'Speech may code-switch naturally between English, German, Hindi and Hinglish. Preserve the code-switching and English technical terms exactly when heard.',
          'Be especially careful with SAP terminology, transaction names, material and inspection-plan terminology, acronyms, people names, numbers and dates.',
          'When audio is unclear, be conservative rather than inventing a plausible sentence.',
          context ? `Meeting vocabulary and context hints: ${context}` : '',
        ].filter(Boolean).join(' ')
      : 'Transcribe exactly what the user says. Preserve multilingual speech and code-switching, including Hindi spoken with English words, German, English and names. Do not translate or summarize.'

    const form = new FormData()
    const ext = extensionFor(resolvedMime)
    form.append('file', new Blob([bytes], { type: resolvedMime }), isMeeting ? `ana-meeting.${ext}` : `ana-briefing.${ext}`)
    form.append('model', 'gpt-transcribe')
    form.append('response_format', 'json')
    form.append('prompt', prompt)

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(isMeeting ? 240000 : 60000),
    })

    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Transcription failed' })

    const text = String(data?.text || '').trim()
    if (!text) return res.status(502).json({ error: 'No speech was detected' })
    return res.status(200).json({ text, model: 'gpt-transcribe' })
  } catch (error) {
    const status = Number(error?.status || 0)
    if (status) return res.status(status).json({ error: error?.message || 'Transcription failed' })
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return res.status(504).json({ error: 'Meeting transcription took too long. Please try again.' })
    return res.status(500).json({ error: error?.message || 'Transcription failed' })
  }
}
