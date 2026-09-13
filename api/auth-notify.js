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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = String(req.headers.authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return res.status(401).json({ error: 'Missing session' })

  const event = req.body?.event
  if (!['login', 'signup'].includes(event)) return res.status(400).json({ error: 'Invalid event' })

  const resendKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ANA_ADMIN_EMAIL
  const from = process.env.ANA_NOTIFY_FROM || 'Ana Notifications <onboarding@resend.dev>'

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
