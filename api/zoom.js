import {
  clearZoomSession,
  consumeOAuthState,
  createOAuthState,
  exchangeZoomCode,
  getOrigin,
  getValidZoomSession,
  getZoomRedirectUri,
  writeZoomSession,
  zoomCredentials,
  zoomFetch,
} from './_zoom.js'

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

function actionFrom(req) {
  const value = req.query?.action
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

async function connect(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { clientId } = zoomCredentials()
  const state = createOAuthState(req, res)
  const redirectUri = getZoomRedirectUri(req)
  const url = new URL('https://zoom.us/oauth/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  res.statusCode = 302
  res.setHeader('Location', url.toString())
  res.end()
}

async function callback(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const origin = (() => {
    try { return getOrigin(req) } catch { return '/' }
  })()

  try {
    const { code, state, error, error_description: errorDescription } = req.query || {}
    if (error) throw new Error(errorDescription || String(error))
    if (!code) throw new Error('Zoom did not return an authorization code.')
    if (!consumeOAuthState(req, res, state)) throw new Error('Zoom authorization state could not be verified. Please try again.')

    const session = await exchangeZoomCode({ code: String(code), redirectUri: getZoomRedirectUri(req) })

    try {
      const profile = await zoomFetch(session, '/users/me')
      session.profile = {
        id: profile?.id || '',
        name: profile?.display_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || '',
        email: profile?.email || '',
      }
    } catch {
      session.profile = null
    }

    writeZoomSession(req, res, session)
    res.statusCode = 302
    res.setHeader('Location', `${origin}/?zoom=connected`)
    res.end()
  } catch (err) {
    const message = encodeURIComponent(err.message || 'Zoom connection failed.')
    res.statusCode = 302
    res.setHeader('Location', `${origin}/?zoom=error&zoom_message=${message}`)
    res.end()
  }
}

async function status(req, res) {
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

async function meetings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const session = await getValidZoomSession(req, res)
    if (!session) return res.status(401).json({ error: 'Connect Zoom first.' })

    const data = await zoomFetch(session, '/users/me/meetings?type=upcoming_meetings&page_size=30')
    const upcoming = Array.isArray(data?.meetings) ? data.meetings.map(normalizeMeeting) : []
    return res.status(200).json({ meetings: upcoming })
  } catch (error) {
    if (/expired|authorization|invalid access token/i.test(error.message || '')) clearZoomSession(req, res)
    return res.status(502).json({ error: error.message || 'Could not load Zoom meetings.' })
  }
}

async function disconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  clearZoomSession(req, res)
  return res.status(200).json({ disconnected: true })
}

export default async function handler(req, res) {
  const action = actionFrom(req)
  try {
    if (action === 'connect') return await connect(req, res)
    if (action === 'callback') return await callback(req, res)
    if (action === 'status') return await status(req, res)
    if (action === 'meetings') return await meetings(req, res)
    if (action === 'disconnect') return await disconnect(req, res)
    return res.status(404).json({ error: 'Unknown Zoom action.' })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Zoom integration error.' })
  }
}
