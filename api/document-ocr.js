import { profileLabel, publicDomain, resolveDomain } from './_domain.js'

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

function cleanBlocks(items, purpose) {
  if (!Array.isArray(items)) return null
  const allowedTypes = ['heading', 'paragraph', 'cell', 'form_row', 'form_label', 'form_value']
  return items.slice(0, 180).map(item => ({
    type: allowedTypes.includes(item?.type) ? item.type : 'paragraph',
    role: item?.role === 'chrome' ? 'chrome' : 'content',
    text: String(item?.text || '').trim(),
    x: Number(item?.x) || 0,
    y: Number(item?.y) || 0,
    width: Number(item?.width) || 0,
    height: Number(item?.height) || 0,
    confidence: ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : 'medium',
    handwritten: item?.handwritten === true,
  })).filter(item => item.text && !(purpose === 'camera' && item.role === 'chrome'))
}

function promptForPurpose(purpose) {
  const base = `Return JSON only in this shape:\n{"layout":"form|document|scene|screen","blocks":[{"type":"heading|paragraph|cell|form_row|form_label|form_value","role":"content|chrome","text":"exact visible text","x":0,"y":0,"width":0,"height":0,"confidence":"high|medium|low","handwritten":false}]}\n\nCoordinate rules:\n- x, y, width and height are integers from 0 to 1000 relative to the supplied image.\n- x/y use the TOP-LEFT corner.\n- Keep boxes tight around their own text or form row.\n\nReading rules:\n- Copy names, numbers, dates, times, prices, currency symbols, reference numbers, punctuation and warning symbols exactly as visible.\n- Mark handwritten=true when the block is handwritten rather than printed.\n- confidence=high means the text is clearly legible; medium means some characters are uncertain; low means material characters or words are genuinely difficult to read.\n- For uncertain handwriting or blurred text, preserve only characters you can actually see. Never repair a name, number, date, price or word by guessing.\n- Do not translate.\n- If text is genuinely unreadable, omit it instead of inventing it.\n- Do not let boxes overlap unless the source visibly overlaps.`

  if (purpose === 'camera') {
    return `Read the visible text in this real-world image carefully. It may be a sign, menu, label, letter, form, poster, package, notice, timetable, receipt, computer/tablet screen or other scene. Locate text by where it actually appears in the image.\n\n${base}\n\nVisual-scene rules:\n- First identify the PRIMARY thing the user is trying to read. When a document or form clearly occupies most of a phone/tablet/computer screen, that document/form is primary; surrounding status bars, clock/date overlays, browser/app controls, folder names and viewer chrome are not. Mark such surrounding interface text role=chrome.\n- If the screen UI itself is clearly the primary subject rather than a document shown inside it, treat its useful UI text as role=content instead.\n- Keep separate signs, menu items, labels and price lines as separate blocks when they occupy separate visual areas.\n- For FORMS, preserve rows rather than producing many tiny floating fragments. When a question/label and its nearby answer options or entered value belong to the same horizontal row, prefer one form_row block covering the meaningful row text. Example structure only: question + yes/no options + nearby value should normally be one row block.\n- Do not emit isolated repeated control words such as yes/no/please specify as separate blocks when they clearly belong to a nearby form row. Keep them with that row.\n- If a form label and value genuinely occupy distinct regions and must remain separate to preserve meaning, use form_label and form_value, but keep both boxes aligned to the same row.\n- Group wrapped lines only when they clearly form one sentence, paragraph, form question or one menu/item entry.\n- Preserve the natural top-to-bottom / left-to-right visual grouping without merging unrelated nearby text.\n- Preserve obvious visual hierarchy: large headings should remain their own heading blocks; ordinary labels and form questions should not become headings.\n- Ignore logos or decorative graphics unless they contain readable words relevant to the primary message.\n- Do not infer obscured words from context, branding or common phrases. Accuracy beats completeness.`
  }

  return `Read this scanned PDF page carefully and return its visible textual layout.\n\n${base}\n\nDocument-layout rules:\n- Preserve the page's real reading structure. For a true multi-column page, keep each text block inside its own column instead of merging text across columns.\n- Preserve separate table cells, form labels and filled form values as separate blocks.\n- Group ordinary wrapped paragraph lines only when they clearly belong to the same paragraph.\n- Keep headings separate.\n- Do not include logos, decorative marks, borders, photographs or signatures without readable text.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const { imageData, pageNumber, purpose } = req.body || {}
  if (typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Missing image' })
  }
  if (imageData.length > 4_200_000) {
    return res.status(413).json({ error: purpose === 'camera' ? 'This photo is too large to read safely.' : 'This scanned page is too large to read safely.' })
  }

  const requestedDomain = req.body?.domain
  const preDomain = resolveDomain('', requestedDomain)
  const manualDomainHint = preDomain.mode !== 'auto' && preDomain.active !== 'general'
    ? `The user explicitly marked this as ${profileLabel(preDomain.active)} context. This is only a recognition hint: copy the visible wording exactly and do not replace it with a synonym.`
    : ''
  const prompt = [promptForPurpose(purpose), manualDomainHint].filter(Boolean).join('\n\n')

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: purpose === 'camera' ? 'gpt-5.6-sol' : 'gpt-5.6-luna',
        instructions: 'You are a precise visual OCR and layout extraction system. Accuracy beats completeness. Never infer text that is not visibly present. Return valid JSON only.',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: `${prompt}\n\n${purpose === 'camera' ? 'Visual image' : `Page: ${Number(pageNumber) || 1}`}` },
            { type: 'input_image', image_url: imageData, detail: 'high' },
          ],
        }],
        reasoning: { effort: purpose === 'camera' ? 'medium' : 'low' },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || (purpose === 'camera' ? 'Could not read this image.' : 'Could not read this scanned page.') })
    }

    const parsed = parseJson(collectText(data))
    const blocks = cleanBlocks(parsed?.blocks, purpose)
    if (!blocks) return res.status(502).json({ error: purpose === 'camera' ? 'Ana could not locate readable text in this image.' : 'Ana could not reconstruct the text layout on this scanned page.' })

    const lowConfidenceCount = blocks.filter(block => block.confidence === 'low').length
    const handwrittenCount = blocks.filter(block => block.handwritten).length
    const detectedDomain = resolveDomain(blocks.map(block => block.text).join(' '), requestedDomain)
    return res.status(200).json({
      layout: ['form', 'document', 'scene', 'screen'].includes(parsed?.layout) ? parsed.layout : 'scene',
      blocks,
      lowConfidenceCount,
      handwrittenCount,
      domain: publicDomain(detectedDomain),
    })
  } catch (error) {
    return res.status(500).json({ error: error?.message || (purpose === 'camera' ? 'Could not read this image.' : 'Could not read this scanned page.') })
  }
}
