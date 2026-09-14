import { clearZoomSession, getValidZoomSession } from '../_zoom.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const session = await getValidZoomSession(req, res)
    if (!session) return res.status(200).json({ connected: false })
    return res.status(200).json({
      connected: true,
      profile: session.profile || null,
      scope: session.scope || '',
    })
  } catch (error) {
    clearZoomSession(req, res)
    return res.status(200).json({ connected: false, error: error.message || 'Zoom connection expired.' })
  }
}
