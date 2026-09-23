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

async function saveReceipt(token, userId, actionId, provider, result) {
  const body = [{
    user_id: userId,
    action_id: actionId,
    provider,
    status: 'sent',
    external_id: result.externalId || '',
    external_url: result.externalUrl || '',
    response_meta: result.meta || {},
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const token = bearerToken(req)
  if (!token) return res.status(401).json({ error: 'Missing session' })
  const user = await verifyUser(token)
  if (!user?.id) return res.status(401).json({ error: 'Invalid session' })

  const operation = clean(req.body?.operation || 'status', 40)
  if (operation === 'status') return res.status(200).json({ integrations: integrationStatus() })
  if (operation !== 'route') return res.status(400).json({ error: 'Unsupported action-route operation.' })

  const provider = clean(req.body?.provider, 20).toLowerCase()
  if (!['jira', 'planner'].includes(provider)) return res.status(400).json({ error: 'Choose Jira or Planner.' })
  const actionId = clean(req.body?.actionId, 80)
  if (!actionId) return res.status(400).json({ error: 'Action ID is required.' })

  try {
    const payload = await fetchAction(token, user.id, actionId)
    const result = provider === 'jira' ? await pushJira(payload) : await pushPlanner(payload)
    const receipt = await saveReceipt(token, user.id, actionId, provider, result)
    return res.status(200).json({
      ok: true,
      provider,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      receipt,
    })
  } catch (error) {
    console.error('[action-route]', provider, actionId, error?.message || error)
    return res.status(502).json({ error: error?.message || 'Could not route this action.' })
  }
}
