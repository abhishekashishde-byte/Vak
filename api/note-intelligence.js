import { guardApiRequest } from '../server/apiSecurity.js'
import { logAiUsage } from '../server/aiUsage.js'

function collectText(data) {
  const output = Array.isArray(data?.output) ? data.output : []
  return output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === 'output_text' && item?.text)
    .map(item => item.text).join('\n').trim()
}

function parseJson(value) {
  const text = String(value || '').trim()
  if (!text) return null
  try { return JSON.parse(text) } catch {}
  const fenced = text.match(/\{[\s\S]*\}/)
  if (!fenced) return null
  try { return JSON.parse(fenced[0]) } catch { return null }
}

function clean(value, max = 50000) {
  return String(value || '').trim().slice(0, max)
}

function actionPrompt(action, targetLanguage) {
  if (action === 'recognize') {
    return [
      'Read the handwriting on this notebook page exactly and conservatively.',
      'Return JSON only: {"recognizedText":"...","language":"...","uncertain":["..."]}.',
      'Preserve names, numbers, dates, technical terms, arrows/bullets when understandable.',
      'Do not improve or translate the wording. If something is unreadable, mark that fragment as [unclear] instead of guessing.',
    ].join(' ')
  }
  if (action === 'translate') {
    return [
      `Read any handwriting and translate the complete note into ${targetLanguage || 'English'}.`,
      'Return JSON only: {"recognizedText":"source note","outputText":"translated note","language":"detected source language"}.',
      'Preserve names, numbers, dates, measurements, technical terms and negations exactly. Never summarize.',
    ].join(' ')
  }
  if (action === 'polish') {
    return [
      'Turn the user note into a clean, well-aligned note without changing its meaning.',
      'Correct obvious spelling/grammar, organize fragments, preserve all factual details and uncertainty.',
      'Return JSON only: {"recognizedText":"handwriting if present","outputText":"cleaned note","title":"short title"}.',
      'Do not add facts that are not in the note.',
    ].join(' ')
  }
  return ''
}

function meetingPrompt() {
  return [
    'Combine the meeting transcript with the user\'s own typed/handwritten notes.',
    'The user notes represent what the user personally considered important, so give them extra attention, but never let them override a clearly conflicting transcript fact.',
    'Do not invent owners, deadlines or decisions.',
    'Return JSON only in this shape:',
    '{"title":"...","summary":"...","personalNotes":["..."],"decisions":["..."],"actions":[{"task":"...","owner":"","deadline":""}],"openQuestions":["..."],"keyPoints":["..."]}',
    'Keep concise but complete. Preserve technical names, numbers, dates and commitments.',
  ].join(' ')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const protection = await guardApiRequest(req, res, { feature: 'ana_notes_ai', requireAuth: true, authenticatedLimit: 24, windowSeconds: 60 })
  if (!protection) return
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { action = 'recognize', imageData = '', typedText = '', recognizedText = '', transcript = '', targetLanguage = 'English' } = req.body || {}
  if (!['recognize','translate','polish','meeting_fuse'].includes(action)) return res.status(400).json({ error: 'Unsupported Ana Notes action.' })

  const hasImage = typeof imageData === 'string' && imageData.startsWith('data:image/')
  if (hasImage && imageData.length > 4_200_000) return res.status(413).json({ error: 'This notebook page is too large to process.' })
  if (action !== 'meeting_fuse' && !hasImage && !clean(typedText, 50000) && !clean(recognizedText, 50000)) {
    return res.status(400).json({ error: 'There is no note content to process yet.' })
  }

  const userText = action === 'meeting_fuse'
    ? `USER NOTE:\n${clean([typedText, recognizedText].filter(Boolean).join('\n\n'), 30000)}\n\nMEETING TRANSCRIPT:\n${clean(transcript, 70000)}`
    : `Typed note (may be empty):\n${clean(typedText, 30000)}\n\nPreviously recognized handwriting (may be empty):\n${clean(recognizedText, 30000)}`

  const prompt = action === 'meeting_fuse' ? meetingPrompt() : actionPrompt(action, clean(targetLanguage, 60))
  const content = [{ type: 'input_text', text: `${prompt}\n\n${userText}` }]
  if (hasImage) content.push({ type: 'input_image', image_url: imageData, detail: 'high' })

  try {
    const model = hasImage ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        instructions: 'You are Ana Notes intelligence. Be conservative with handwriting and faithful to the user. Return valid JSON only.',
        input: [{ role: 'user', content }],
        reasoning: { effort: action === 'meeting_fuse' ? 'low' : 'none' },
        max_output_tokens: action === 'meeting_fuse' ? 4200 : 2600,
      }),
      signal: AbortSignal.timeout(action === 'meeting_fuse' ? 90000 : 60000),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Ana could not process this note.' })

    await logAiUsage(req, {
      feature: action === 'meeting_fuse' ? 'notes_meeting_fusion' : `notes_${action}`,
      model,
      usage: data?.usage || {},
      metadata: { hasImage, action },
    })

    const parsed = parseJson(collectText(data))
    if (!parsed) return res.status(502).json({ error: 'Ana could not structure the note response.' })
    return res.status(200).json(parsed)
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return res.status(504).json({ error: 'Ana Notes took too long. Please try again.' })
    return res.status(500).json({ error: error?.message || 'Ana could not process this note.' })
  }
}
