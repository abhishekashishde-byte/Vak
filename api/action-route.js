import { guardApiRequest } from '../server/apiSecurity.js'

function bearerToken(req) {
  const auth = String(req.headers?.authorization || '')
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

function supabaseConfig() {
  return {
    url: String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    key: String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim(),
  }
}

async function verifyUser(token) {
  const { url, key } = supabaseConfig()
  if (!url || !key || !token) return null
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: key },
  })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

async function rest(token, path, options = {}) {
  const { url, key } = supabaseConfig()
  if (!url || !key) throw new Error('Supabase server configuration is missing')
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: key,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new Error(data?.message || data?.error || `Supabase request failed (${response.status})`)
  return data
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' ? url : null
  } catch { return null }
}

function jiraConfig() {
  const base = safeUrl(process.env.ANA_JIRA_BASE_URL)
  return {
    base,
    email: clean(process.env.ANA_JIRA_EMAIL, 240),
    token: clean(process.env.ANA_JIRA_API_TOKEN, 1000),
    projectKey: clean(process.env.ANA_JIRA_PROJECT_KEY, 80),
    issueType: clean(process.env.ANA_JIRA_ISSUE_TYPE || 'Task', 80),
  }
}

function plannerConfig() {
  return {
    webhook: safeUrl(process.env.ANA_PLANNER_WEBHOOK_URL),
    secret: clean(process.env.ANA_PLANNER_WEBHOOK_SECRET, 1000),
  }
}

function integrationStatus() {
  const jira = jiraConfig()
  const planner = plannerConfig()
  return {
    jira: { configured: Boolean(jira.base && jira.email && jira.token && jira.projectKey), mode: 'jira-cloud' },
    planner: { configured: Boolean(planner.webhook), mode: 'approved-webhook' },
  }
}

async function fetchAction(token, userId, actionId) {
  const actionRows = await rest(
    token,
    `meeting_actions?id=eq.${encodeURIComponent(actionId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,meeting_client_id,task,owner,deadline,status`
  )
  const action = Array.isArray(actionRows) ? actionRows[0] : null
  if (!action) throw new Error('Action was not found or does not belong to this Ana account.')

  const meetingRows = await rest(
    token,
    `meeting_records?client_id=eq.${encodeURIComponent(action.meeting_client_id)}&user_id=eq.${encodeURIComponent(userId)}&select=client_id,title,started_at,notes`
  )
  const meeting = Array.isArray(meetingRows) ? meetingRows[0] : null
  const metadata = meeting?.notes?._ana?.metadata || {}
  return {
    action,
    meeting: {
      clientId: clean(meeting?.client_id, 180),
      title: clean(meeting?.title || 'Meeting', 240),
      startedAt: clean(meeting?.started_at, 80),
      customer: clean(metadata?.customer, 240),
      project: clean(metadata?.project, 240),
      topic: clean(metadata?.topic, 240),
    },
  }
}

function actionDescription({ action, meeting }) {
  const lines = [
    meeting.customer ? `Customer: ${meeting.customer}` : '',
    meeting.project ? `Project: ${meeting.project}` : '',
    meeting.title ? `Source meeting: ${meeting.title}` : '',
    meeting.startedAt ? `Meeting date: ${meeting.startedAt}` : '',
    action.owner ? `Owner stated in meeting: ${action.owner}` : '',
    action.deadline ? `Deadline stated in meeting: ${action.deadline}` : '',
    `Ana meeting reference: ${meeting.clientId || action.meeting_client_id}`,
  ].filter(Boolean)
  return lines.join('\n')
}

async function pushJira(payload) {
  const config = jiraConfig()
  if (!(config.base && config.email && config.token && config.projectKey)) throw new Error('Jira routing is not configured on this Ana deployment.')
  const description = actionDescription(payload)
  const fields = {
    project: { key: config.projectKey },
    summary: clean(payload.action.task, 255),
    issuetype: { name: config.issueType },
    description: {
      type: 'doc',
      version: 1,
      content: description.split('\n').map(line => ({
        type: 'paragraph',
        content: [{ type: 'text', text: line }],
      })),
    },
    labels: ['ana-meeting'],
  }
  const due = clean(payload.action.deadline, 40)
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) fields.duedate = due

  const response = await fetch(new URL('/rest/api/3/issue', config.base), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.key) throw new Error(data?.errorMessages?.[0] || data?.errors?.summary || 'Jira rejected the action.')
  return {
    externalId: clean(data.key, 160),
    externalUrl: new URL(`/browse/${encodeURIComponent(data.key)}`, config.base).toString(),
    meta: { provider: 'jira', projectKey: config.projectKey },
  }
}

async function pushPlanner(payload) {
  const config = plannerConfig()
  if (!config.webhook) throw new Error('Planner routing is not configured on this Ana deployment.')
  const response = await fetch(config.webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
    },
    body: JSON.stringify({
      source: 'ana',
      approved: true,
      title: clean(payload.action.task, 255),
      owner: clean(payload.action.owner, 160),
      deadline: clean(payload.action.deadline, 80),
      customer: payload.meeting.customer,
      project: payload.meeting.project,
      topic: payload.meeting.topic,
      meetingTitle: payload.meeting.title,
      meetingClientId: payload.meeting.clientId,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || data?.message || 'Planner routing webhook rejected the action.')
  return {
    externalId: clean(data?.id || data?.taskId || 'planner-task', 200),
    externalUrl: safeUrl(data?.url || data?.webUrl)?.toString() || '',
    meta: { provider: 'planner', mode: 'approved-webhook' },
  }
}

async function saveReceipt(token, userId, actionId, provider, result, status = 'sent') {
  const body = [{
    user_id: userId,
    action_id: actionId,
    provider,
    status,
    external_id: result?.externalId || '',
    external_url: result?.externalUrl || '',
    response_meta: result?.meta || {},
    updated_at: new Date().toISOString(),
  }]
  const data = await rest(
    token,
    'meeting_action_routes?on_conflict=user_id,action_id,provider',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    }
  )
  return Array.isArray(data) ? data[0] : null
}

// ── Wani ─────────────────────────────────────────────────────────────────────
// Sends a finished meeting transcript to the user's own Wani account, only when the user clicks
// "Send to Wani". Wani saves it in the chosen workshop; the analysis starts in Wani.
const WANI_KEY_PREFIX = 'wani_ak_'
const MEETING_CONSENT_TEXT = 'All participants agreed to the meeting being recorded, transcribed and processed (confirmed in Ana before the meeting started).'

function waniBase() {
  return safeUrl(process.env.WANI_BASE_URL || 'https://ask-wani.com')
}

async function waniCall(key, path, options = {}) {
  const base = waniBase()
  if (!base) throw new Error('WANI_BASE_URL is not a valid https address.')
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data?.error || `Wani request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

async function waniConnection(token, userId) {
  const rows = await rest(token, `ana_wani_connections?user_id=eq.${encodeURIComponent(userId)}&select=wani_key,key_hint,updated_at`)
  return Array.isArray(rows) ? rows[0] || null : null
}

function workshopLabel(w) {
  return [w?.client_name, w?.project_name || w?.title].map(value => clean(value, 120)).filter(Boolean).join(' · ') || 'Workshop'
}

function meetingTranscript(meeting) {
  // Prefer speaker-labelled segments when Ana has them; fall back to the plain transcript.
  const segments = Array.isArray(meeting?.notes?._ana?.transcriptSegments) ? meeting.notes._ana.transcriptSegments : []
  const names = meeting?.notes?._ana?.speakerNames || {}
  const stamp = seconds => { const s = Math.max(0, Math.floor(Number(seconds) || 0)); return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]` }
  const labelled = segments
    .filter(segment => clean(segment?.text, 20000))
    .map(segment => `${stamp(segment.start)} ${clean(names?.[segment.speaker] || segment.speaker || 'Speaker', 80)}: ${clean(segment.text, 20000)}`)
    .join('\n')
  return labelled.length >= 40 ? labelled : String(meeting?.original_text || '').trim()
}

async function meetingConsent(token, userId, startedAt) {
  // The meeting can only start after the user confirms participant consent, which Ana logs.
  // Find that confirmation for this meeting (logged within minutes of the start).
  const start = Date.parse(startedAt || '')
  if (Number.isNaN(start)) return null
  const from = new Date(start - 15 * 60000).toISOString(), to = new Date(start + 15 * 60000).toISOString()
  const rows = await rest(token, `ana_consent_events?user_id=eq.${encodeURIComponent(userId)}&consent_type=eq.meeting_recording&outcome=eq.confirmed&created_at=gte.${encodeURIComponent(from)}&created_at=lte.${encodeURIComponent(to)}&select=created_at,notice_version&order=created_at.asc&limit=1`)
  const event = Array.isArray(rows) ? rows[0] : null
  return event ? { at: event.created_at, text: `${MEETING_CONSENT_TEXT} Notice ${clean(event.notice_version, 80)}.` } : null
}

async function handleWani(operation, req, res, token, userId) {
  if (operation === 'wani-status') {
    const connection = await waniConnection(token, userId)
    return res.status(200).json({ connected: Boolean(connection), keyHint: connection?.key_hint || '' })
  }
  if (operation === 'wani-connect') {
    const key = clean(req.body?.key, 200)
    if (!key.startsWith(WANI_KEY_PREFIX) || key.length < 40) return res.status(400).json({ error: 'This does not look like a Wani connection key.' })
    const data = await waniCall(key, '/api/integration-workshops')
    const keyHint = `${key.slice(0, WANI_KEY_PREFIX.length + 6)}…`
    await rest(token, 'ana_wani_connections?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: userId, wani_key: key, key_hint: keyHint, updated_at: new Date().toISOString() }]),
    })
    return res.status(200).json({ connected: true, keyHint, workshops: (data.workshops || []).map(w => ({ id: w.id, label: workshopLabel(w) })) })
  }
  if (operation === 'wani-disconnect') {
    await rest(token, `ana_wani_connections?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    return res.status(200).json({ connected: false })
  }

  const connection = await waniConnection(token, userId)
  if (!connection) return res.status(409).json({ error: 'Connect Wani first: create a connection key in Wani and paste it here.', needsConnection: true })

  if (operation === 'wani-workshops') {
    const data = await waniCall(connection.wani_key, '/api/integration-workshops')
    return res.status(200).json({ workshops: (data.workshops || []).map(w => ({ id: w.id, label: workshopLabel(w) })) })
  }

  if (operation === 'wani-send') {
    const meetingId = clean(req.body?.meetingId, 180)
    const workshopId = clean(req.body?.workshopId, 80)
    const workshop = clean(req.body?.workshopLabel, 240)
    const retentionDays = [7, 30, 90].includes(Number(req.body?.retentionDays)) ? Number(req.body.retentionDays) : null
    if (!meetingId || !workshopId) return res.status(400).json({ error: 'Choose a meeting and a Wani workshop.' })
    const rows = await rest(token, `meeting_records?client_id=eq.${encodeURIComponent(meetingId)}&user_id=eq.${encodeURIComponent(userId)}&select=client_id,title,started_at,original_text,notes`)
    const meeting = Array.isArray(rows) ? rows[0] : null
    if (!meeting) return res.status(404).json({ error: 'Meeting was not found in this Ana account.' })
    const text = meetingTranscript(meeting)
    if (text.length < 40) return res.status(400).json({ error: 'This meeting has no transcript to send.' })

    let consent = await meetingConsent(token, userId, meeting.started_at)
    if (!consent && req.body?.consentConfirmed === true) consent = { at: new Date().toISOString(), text: 'All participants agreed to recording / transcription (confirmed in Ana when sending to Wani).' }
    if (!consent) return res.status(409).json({ error: 'Ana has no consent record for this meeting. Confirm that all participants agreed, then send again.', needsConsent: true })

    const metadata = meeting?.notes?._ana?.metadata || {}
    const title = clean(meeting.title || metadata.topic || 'Meeting', 200)
    const data = await waniCall(connection.wani_key, '/api/integration-ingest', {
      method: 'POST',
      body: JSON.stringify({ workshopId, title, startedAt: meeting.started_at, text, consent, source: 'ana', sourceRef: meeting.client_id, retentionDays }),
    })
    await rest(token, 'ana_wani_sends?on_conflict=user_id,meeting_client_id,workshop_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: userId, meeting_client_id: meeting.client_id, workshop_id: workshopId, workshop_label: workshop, wani_transcript_id: clean(data.transcriptId, 80) }]),
    }).catch(() => null)
    return res.status(200).json({ ok: true, duplicate: Boolean(data.duplicate), transcriptId: data.transcriptId, waniUrl: waniBase()?.toString() || '' })
  }
  return res.status(400).json({ error: 'Unsupported Wani operation.' })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const protection = await guardApiRequest(req, res, { feature: 'action_route', requireAuth: true, authenticatedLimit: 30, windowSeconds: 60 })
  if (!protection) return
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifyUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })

  const operation = clean(req.body?.operation || 'status', 40)
  if (operation === 'status') return res.status(200).json({ integrations: integrationStatus() })
  if (operation.startsWith('wani-')) {
    try { return await handleWani(operation, req, res, token, user.id) } catch (error) {
      const message = error?.message || 'Wani could not be reached.'
      console.error('[action-route] wani', operation, message)
      const status = error?.status === 401 || error?.status === 403 ? 409 : 502
      return res.status(status).json({ error: status === 409 ? 'Wani did not accept the connection key. Create a new one in Wani and connect again.' : message })
    }
  }
  if (operation !== 'route') return res.status(400).json({ error: 'Unsupported action-route operation.' })

  const provider = clean(req.body?.provider, 20).toLowerCase()
  if (!['jira', 'planner'].includes(provider)) return res.status(400).json({ error: 'Choose Jira or Planner.' })
  const actionId = clean(req.body?.actionId, 80)
  if (!actionId) return res.status(400).json({ error: 'Action ID is required.' })

  let payload = null
  try {
    payload = await fetchAction(token, user.id, actionId)
    const result = provider === 'jira' ? await pushJira(payload) : await pushPlanner(payload)
    const receipt = await saveReceipt(token, user.id, actionId, provider, result, 'sent')
    return res.status(200).json({
      ok: true,
      provider,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      receipt,
    })
  } catch (error) {
    const message = error?.message || 'Could not route this action.'
    console.error('[action-route]', provider, actionId, message)
    if (payload) {
      await saveReceipt(token, user.id, actionId, provider, {
        meta: { provider, error: clean(message, 500) },
      }, 'failed').catch(() => null)
    }
    return res.status(502).json({ error: message })
  }
}
