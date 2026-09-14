function extensionFor(mime = '') {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

function collectText(data) {
  return (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { audio, mimeType = 'audio/webm', target = 'English', previousContext = '' } = req.body || {}
  if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Missing audio' })

  try {
    const bytes = Buffer.from(audio, 'base64')
    if (!bytes.length) return res.status(400).json({ error: 'Empty audio' })
    if (bytes.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Meeting segment is too large' })

    const form = new FormData()
    const ext = extensionFor(mimeType)
    form.append('file', new Blob([bytes], { type: mimeType }), `ana-meeting-segment.${ext}`)
    form.append('model', 'gpt-transcribe')
    form.append('response_format', 'json')
    const context = String(previousContext || '').trim().slice(-1400)
    const transcriptionPrompt = context
      ? `Transcribe exactly what is spoken in this meeting segment. Preserve names, numbers, technical terms, multilingual speech and code-switching. Do not translate, summarize or add commentary. Previous meeting context for names and continuity only; do NOT repeat it: ${context}`
      : 'Transcribe exactly what is spoken in this meeting segment. Preserve names, numbers, technical terms, multilingual speech and code-switching. Do not translate, summarize or add commentary.'
    form.append('prompt', transcriptionPrompt)

    const transcribeResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    })
    const transcribeData = await transcribeResponse.json()
    if (!transcribeResponse.ok) return res.status(transcribeResponse.status).json({ error: transcribeData?.error?.message || 'Transcription failed' })

    const transcript = String(transcribeData?.text || '').trim()
    if (!transcript) return res.status(200).json({ transcript: '', translation: '' })

    let instructions = `You are Ana translating the CURRENT speech from a live meeting into natural ${target}. Previous meeting context may be supplied only to resolve names, terminology, pronouns and sentence continuity. Translate ONLY CURRENT SPEECH; never repeat previous context. Preserve the speaker's perspective, names, numbers, dates, uncertainty, technical terminology and factual meaning. If the current speech starts or ends mid-thought because of live chunking, translate it as a natural continuation rather than pretending it is a complete standalone sentence. Do not answer questions, summarize, explain, censor or add commentary. If the current speech is already in ${target}, return it naturally without changing meaning. Return only the translated CURRENT speech.`
    if (target === 'Hinglish') instructions += ' Hinglish means natural conversational Hindi written entirely in Roman/Latin letters. Never use Devanagari.'
    if (target === 'Swabian German (Schwäbisch)') instructions += ' Use natural readable Schwäbisch without caricature.'
    if (target === 'Bavarian German (Bairisch)') instructions += ' Use natural readable Bairisch without caricature.'
    if (target === 'Low German (Plattdeutsch)') instructions += ' Use natural readable Plattdeutsch rather than Standard German.'

    const translateResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        instructions,
        input: context ? `PREVIOUS CONTEXT (do not translate or repeat):\n${context}\n\nCURRENT SPEECH (translate only this):\n${transcript}` : transcript,
        reasoning: { effort: 'low' },
        max_output_tokens: 500,
      }),
    })
    const translateData = await translateResponse.json()
    if (!translateResponse.ok) return res.status(translateResponse.status).json({ error: translateData?.error?.message || 'Translation failed' })

    const translation = collectText(translateData)
    return res.status(200).json({ transcript, translation })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Meeting translation failed' })
  }
}
