import crypto from 'node:crypto'

const SESSION_COOKIE = 'ana_zoom_session'
const STATE_COOKIE = 'ana_zoom_state'
const ZOOM_API = 'https://api.zoom.us/v2'
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token'

function cookieMap(req) {
  const raw = String(req?.headers?.cookie || '')
  return raw.split(';').reduce((acc, item) => {
    const index = item.indexOf('=')
    if (index < 0) return acc
    const key = item.slice(0, index).trim()
    const value = item.slice(index + 1).trim()
    if (key) acc[key] = decodeURIComponent(value)
    return acc
  }, {})
}

function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie')
  const next = Array.isArray(current) ? [...current, value] : current ? [current, value] : [value]
  res.setHeader('Set-Cookie', next)
}

function secureFor(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '')
  return forwarded === 'https' || process.env.NODE_ENV === 'production'
}

export function setCookie(req, res, name, value, { maxAge = 3600, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAge))}`]
  if (httpOnly) parts.push('HttpOnly')
  if (secureFor(req)) parts.push('Secure')
  appendSetCookie(res, parts.join('; '))
}

export function clearCookie(req, res, name) {
  setCookie(req, res, name, '', { maxAge: 0 })
}

export function getCookie(req, name) {
  return cookieMap(req)[name] || ''
}

export function getOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https'
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim()
  if (!host) throw new Error('Could not determine application origin.')
  return `${proto}://${host}`
}

export function getZoomRedirectUri(req) {
  return process.env.ZOOM_REDIRECT_URI || `${getOrigin(req)}/api/zoom/callback`
}

export function zoomCredentials() {
  const clientId = String(process.env.ZOOM_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('Zoom integration is not configured yet.')
  return { clientId, clientSecret }
}

function tokenKey() {
  const raw = String(process.env.ZOOM_TOKEN_SECRET || process.env.ZOOM_CLIENT_SECRET || '').trim()
  if (!raw) throw new Error('ZOOM_TOKEN_SECRET is not configured.')
  return crypto.createHash('sha256').update(raw).digest()
}

export function encryptZoomSession(session) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptZoomSession(value) {
  if (!value) return null
  try {
    const raw = Buffer.from(value, 'base64url')
    if (raw.length < 29) return null
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv)
    decipher.setAuthTag(tag)
    const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function readZoomSession(req) {
  return decryptZoomSession(getCookie(req, SESSION_COOKIE))
}

export function writeZoomSession(req, res, session) {
  setCookie(req, res, SESSION_COOKIE, encryptZoomSession(session), { maxAge: 60 * 60 * 24 * 30 })
}

export function clearZoomSession(req, res) {
  clearCookie(req, res, SESSION_COOKIE)
}

export function createOAuthState(req, res) {
  const state = crypto.randomBytes(24).toString('base64url')
  setCookie(req, res, STATE_COOKIE, state, { maxAge: 10 * 60 })
  return state
}

export function consumeOAuthState(req, res, received) {
  const expected = getCookie(req, STATE_COOKIE)
  clearCookie(req, res, STATE_COOKIE)
  if (!expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(String(received))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function authHeader() {
  const { clientId, clientSecret } = zoomCredentials()
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

async function tokenRequest(params) {
  const response = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.access_token) throw new Error(data?.reason || data?.message || 'Zoom authorization failed.')
  return data
}

export async function exchangeZoomCode({ code, redirectUri }) {
  const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || '',
    apiUrl: data.api_url || ZOOM_API,
  }
}

export async function refreshZoomSession(session) {
  if (!session?.refreshToken) throw new Error('Zoom authorization has expired. Please reconnect Zoom.')
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken })
  return {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || session.scope || '',
    apiUrl: data.api_url || session.apiUrl || ZOOM_API,
  }
}

export async function getValidZoomSession(req, res) {
  let session = readZoomSession(req)
  if (!session?.accessToken) return null
  if (Number(session.expiresAt || 0) <= Date.now() + 90_000) {
    session = await refreshZoomSession(session)
    writeZoomSession(req, res, session)
  }
  return session
}

export async function zoomFetch(session, path, init = {}) {
  const base = String(session?.apiUrl || ZOOM_API).replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${session.accessToken}`,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.message || 'Zoom API request failed.')
  return data
}
