function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const clean = (value, max) => String(value || '').trim().slice(0, max)
const FEATURES = new Set(['Translate', 'Live interpreter', 'Talk for me', 'Live Subtitles', 'Meeting Listen', 'Conversation Room', 'Documents', 'Camera'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const resendKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ANA_ADMIN_EMAIL
  const from = process.env.ANA_NOTIFY_FROM || 'Ana Notifications <notifications@tri-vana.de>'
  if (!resendKey || !adminEmail) return res.status(503).json({ error: 'Review moderation is not configured yet.' })

  const body = req.body || {}
  if (clean(body.website, 200)) return res.status(200).json({ ok: true })

  const name = clean(body.name, 60)
  const country = clean(body.country, 60)
  const languages = clean(body.languages, 100)
  const feature = clean(body.feature, 80)
  const review = clean(body.review, 1600)
  const email = clean(body.email, 160)
  const rating = Number(body.rating)

  if (name.length < 2) return res.status(400).json({ error: 'Please add a display name.' })
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Please choose a rating from 1 to 5.' })
  if (!FEATURES.has(feature)) return res.status(400).json({ error: 'Please choose a valid Ana feature.' })
  if (review.length < 20) return res.status(400).json({ error: 'Please tell us a little more about your experience.' })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please check the email address.' })

  const submittedAt = new Date().toISOString()
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)
  const subject = `Ana review awaiting moderation — ${rating}/5 — ${feature}`
  const text = [
    'Ana customer review awaiting moderation',
    '',
    `Rating: ${rating}/5`,
    `Name: ${name}`,
    country ? `Country: ${country}` : null,
    languages ? `Languages: ${languages}` : null,
    `Feature: ${feature}`,
    email ? `Private contact email: ${email}` : null,
    `Submitted: ${submittedAt}`,
    '',
    review,
    '',
    'Moderation note: Publish only after checking the review for personal data, abuse, spam and authenticity. Do not publish the private contact email.',
  ].filter(Boolean).join('\n')

  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#171717"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fffdfa;border:1px solid #e3ddd2;border-radius:18px"><tr><td style="padding:26px"><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8d8377">Ana · review moderation</div><h1 style="font-size:24px;margin:9px 0 5px">${escapeHtml(name)}</h1><div style="font-size:20px;letter-spacing:2px;margin-bottom:20px">${stars}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:9px 0;border-top:1px solid #eee8de;color:#7b7368;width:120px">Feature</td><td style="padding:9px 0;border-top:1px solid #eee8de">${escapeHtml(feature)}</td></tr>${country ? `<tr><td style="padding:9px 0;border-top:1px solid #eee8de;color:#7b7368">Country</td><td style="padding:9px 0;border-top:1px solid #eee8de">${escapeHtml(country)}</td></tr>` : ''}${languages ? `<tr><td style="padding:9px 0;border-top:1px solid #eee8de;color:#7b7368">Languages</td><td style="padding:9px 0;border-top:1px solid #eee8de">${escapeHtml(languages)}</td></tr>` : ''}${email ? `<tr><td style="padding:9px 0;border-top:1px solid #eee8de;color:#7b7368">Private email</td><td style="padding:9px 0;border-top:1px solid #eee8de">${escapeHtml(email)}</td></tr>` : ''}</table><blockquote style="margin:22px 0 0;padding:16px 18px;background:#f4f0e8;border-radius:12px;font-size:15px;line-height:1.55">${escapeHtml(review)}</blockquote><p style="font-size:11px;color:#8a8175;line-height:1.5;margin:20px 0 0">This review is not public yet. Check it before adding it to the approved review feed. Never publish the private contact email.</p></td></tr></table></td></tr></table></body></html>`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [adminEmail],
        ...(email ? { reply_to: email } : {}),
        subject,
        text,
        html,
        tags: [
          { name: 'product', value: 'ana' },
          { name: 'event', value: 'customer-review' },
        ],
      }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('[review-submit] Resend failed', response.status, data?.message || data?.error || '')
      return res.status(502).json({ error: 'Your review could not be submitted right now.' })
    }
    return res.status(200).json({ ok: true, message: 'Thank you. Your review was sent for moderation.' })
  } catch (error) {
    console.error('[review-submit]', error?.message || error)
    return res.status(500).json({ error: 'Your review could not be submitted right now.' })
  }
}
