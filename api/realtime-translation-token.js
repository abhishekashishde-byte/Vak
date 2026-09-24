import { publicDomain, resolveDomain } from '../server/domain.js'
import { validateTesterSession } from '../server/usageQuota.js'

const ALLOWED_LANGUAGES = new Set([
  'de', 'en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'pa', 'ml', 'kn', 'ur', 'fr', 'es', 'it',
])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const quota = await validateTesterSession(req, 'meeting_live', req.body?.quotaSessionId)
  if (!quota.ok) return res.status(quota.status).json({ error: quota.error })

  const requested = String(req.body?.targetLanguage || 'en').trim().toLowerCase()
  const targetLanguage = ALLOWED_LANGUAGES.has(requested) ? requested : 'en'
  const domainResolution = resolveDomain('', req.body?.domain)

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/translations/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
            },
            output: { language: targetLanguage },
          },
        },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'Could not create live translation session' })
    }

    return res.status(200).json({ ...data, domain: publicDomain(domainResolution) })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not create live translation session' })
  }
}
