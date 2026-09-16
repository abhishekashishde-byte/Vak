const TEST_KEY = 'sandbox-mJokm7E2jH'

function cleanUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') ? value : ''
}

function normalizeV2(payload) {
  const source = Array.isArray(payload?.results) ? payload.results : []
  return source.slice(0, 24).map(item => {
    const formats = item?.media_formats || {}
    const preview = cleanUrl(formats?.tinygif?.url) || cleanUrl(formats?.mediumgif?.url) || cleanUrl(formats?.gif?.url)
    const share = cleanUrl(formats?.gif?.url) || cleanUrl(formats?.mediumgif?.url) || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

function normalizeV1(payload) {
  const source = Array.isArray(payload?.data?.data) ? payload.data.data : []
  return source.slice(0, 24).map(item => {
    if (item?.type === 'ad') return null
    const file = item?.file || {}
    const gif = size => cleanUrl(file?.[size]?.gif?.url)
    const preview = gif('xs') || gif('sm') || gif('md') || gif('hd')
    const share = gif('md') || gif('sm') || gif('hd') || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

async function getJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'AnaKeyboard/0.9' }, signal: controller.signal })
    const text = await response.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = {} }
    if (!response.ok) throw new Error(`KLIPY ${response.status}: ${data?.errors?.message?.[0] || data?.message || text.slice(0, 100)}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const q = String(req.query?.q || '').trim().slice(0, 80)
  const limit = Math.max(1, Math.min(24, Number(req.query?.limit) || 18))
  const key = process.env.KLIPY_API_KEY || TEST_KEY
  const encodedKey = encodeURIComponent(key)
  const encodedQ = encodeURIComponent(q)

  try {
    const v2 = q
      ? `https://api.klipy.com/v2/search?key=${encodedKey}&q=${encodedQ}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
      : `https://api.klipy.com/v2/featured?key=${encodedKey}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
    const data = await getJson(v2)
    const results = normalizeV2(data)
    if (results.length) {
      res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json({ provider: 'klipy', results })
    }
  } catch (firstError) {
    try {
      const action = q ? 'search' : 'trending'
      const v1 = `https://api.klipy.com/api/v1/${encodedKey}/gifs/${action}?page=1&per_page=${limit}&customer_id=ana-keyboard&locale=en_US${q ? `&q=${encodedQ}` : ''}`
      const data = await getJson(v1)
      const results = normalizeV1(data)
      if (results.length) {
        res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
        return res.status(200).json({ provider: 'klipy', results })
      }
    } catch (secondError) {
      return res.status(503).json({ error: 'GIF provider unavailable', detail: String(secondError?.message || firstError?.message || '').slice(0, 160), needsProductionKey: !process.env.KLIPY_API_KEY })
    }
  }
  return res.status(200).json({ provider: 'klipy', results: [] })
}
