import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function tokenIssuedAt(token = '') {
  try {
    const payload = token.split('.')[1]
    if (!payload) return 'unknown'
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'))
    return Number.isFinite(parsed?.iat) ? String(parsed.iat) : 'unknown'
  } catch {
    return 'unknown'
  }
}

function bearerToken(req) {
  const authHeader = String(req.headers.authorization || '')
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
}

async function verifySupabaseUser(token) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase server configuration is missing')

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: publishableKey,
    },
  })

  if (!response.ok) return null
  return response.json()
}

async function updateSupabaseMetadata(token, data) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase server configuration is missing')
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.msg || payload?.error_description || payload?.error || 'Could not update account connection')
  return payload
}

function googleConfig() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || '').trim(),
    appUrl: String(process.env.GOOGLE_APP_URL || 'https://vak-gray.vercel.app').replace(/\/$/, ''),
  }
}

function googleReady() {
  const config = googleConfig()
  return Boolean(config.clientId && config.clientSecret && config.redirectUri)
}

function cryptoKey() {
  const secret = String(process.env.GOOGLE_TOKEN_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim()
  if (!secret) throw new Error('Google token encryption is not configured')
  return createHash('sha256').update(secret).digest()
}

function seal(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map(buffer => buffer.toString('base64url')).join('.')
}

function unseal(value) {
  const [ivPart, tagPart, dataPart] = String(value || '').split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('Invalid secure state')
  const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted)
}

function safeReturnTo(req, requested) {
  const config = googleConfig()
  const candidates = [requested, req.headers.origin ? `${req.headers.origin}/?mode=meeting&gmail=connected` : '', `${config.appUrl}/?mode=meeting&gmail=connected`]
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate || ''))
      const appHost = new URL(config.appUrl).host
      const allowedHost = url.host === appHost || url.host.endsWith('.vercel.app')
      if (url.protocol === 'https:' && allowedHost) return url.toString()
    } catch {}
  }
  return `${config.appUrl}/?mode=meeting&gmail=connected`
}

function redirectWith(url, key, value) {
  try {
    const target = new URL(url)
    target.searchParams.set(key, value)
    return target.toString()
  } catch { return url }
}

async function exchangeGoogleCode(code) {
  const config = googleConfig()
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error_description || data?.error || 'Google authorization failed')
  return data
}

async function refreshGoogleAccessToken(refreshToken) {
  const config = googleConfig()
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description || data?.error || 'Google connection needs to be renewed')
  return data.access_token
}

async function googleProfile(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) return {}
  return response.json().catch(() => ({}))
}

async function handleGoogleStart(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!googleReady()) return res.status(503).json({ error: 'Google Gmail integration is not configured yet.' })
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifySupabaseUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })

  const config = googleConfig()
  const state = seal({
    token,
    userId: user.id,
    exp: Date.now() + 10 * 60 * 1000,
    returnTo: safeReturnTo(req, req.body?.returnTo),
  })
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
}

async function handleGoogleCallback(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')
  let returnTo = googleConfig().appUrl + '/?mode=meeting'
  try {
    if (!googleReady()) throw new Error('Google Gmail integration is not configured yet.')
    if (req.query?.error) throw new Error(String(req.query.error_description || req.query.error))
    const state = unseal(String(req.query?.state || ''))
    returnTo = safeReturnTo(req, state?.returnTo)
    if (!state?.token || !state?.userId || Number(state?.exp || 0) < Date.now()) throw new Error('Google connection request expired')
    const user = await verifySupabaseUser(state.token)
    if (!user?.id || user.id !== state.userId) throw new Error('Ana session changed during Google connection')
    const code = String(req.query?.code || '')
    if (!code) throw new Error('Google did not return an authorization code')
    const tokenData = await exchangeGoogleCode(code)
    const existing = user.user_metadata?.google_gmail || {}
    const refreshToken = tokenData.refresh_token || (existing?.refresh_token ? unseal(existing.refresh_token)?.token : '')
    if (!refreshToken) throw new Error('Google did not provide a reusable Gmail connection. Please connect again and approve access.')
    const profile = await googleProfile(tokenData.access_token)
    await updateSupabaseMetadata(state.token, {
      google_gmail: {
        refresh_token: seal({ token: refreshToken }),
        email: String(profile?.email || existing?.email || '').trim(),
        connected_at: new Date().toISOString(),
        scope: 'gmail.send',
      },
    })
    return res.redirect(302, redirectWith(returnTo, 'gmail', 'connected'))
  } catch (error) {
    console.error('[google-gmail callback]', error?.message || error)
    return res.redirect(302, redirectWith(returnTo, 'gmail', 'error'))
  }
}

async function handleGoogleStatus(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!googleReady()) return res.status(503).json({ error: 'Google Gmail integration is not configured yet.', connected: false })
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifySupabaseUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })
  const connection = user.user_metadata?.google_gmail
  return res.status(200).json({ connected: Boolean(connection?.refresh_token), email: String(connection?.email || '') })
}

async function handleGoogleDisconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifySupabaseUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })
  const encrypted = user.user_metadata?.google_gmail?.refresh_token
  if (encrypted && googleReady()) {
    try {
      const refreshToken = unseal(encrypted)?.token
      if (refreshToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    } catch {}
  }
  await updateSupabaseMetadata(token, { google_gmail: null })
  return res.status(200).json({ ok: true })
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

async function handleGoogleSend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!googleReady()) return res.status(503).json({ error: 'Google Gmail integration is not configured yet.' })
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifySupabaseUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })
  const connection = user.user_metadata?.google_gmail
  if (!connection?.refresh_token) return res.status(409).json({ error: 'Connect Gmail before sending.' })

  const to = (Array.isArray(req.body?.to) ? req.body.to : [])
    .map(value => String(value || '').trim())
    .filter(validEmail)
    .slice(0, 20)
  const subject = String(req.body?.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240)
  const body = String(req.body?.body || '').trim().slice(0, 150000)
  if (!to.length || !subject || !body) return res.status(400).json({ error: 'Recipient, subject and message are required.' })

  try {
    const refreshToken = unseal(connection.refresh_token)?.token
    if (!refreshToken) throw new Error('Gmail connection is invalid')
    const accessToken = await refreshGoogleAccessToken(refreshToken)
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
    const message = [
      `To: ${to.join(', ')}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
    ].join('\r\n')
    const raw = Buffer.from(message, 'utf8').toString('base64url')
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error?.message || 'Gmail rejected the message')
    return res.status(200).json({ ok: true, id: data?.id || '' })
  } catch (error) {
    console.error('[google-gmail send]', error?.message || error)
    return res.status(502).json({ error: error?.message || 'Gmail could not send the message.' })
  }
}

async function handleAuthNotification(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })

  const event = req.body?.event
  if (!['login', 'signup'].includes(event)) return res.status(400).json({ error: 'Invalid event' })

  const resendKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ANA_ADMIN_EMAIL
  const from = process.env.ANA_NOTIFY_FROM || 'Ana Notifications <notifications@tri-vana.de>'

  if (!resendKey || !adminEmail) {
    console.warn('[auth-notify] Email notification is not configured')
    return res.status(503).json({ error: 'Email notification is not configured' })
  }

  try {
    const user = await verifySupabaseUser(token)
    if (!user?.id || !user?.email) return res.status(401).json({ error: 'Invalid session' })

    const metadata = user.user_metadata || {}
    const name = String(metadata.name || '').trim()
    const location = String(metadata.location || '').trim()
    const happenedAt = new Date().toISOString()
    const title = event === 'signup' ? 'New Ana registration' : 'Ana user login'
    const eventLabel = event === 'signup' ? 'Registered' : 'Logged in'
    const subject = `${title} — ${user.email}`

    const text = [
      title,
      '',
      `Email: ${user.email}`,
      name ? `Name: ${name}` : null,
      location ? `Location: ${location}` : null,
      `${eventLabel}: ${happenedAt}`,
    ].filter(Boolean).join('\n')

    const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#171717"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#fffdfa;border:1px solid #e4ded3;border-radius:18px"><tr><td style="padding:28px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a8175;margin-bottom:10px">Ana</div><h1 style="font-size:25px;line-height:1.2;margin:0 0 24px;color:#171717">${escapeHtml(title)}</h1><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:13px;color:#7b7368;width:110px">Email</td><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:14px;color:#171717">${escapeHtml(user.email)}</td></tr>${name ? `<tr><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:13px;color:#7b7368">Name</td><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:14px;color:#171717">${escapeHtml(name)}</td></tr>` : ''}${location ? `<tr><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:13px;color:#7b7368">Location</td><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:14px;color:#171717">${escapeHtml(location)}</td></tr>` : ''}<tr><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:13px;color:#7b7368">Event</td><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:14px;color:#171717">${escapeHtml(eventLabel)}</td></tr><tr><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:13px;color:#7b7368">Time</td><td style="padding:10px 0;border-top:1px solid #eee8de;font-size:14px;color:#171717">${escapeHtml(happenedAt)}</td></tr></table><p style="font-size:11px;line-height:1.5;color:#958c80;margin:24px 0 0">This notification contains account activity only. No password, conversation, voice, or translation content is included.</p></td></tr></table></td></tr></table></body></html>`

    const issuedAt = tokenIssuedAt(token)
    const idempotencyKey = event === 'signup'
      ? `ana-signup-${user.id}`
      : `ana-login-${user.id}-${issuedAt}`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [adminEmail],
        subject,
        text,
        html,
        tags: [
          { name: 'product', value: 'ana' },
          { name: 'event', value: event },
        ],
      }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('[auth-notify] Resend failed', response.status, data?.message || data?.error || '')
      return res.status(502).json({ error: 'Email delivery failed' })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[auth-notify]', error?.message || error)
    return res.status(500).json({ error: 'Notification failed' })
  }
}

export default async function handler(req, res) {
  const action = String(Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action || '').trim()
  try {
    if (action === 'google-start') return await handleGoogleStart(req, res)
    if (action === 'google-callback') return await handleGoogleCallback(req, res)
    if (action === 'google-status') return await handleGoogleStatus(req, res)
    if (action === 'google-disconnect') return await handleGoogleDisconnect(req, res)
    if (action === 'google-send') return await handleGoogleSend(req, res)
    return await handleAuthNotification(req, res)
  } catch (error) {
    console.error('[auth-account]', error?.message || error)
    return res.status(500).json({ error: error?.message || 'Request failed' })
  }
}
