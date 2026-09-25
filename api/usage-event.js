import { logAiUsage, realtimeUsageCost } from '../server/aiUsage.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const type = String(req.body?.type || '')
  if (type !== 'realtime_response') return res.status(400).json({ error: 'Unsupported usage event' })

  const model = 'gpt-realtime-2.1'
  const usage = req.body?.usage && typeof req.body.usage === 'object' ? req.body.usage : {}
  const cost = realtimeUsageCost(model, usage)

  const saved = await logAiUsage(req, {
    feature: 'talk_for_me',
    model,
    usage,
    estimatedCostUsd: cost,
    metadata: { responseId: String(req.body?.responseId || '').slice(0,120) },
  })

  return res.status(saved ? 200 : 202).json({ ok: true })
}
