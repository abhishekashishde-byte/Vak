const MODEL = 'baidu/Unlimited-OCR'

function cleanOcrOutput(value = '') {
  return String(value)
    .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, '')
    .replace(/<\|ref\|>([\s\S]*?)<\|\/ref\|>/g, '$1')
    .replace(/<\|[^>]+?\|>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const baseUrl = String(process.env.UNLIMITED_OCR_BASE_URL || '').replace(/\/$/, '')
  const apiKey = process.env.UNLIMITED_OCR_API_KEY || ''

  if (!baseUrl) {
    return res.status(503).json({
      error: 'Ana Scan is ready, but the Unlimited-OCR GPU endpoint has not been connected yet.',
      code: 'OCR_NOT_CONFIGURED',
    })
  }

  try {
    const { imageDataUrl } = req.body || {}
    if (!imageDataUrl || !String(imageDataUrl).startsWith('data:image/')) {
      return res.status(400).json({ error: 'Please upload a supported image.' })
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '<image>document parsing.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        max_tokens: 8192,
        temperature: 0,
        skip_special_tokens: false,
        vllm_xargs: { ngram_size: 35, window_size: 128 },
      }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.error || `OCR service returned ${response.status}`)
    }

    const raw = data?.choices?.[0]?.message?.content || ''
    const parsed = cleanOcrOutput(raw)
    if (!parsed) throw new Error('The OCR service returned no readable content.')

    return res.status(200).json({ parsed, model: MODEL })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Document parsing failed.' })
  }
}
