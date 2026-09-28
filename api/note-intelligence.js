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

function selectionPrompt(intent, targetLanguage) {
  const language = targetLanguage || 'English'
  const common = [
    'Work only from the selected note content. First read any handwriting conservatively.',
    'Preserve names, numbers, dates, technical terms, negations and uncertainty.',
    'Do not invent context that is not present in the selection.',
  ]
  if (intent === 'translate') return [...common,
    `Translate the selected content into ${language}. Do not summarize it.`,
    'Return JSON only: {"recognizedText":"source text","outputText":"translation","kind":"translation"}.',
  ].join(' ')
  if (intent === 'explain') return [...common,
    `Explain the selected word, phrase or note in ${language} as clearly as possible for a language learner or expat.`,
    'If it is a German word, include its natural meaning, context/usage and article/plural when useful.',
    'Return JSON only: {"recognizedText":"source text","outputText":"explanation","kind":"explanation"}.',
  ].join(' ')
  if (intent === 'action') return [...common,
    `Interpret the selected content semantically and turn it into a clear action item in ${language}.`,
    'Do not rely on arrows, question marks, boxes or any fixed shorthand symbols. Infer intent from the words and context.',
    'If the selection is not actually an action, say so instead of inventing one.',
    'Return JSON only: {"recognizedText":"source text","outputText":"action item or clarification","kind":"action"}.',
  ].join(' ')
  if (intent === 'email') return [...common,
    `Turn the selected content into a concise, professional email in ${language}.`,
    'Infer the purpose from the content, but do not invent names, deadlines or facts.',
    'Return JSON only: {"recognizedText":"source text","outputText":"complete email draft","kind":"email"}.',
  ].join(' ')
  if (intent === 'clean_german') return [...common,
    'Turn the selected content into clean, natural German notes. The source may be Hindi, English, German or mixed-language shorthand.',
    'Preserve every factual detail. Improve structure and grammar without adding information.',
    'Return JSON only: {"recognizedText":"source text","outputText":"clean German note","kind":"clean_german"}.',
  ].join(' ')
  return ''
}

function interpretPrompt(targetLanguage) {
  return [
    `Understand this note semantically and respond in ${targetLanguage || 'English'}.`,
    'Infer what the writer meant from the complete context rather than matching symbols or fixed shorthand conventions.',
    'A line with an arrow is not automatically an action, and a question mark is not automatically an open question.',
    'Identify actions only when the wording/context implies a follow-up. Identify questions when the writer appears to be seeking an answer. Identify decisions only when a choice/conclusion is actually present.',
    'Preserve uncertainty instead of forcing a classification.',
    'Return JSON only in this shape:',
    '{"title":"short title","summary":"short interpretation","actions":[{"task":"...","owner":"","deadline":""}],"openQuestions":["..."],"decisions":["..."],"keyPoints":["..."]}',
    'Do not invent owners, deadlines, decisions or facts.',
  ].join(' ')
}

function askNotesPrompt(targetLanguage) {
  return [
    `Answer the user's question using only the supplied Ana Notes, in ${targetLanguage || 'English'}.`,
    'Search conceptually across the notes, not just by exact keyword match.',
    'Use handwritten-recognition text, typed text and saved AI summaries when supplied.',
    'If the answer is not supported by the notes, say that clearly.',
    'Return JSON only: {"answer":"...","sources":[{"id":"note id","title":"note title","reason":"why this note supports the answer"}]}.',
    'Use only source ids/titles that appear in the supplied notes. Do not invent a source.',
  ].join(' ')
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

  const { action = 'recognize', imageData = '', typedText = '', recognizedText = '', transcript = '', targetLanguage = 'English', intent = '', question = '', notes = [] } = req.body || {}
  if (!['recognize','translate','polish','meeting_fuse','selection_ask','interpret','ask_notes'].includes(action)) return res.status(400).json({ error: 'Unsupported Ana Notes action.' })

  const hasImage = typeof imageData === 'string' && imageData.startsWith('data:image/')
  if (hasImage && imageData.length > 4_200_000) return res.status(413).json({ error: 'This notebook page is too large to process.' })
  if (action === 'ask_notes' && !clean(question, 1000)) return res.status(400).json({ error: 'Ask a question about your notes first.' })
  if (!['meeting_fuse','ask_notes'].includes(action) && !hasImage && !clean(typedText, 50000) && !clean(recognizedText, 50000)) {
    return res.status(400).json({ error: 'There is no note content to process yet.' })
  }

  let userText = ''
  let prompt = ''
  if (action === 'meeting_fuse') {
    userText = `USER NOTE:\n${clean([typedText, recognizedText].filter(Boolean).join('\n\n'), 30000)}\n\nMEETING TRANSCRIPT:\n${clean(transcript, 70000)}`
    prompt = meetingPrompt()
  } else if (action === 'selection_ask') {
    if (!['translate','explain','action','email','clean_german'].includes(intent)) return res.status(400).json({ error: 'Unsupported selection action.' })
    userText = `Selected typed/recognized content (may be empty if handwriting is in the image):\n${clean([typedText, recognizedText].filter(Boolean).join('\n\n'), 20000)}`
    prompt = selectionPrompt(intent, clean(targetLanguage, 60))
  } else if (action === 'interpret') {
    userText = `Typed note:\n${clean(typedText, 30000)}\n\nRecognized handwriting:\n${clean(recognizedText, 30000)}`
    prompt = interpretPrompt(clean(targetLanguage, 60))
  } else if (action === 'ask_notes') {
    const safeNotes = (Array.isArray(notes) ? notes : []).slice(0, 100).map(note => ({
      id: clean(note?.id, 120),
      title: clean(note?.title, 240),
      updatedAt: clean(note?.updatedAt, 80),
      content: clean(note?.content, 5000),
    })).filter(note => note.id && note.content)
    const corpus = safeNotes.map(note => `NOTE ID: ${note.id}\nTITLE: ${note.title}\nUPDATED: ${note.updatedAt}\nCONTENT:\n${note.content}`).join('\n\n---\n\n').slice(0, 95000)
    userText = `QUESTION:\n${clean(question, 1000)}\n\nANA NOTES:\n${corpus}`
    prompt = askNotesPrompt(clean(targetLanguage, 60))
  } else {
    userText = `Typed note (may be empty):\n${clean(typedText, 30000)}\n\nPreviously recognized handwriting (may be empty):\n${clean(recognizedText, 30000)}`
    prompt = actionPrompt(action, clean(targetLanguage, 60))
  }

  const content = [{ type: 'input_text', text: `${prompt}\n\n${userText}` }]
  if (hasImage) content.push({ type: 'input_image', image_url: imageData, detail: 'high' })

  try {
    const model = hasImage || action === 'interpret' || action === 'ask_notes' ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        instructions: 'You are Ana Notes intelligence. Be conservative with handwriting and faithful to the user. Return valid JSON only.',
        input: [{ role: 'user', content }],
        reasoning: { effort: ['meeting_fuse','interpret','ask_notes'].includes(action) ? 'low' : 'none' },
        max_output_tokens: action === 'meeting_fuse' ? 4200 : action === 'ask_notes' ? 3200 : action === 'interpret' ? 3000 : 2600,
      }),
      signal: AbortSignal.timeout(action === 'meeting_fuse' ? 90000 : 60000),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Ana could not process this note.' })

    await logAiUsage(req, {
      feature: action === 'meeting_fuse' ? 'notes_meeting_fusion' : action === 'selection_ask' ? `notes_selection_${clean(intent,40)}` : `notes_${action}`,
      model,
      usage: data?.usage || {},
      metadata: { hasImage, action, ...(action === 'selection_ask' ? { intent: clean(intent,40) } : {}) },
    })

    const parsed = parseJson(collectText(data))
    if (!parsed) return res.status(502).json({ error: 'Ana could not structure the note response.' })
    return res.status(200).json(parsed)
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return res.status(504).json({ error: 'Ana Notes took too long. Please try again.' })
    return res.status(500).json({ error: error?.message || 'Ana could not process this note.' })
  }
}
