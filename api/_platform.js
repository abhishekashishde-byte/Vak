import { timingSafeEqual } from 'node:crypto'

function configuredKeys() {
  return String(process.env.ANA_PLATFORM_API_KEYS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length || left.length === 0) return false
  try { return timingSafeEqual(left, right) } catch { return false }
}

export function applyPlatformCors(req, res) {
  const requestOrigin = String(req.headers?.origin || '')
  const allowed = String(process.env.ANA_PLATFORM_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  const origin = allowed.length
    ? (allowed.includes(requestOrigin) ? requestOrigin : '')
    : '*'

  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Ana-Api-Key')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function requirePlatformKey(req, res) {
  const keys = configuredKeys()
  if (!keys.length) {
    res.status(503).json({
      error: 'Ana Platform is in private beta and API access is not enabled on this deployment.',
      code: 'platform_not_configured',
    })
    return false
  }

  const auth = String(req.headers?.authorization || '')
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const headerKey = String(req.headers?.['x-ana-api-key'] || '').trim()
  const supplied = bearer || headerKey

  if (!supplied || !keys.some(key => safeEqual(key, supplied))) {
    res.status(401).json({ error: 'Invalid Ana Platform API key.', code: 'invalid_api_key' })
    return false
  }
  return true
}

export function collectResponseText(data) {
  return (data?.output || [])
    .filter(item => item?.type === 'message')
    .flatMap(item => item?.content || [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

export function audioExtension(mime = '') {
  const value = String(mime).toLowerCase()
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a'
  if (value.includes('ogg')) return 'ogg'
  if (value.includes('wav')) return 'wav'
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3'
  return 'webm'
}

export function publicRequestId(prefix = 'ana') {
  return `${prefix}_${crypto.randomUUID()}`
}
