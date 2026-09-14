import { clearZoomSession } from '../_zoom.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  clearZoomSession(req, res)
  return res.status(200).json({ disconnected: true })
}
