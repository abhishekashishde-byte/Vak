import { applyPlatformCors, collectResponseText, publicRequestId, requirePlatformKey } from '../_platform.js'

const clean = (value, max) => String(value || '').trim().slice(0, max)

export default async function handler(req, res) {
  if (applyPlatformCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requirePlatformKey(req, res)) return
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Translation service is not configured.' })

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
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Translation failed.', request_id: requestId })
    const translation = collectResponseText(data)
    if (!translation) return res.status(502).json({ error: 'Translation returned no text.', request_id: requestId })

    return res.status(200).json({
      request_id: requestId,
      source,
      target,
      translation,
    })
  } catch (error) {
    console.error('[platform/translate]', requestId, error?.message || error)
    return res.status(500).json({ error: 'Translation failed.', request_id: requestId })
  }
}
