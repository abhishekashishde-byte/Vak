import { createOAuthState, getZoomRedirectUri, zoomCredentials } from '../_zoom.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message || 'Zoom connection is not configured.' })
  }
}
