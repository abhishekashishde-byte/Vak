import { useEffect, useMemo, useState } from 'react'
import { Check, Circle, ExternalLink, ListTodo, Send, TriangleAlert } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import './action-center.css'

const clean = value => String(value || '').trim()
const safeArray = value => Array.isArray(value) ? value : []

function parseDeadline(value) {
  const raw = clean(value)
  if (!raw) return null
  const direct = new Date(raw)
  if (Number.isFinite(direct.getTime())) return direct
  const iso = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (!iso) return null
  const parsed = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function dayStart(value = new Date()) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function deadlineBucket(action) {
  if (action.status === 'done') return 'completed'
  const deadline = parseDeadline(action.deadline)
  if (!deadline) return 'open'
  const today = dayStart()
  const date = dayStart(deadline)
  if (date < today) return 'overdue'
  const seven = new Date(today); seven.setDate(seven.getDate() + 7)
  if (date <= seven) return 'due'
  return 'open'
}

function meetingMeta(record) {
  return record?.notes?._ana?.metadata || {}
}

async function sessionToken() {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

export default function ActionCenter() {
  const [actions, setActions] = useState([])
  const [meetings, setMeetings] = useState([])
  const [routes, setRoutes] = useState([])
  const [integrations, setIntegrations] = useState({ jira: { configured: false }, planner: { configured: false } })
  const [filter, setFilter] = useState('open')
  const [customer, setCustomer] = useState('')
  const [project, setProject] = useState('')
  const [routing, setRouting] = useState('')
  const [approval, setApproval] = useState(null)
  const [message, setMessage] = useState('')

  const refresh = async () => {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) return

    const [{ data: actionRows }, { data: meetingRows }, { data: routeRows }] = await Promise.all([
      supabase.from('meeting_actions').select('id,meeting_client_id,action_key,task,owner,deadline,status,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(500),
      supabase.from('meeting_records').select('client_id,title,started_at,notes').eq('user_id', user.id).order('started_at', { ascending: false }).limit(150),
      supabase.from('meeting_action_routes').select('id,action_id,provider,status,external_id,external_url,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
    ])
    setActions(safeArray(actionRows))
    setMeetings(safeArray(meetingRows))
    setRoutes(safeArray(routeRows))
  }

  const refreshIntegrationStatus = async () => {
    const token = await sessionToken()
    if (!token) return
    try {
      const response = await fetch('/api/action-route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'status' }),
      })
      const data = await response.json()
      if (response.ok && data?.integrations) setIntegrations(data.integrations)
    } catch {}
  }

  useEffect(() => {
    refresh()
    refreshIntegrationStatus()
    const onRefresh = () => refresh()
    window.addEventListener('ana-actions-changed', onRefresh)
    const timer = setInterval(refresh, 5000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('ana-actions-changed', onRefresh)
    }
  }, [])

  const meetingById = useMemo(() => new Map(meetings.map(record => [String(record.client_id), record])), [meetings])
  const routeByAction = useMemo(() => {
    const map = new Map()
    routes.forEach(route => {
      const key = String(route.action_id)
      const values = map.get(key) || []
      values.push(route)
      map.set(key, values)
    })
    return map
  }, [routes])

  const customers = useMemo(() => [...new Set(meetings.map(record => clean(meetingMeta(record).customer)).filter(Boolean))].sort(), [meetings])
  const projects = useMemo(() => [...new Set(meetings.map(record => clean(meetingMeta(record).project)).filter(Boolean))].sort(), [meetings])

  const counts = useMemo(() => ({
    open: actions.filter(item => item.status !== 'done').length,
    due: actions.filter(item => deadlineBucket(item) === 'due').length,
    overdue: actions.filter(item => deadlineBucket(item) === 'overdue').length,
    completed: actions.filter(item => item.status === 'done').length,
  }), [actions])

  const visible = useMemo(() => actions.filter(action => {
    const bucket = deadlineBucket(action)
    if (filter === 'open' && action.status === 'done') return false
    if (filter !== 'open' && bucket !== filter) return false
    const record = meetingById.get(String(action.meeting_client_id))
    const meta = meetingMeta(record)
    if (customer && clean(meta.customer) !== customer) return false
    if (project && clean(meta.project) !== project) return false
    return true
  }), [actions, filter, customer, project, meetingById])

  const toggleDone = async action => {
    if (!supabase || !action?.id) return
    const status = action.status === 'done' ? 'open' : 'done'
    setActions(previous => previous.map(item => item.id === action.id ? { ...item, status } : item))
    const { error } = await supabase.from('meeting_actions').update({ status, updated_at: new Date().toISOString() }).eq('id', action.id)
    if (error) {
      setMessage(error.message)
      await refresh()
    } else {
      window.dispatchEvent(new CustomEvent('ana-actions-changed'))
    }
  }

  const routeAction = async (action, provider) => {
    const token = await sessionToken()
    if (!token) return
    setRouting(`${action.id}:${provider}`)
    setMessage('')
    try {
      const response = await fetch('/api/action-route', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'route', actionId: action.id, provider }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || `Could not send to ${provider}.`)
      setMessage(`Sent to ${provider === 'jira' ? 'Jira' : 'Planner'}.`)
      setApproval(null)
      await refresh()
    } catch (error) {
      setMessage(error?.message || 'Could not route this action.')
    } finally {
      setRouting('')
    }
  }

  const openEvidence = meetingClientId => {
    window.dispatchEvent(new CustomEvent('ana-open-meeting', { detail: { id: String(meetingClientId || '') } }))
    setTimeout(() => document.querySelector('.mi-shell')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 20)
  }

  return <section className="action-center" aria-label="Ana Action Center">
    <div className="action-center-head">
      <div><ListTodo size={18}/><div><h2>Action Center</h2><p>Meeting commitments that still need attention.</p></div></div>
      <div className="action-integrations">
        <span className={integrations.jira?.configured ? 'ready' : ''}>Jira {integrations.jira?.configured ? 'ready' : 'not configured'}</span>
        <span className={integrations.planner?.configured ? 'ready' : ''}>Planner {integrations.planner?.configured ? 'ready' : 'not configured'}</span>
      </div>
    </div>

    <div className="action-tabs">
      <button className={filter==='open'?'active':''} onClick={()=>setFilter('open')}>Open <b>{counts.open}</b></button>
      <button className={filter==='due'?'active':''} onClick={()=>setFilter('due')}>Due soon <b>{counts.due}</b></button>
      <button className={filter==='overdue'?'active danger':''} onClick={()=>setFilter('overdue')}>Overdue <b>{counts.overdue}</b></button>
      <button className={filter==='completed'?'active':''} onClick={()=>setFilter('completed')}>Completed <b>{counts.completed}</b></button>
    </div>

    <div className="action-filters">
      <select value={customer} onChange={event=>setCustomer(event.target.value)}><option value="">All customers</option>{customers.map(value=><option key={value}>{value}</option>)}</select>
      <select value={project} onChange={event=>setProject(event.target.value)}><option value="">All projects</option>{projects.map(value=><option key={value}>{value}</option>)}</select>
    </div>

    {message && <p className="action-center-message">{message}</p>}

    <div className="action-center-list">
      {visible.length ? visible.map(action => {
        const meeting = meetingById.get(String(action.meeting_client_id))
        const meta = meetingMeta(meeting)
        const receipts = routeByAction.get(String(action.id)) || []
        const bucket = deadlineBucket(action)
        const pendingProvider = approval?.actionId === action.id ? approval.provider : ''
        return <article className={`action-center-item ${bucket}`} key={action.id}>
          <button className="action-check" onClick={()=>toggleDone(action)} aria-label={action.status==='done'?'Reopen action':'Complete action'}>
            {action.status==='done'?<Check size={15}/>:<Circle size={15}/>}
          </button>
          <div className="action-center-main">
            <strong>{action.task}</strong>
            <div className="action-meta">
              {action.owner && <span>Owner: {action.owner}</span>}
              {action.deadline && <span className={bucket==='overdue'?'danger':''}>{bucket==='overdue'?<TriangleAlert size={11}/>:null} {action.deadline}</span>}
              {meta.customer && <span>{meta.customer}</span>}
              {meta.project && <span>{meta.project}</span>}
            </div>
            <button className="action-source" onClick={()=>openEvidence(action.meeting_client_id)}>Source: {meeting?.title || 'Meeting'} · view evidence</button>
            {receipts.length > 0 && <div className="action-route-receipts">{receipts.map(receipt=><span key={receipt.id}>{receipt.provider === 'jira' ? 'Jira' : 'Planner'} ✓ {receipt.external_url ? <a href={receipt.external_url} target="_blank" rel="noreferrer"><ExternalLink size={10}/></a> : null}</span>)}</div>}
          </div>
          <div className="action-route-buttons">
            {['jira','planner'].map(provider => {
              const configured = Boolean(integrations[provider]?.configured)
              const busy = routing === `${action.id}:${provider}`
              if (pendingProvider === provider) return <div className="action-approval" key={provider}><small>Send this action to {provider === 'jira' ? 'Jira' : 'Planner'}?</small><div><button onClick={()=>setApproval(null)}>Cancel</button><button className="approve" onClick={()=>routeAction(action,provider)} disabled={busy}>{busy?'Sending…':'Approve & send'}</button></div></div>
              return <button key={provider} disabled={!configured || Boolean(routing)} title={configured?'Requires your approval before sending':'Configure this integration on the Ana server first'} onClick={()=>setApproval({actionId:action.id,provider})}><Send size={12}/> {provider === 'jira' ? 'Jira' : 'Planner'}</button>
            })}
          </div>
        </article>
      }) : <div className="action-center-empty">No actions in this view.</div>}
    </div>
  </section>
}
