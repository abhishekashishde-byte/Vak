function collectText(data) {
  return (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

function parseJson(text = '') {
  const cleaned = String(text).replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { imageData, pageNumber } = req.body || {}
  if (typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Missing page image' })
  }
  if (imageData.length > 4_200_000) {
    return res.status(413).json({ error: 'This scanned page is too large to read safely.' })
  }

  const prompt = `Read this scanned PDF page carefully and return its visible textual layout.

Return JSON only in this shape:
{"blocks":[{"type":"heading|paragraph|cell","text":"exact visible text","x":0,"y":0,"width":0,"height":0}]}

Coordinate rules:
- x, y, width and height are integers from 0 to 1000 relative to the supplied image.
- x/y use the TOP-LEFT corner.
- Keep blocks in natural reading order.
- Preserve separate table/form cells as separate blocks.
- Group ordinary wrapped paragraph lines into one paragraph block when they belong together.
- Keep headings separate.
- Copy names, numbers, dates, reference numbers, punctuation and symbols exactly as visible.
- Do not translate.
- Do not include logos, decorative marks, page borders, photographs, signatures without readable text, or guessed text.
- If text is genuinely unreadable, omit it instead of inventing it.
- Keep each box tight around its own text and do not let boxes overlap unless the source visibly overlaps.`

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        instructions: 'You are a precise document OCR and layout extraction system. Never infer text that is not visibly present. Return valid JSON only.',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: `${prompt}\n\nPage: ${Number(pageNumber) || 1}` },
            { type: 'input_image', image_url: imageData, detail: 'high' },
          ],
        }],
        reasoning: { effort: 'low' },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'Could not read this scanned page.' })
    }

    const parsed = parseJson(collectText(data))
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : null
    if (!blocks) return res.status(502).json({ error: 'Ana could not reconstruct the text layout on this scanned page.' })

    return res.status(200).json({ blocks })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not read this scanned page.' })
  }
}
