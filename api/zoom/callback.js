import {
  consumeOAuthState,
  exchangeZoomCode,
  getOrigin,
  getZoomRedirectUri,
  writeZoomSession,
  zoomFetch,
} from '../_zoom.js'

export default async function handler(req, res) {
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
