import { createHash } from 'node:crypto'

const supabaseConfig = () => ({
  url: String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim(),
})

function bearerToken(req) {
  const value = String(req?.headers?.authorization || '').trim()
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''
}

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return (forwarded || String(req?.headers?.['x-real-ip'] || '').trim() || 'unknown').slice(0, 120)
}

async function verifyUser(token) {
  if (!token) return null
  const { url, key } = supabaseConfig()
  if (!url || !key) return null
  try {
    const response = await fetch(url + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: key },
      signal: AbortSignal.timeout(3500),
    })
    if (!response.ok) return null
    const user = await response.json().catch(() => null)
    return user?.id ? user : null
  } catch {
    return null
  }
}

function featureDisabled(feature) {
  if (/^(1|true|yes)$/i.test(String(process.env.ANA_AI_EMERGENCY_STOP || ''))) return true
  const disabled = new Set(String(process.env.ANA_DISABLED_FEATURES || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
  return disabled.has('all') || disabled.has(String(feature || '').toLowerCase())
}

function identityHash(value) {
  const salt = String(process.env.ANA_RATE_LIMIT_SALT || process.env.OPENAI_API_KEY || 'ana-beta-rate-limit')
  return createHash('sha256').update(salt + '\u0000' + value).digest('hex')
}

async function consumeRateLimit({ req, user, feature, limit, windowSeconds }) {
  const { url, key } = supabaseConfig()
  if (!url || !key) throw new Error('Ana rate limiting is not configured.')
  const identity = user?.id
    ? 'user:' + user.id
    : 'ip:' + clientIp(req) + ':' + String(req?.headers?.['user-agent'] || '').slice(0, 120)
  const token = bearerToken(req)
  const response = await fetch(url + '/rest/v1/rpc/ana_consume_api_rate_limit', {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(user && token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({
      p_bucket: String(feature || 'api').slice(0, 80),
      p_identity_hash: identityHash(identity),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
    signal: AbortSignal.timeout(3500),
  })
  if (!response.ok) throw new Error('Ana protection service is temporarily unavailable.')
  return response.json()
}

export async function guardApiRequest(req, res, {
  feature = 'api',
  requireAuth = false,
  authenticatedLimit = 60,
  anonymousLimit = 20,
  windowSeconds = 60,
} = {}) {
  if (featureDisabled(feature)) {
    res.setHeader('Retry-After', '900')
    res.status(503).json({ error: 'This Ana feature is temporarily paused to protect service capacity.' })
    return null
  }

  const token = bearerToken(req)
  const user = token ? await verifyUser(token) : null
  if (requireAuth && !user) {
    res.status(401).json({ error: 'Please sign in again.' })
    return null
  }

  try {
    const limit = user ? authenticatedLimit : anonymousLimit
    const result = await consumeRateLimit({ req, user, feature, limit, windowSeconds })
    if (!result?.allowed) {
      const resetAt = result?.resetAt ? new Date(result.resetAt).getTime() : 0
      const retry = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) : windowSeconds
      res.setHeader('Retry-After', String(retry))
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' })
      return null
    }
    return { user, token, rateLimit: result }
  } catch (error) {
    res.status(503).json({ error: error?.message || 'Ana protection service is temporarily unavailable.' })
    return null
  }
}
