import { clearZoomSession, getValidZoomSession, zoomFetch } from '../_zoom.js'

function normalizeMeeting(item = {}) {
  return {
    id: String(item.id || ''),
    uuid: item.uuid || '',
    topic: item.topic || 'Zoom meeting',
    startTime: item.start_time || '',
    duration: Number(item.duration) || 0,
    timezone: item.timezone || '',
    joinUrl: item.join_url || '',
    startUrl: item.start_url || '',
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const session = await getValidZoomSession(req, res)
    if (!session) return res.status(401).json({ error: 'Connect Zoom first.' })

    const data = await zoomFetch(session, '/users/me/meetings?type=upcoming_meetings&page_size=30')
    const meetings = Array.isArray(data?.meetings) ? data.meetings.map(normalizeMeeting) : []
    return res.status(200).json({ meetings })
  } catch (error) {
    if (/expired|authorization|invalid access token/i.test(error.message || '')) clearZoomSession(req, res)
    return res.status(502).json({ error: error.message || 'Could not load Zoom meetings.' })
  }
}
