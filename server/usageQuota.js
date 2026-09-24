const cleanBearer = req => {
  const value = String(req.headers?.authorization || '').trim()
  return value.toLowerCase().startsWith('bearer ') ? value : ''
}

const supabaseConfig = () => {
  const url = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/,'')
  const key = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '')
  return { url, key }
}

export async function validateTesterSession(req, kind, sessionId) {
  const auth = cleanBearer(req)
  if (!auth) return { ok: false, status: 401, error: 'Please sign in again.' }
  if (!sessionId) return { ok: false, status: 403, error: 'Tester usage session is required.' }

  const { url, key } = supabaseConfig()
  if (!url || !key) return { ok: false, status: 503, error: 'Ana account services are unavailable.' }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/ana_validate_usage_session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: auth,
      },
      body: JSON.stringify({ p_session_id: sessionId, p_kind: kind }),
    })
    const text = await response.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }

    if (!response.ok) {
      const message = String(data?.message || data?.error || text || '')
      const quota = message.includes('ANA_QUOTA_EXCEEDED') || message.includes('ANA_USAGE_SESSION_INVALID')
      return { ok: false, status: quota ? 403 : response.status, error: quota ? 'This week’s tester allowance has been reached.' : (message || 'Could not verify tester allowance.') }
    }
    if (!data?.allowed) return { ok: false, status: 403, error: 'This week’s tester allowance has been reached.' }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, status: 503, error: error?.message || 'Could not verify tester allowance.' }
  }
}


export async function validateDocumentUsage(req, usageId) {
  const auth = cleanBearer(req)
  if (!auth) return { ok: false, status: 401, error: 'Please sign in again.' }
  if (!usageId) return { ok: false, status: 403, error: 'Document tester allowance is required.' }

  const { url, key } = supabaseConfig()
  if (!url || !key) return { ok: false, status: 503, error: 'Ana account services are unavailable.' }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/ana_validate_document_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: auth,
      },
      body: JSON.stringify({ p_usage_id: usageId }),
    })
    const text = await response.text()
    if (!response.ok) {
      const message = (() => { try { return JSON.parse(text)?.message || text } catch { return text } })()
      return { ok: false, status: response.status === 401 ? 401 : 403, error: String(message || '').includes('ANA_DOCUMENT_USAGE_INVALID') ? 'This document tester allowance is no longer active.' : (message || 'Could not verify document allowance.') }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, status: 503, error: error?.message || 'Could not verify document allowance.' }
  }
}
