import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, Circle, Clipboard, FileText, ListTodo, Mail, MessageSquare, Search, Send, Sparkles } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import './meeting-intelligence.css'

const HISTORY_KEY = 'ana-meeting-history-v1'
const LABELS = new Set(['Decision', 'Action', 'Important', 'Question', 'Chatter'])

const clean = value => String(value || '').trim()
const safeArray = value => Array.isArray(value) ? value : []

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch {}
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function mapRemoteMeeting(row) {
  return {
    id: String(row?.client_id || row?.id || ''),
    title: clean(row?.title) || 'Meeting',
    startedAt: toMillis(row?.started_at),
    endedAt: toMillis(row?.ended_at),
    durationMs: Number(row?.duration_ms) || 0,
    target: clean(row?.target),
    source: clean(row?.source),
    notes: row?.notes && typeof row.notes === 'object' ? row.notes : null,
    metadata: row?.notes?._ana?.metadata || {},
    momTemplate: row?.notes?._ana?.momTemplate || null,
    originalText: clean(row?.original_text),
    translatedText: clean(row?.translated_text),
  }
}

function mergeHistory(local, remote) {
  const byId = new Map()
  for (const item of [...safeArray(remote), ...safeArray(local)]) {
    if (!item?.id) continue
    byId.set(String(item.id), { ...(byId.get(String(item.id)) || {}), ...item })
  }
  return [...byId.values()].sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0)).slice(0, 100)
}

function formatDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function formatShortDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '' }
}

function parseJson(text = '') {
  const raw = String(text).replace(/```json|```/g, '').trim()
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  try { return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw) } catch { return null }
}

function actionKey(item) {
  const input = `${clean(item?.task)}|${clean(item?.owner)}|${clean(item?.deadline)}`.toLocaleLowerCase()
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  return `a${(hash >>> 0).toString(16)}`
}

function formatMom(record) {
  const notes = record?.notes || {}
  const meta = record?.metadata || record?.notes?._ana?.metadata || {}
  const template = record?.momTemplate || record?.notes?._ana?.momTemplate || {}
  const lines = [
    `Meeting: ${record?.title || 'Meeting'}`,
    record?.startedAt ? `Date: ${formatDate(record.startedAt)}` : '',
    meta.customer ? `Customer: ${meta.customer}` : '',
    meta.topic ? `Topic: ${meta.topic}` : '',
    meta.project ? `Project: ${meta.project}` : '',
    template.title ? `MOM template: ${template.title}` : '',
    '',
    notes.summary ? `Summary\n${notes.summary}` : '',
    safeArray(notes.keyPoints).length ? `Key points\n${notes.keyPoints.map(item => `• ${String(item)}`).join('\n')}` : '',
    safeArray(notes.decisions).length ? `Decisions\n${notes.decisions.map(item => `• ${String(item)}`).join('\n')}` : '',
    safeArray(notes.actions).length ? `Actions\n${notes.actions.map(item => {
      if (typeof item === 'string') return `• ${item}`
      const meta = [item?.owner ? `Owner: ${item.owner}` : '', item?.deadline ? `Deadline: ${item.deadline}` : ''].filter(Boolean).join(' · ')
      return `• ${clean(item?.task)}${meta ? ` — ${meta}` : ''}`
    }).join('\n')}` : '',
    safeArray(notes.openQuestions).length ? `Open questions\n${notes.openQuestions.map(item => `• ${String(item)}`).join('\n')}` : '',
  ].filter(Boolean)
  return lines.join('\n\n')
}

function transcriptSections(record) {
  return safeArray(record?.notes?.transcriptSections)
    .map(item => ({ label: LABELS.has(item?.label) ? item.label : 'Important', text: clean(item?.text) }))
    .filter(item => item.text)
}

function normalizeActions(input) {
  return safeArray(input).map(item => {
    if (typeof item === 'string') return { task: clean(item), owner: '', deadline: '' }
    return { task: clean(item?.task), owner: clean(item?.owner), deadline: clean(item?.deadline) }
  }).filter(item => item.task)
}

function meetingText(record) {
  const notes = record?.notes || {}
  const meta = record?.metadata || notes?._ana?.metadata || {}
  const template = record?.momTemplate || notes?._ana?.momTemplate || {}
  return [record?.title, meta.customer, meta.topic, meta.project, meta.meetingType, ...safeArray(meta.tags), template.title, notes.summary, ...safeArray(notes.keyPoints), ...safeArray(notes.decisions), ...normalizeActions(notes.actions).map(item => `${item.task} ${item.owner} ${item.deadline}`), record?.originalText]
    .filter(Boolean).join(' ').toLocaleLowerCase()
}

function scoreMeeting(record, question) {
  const words = clean(question).toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length >= 3)
  if (!words.length) return 0
  const text = meetingText(record)
  return words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0)
}

async function sessionToken() {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

export default function MeetingIntelligence() {
  const [history, setHistory] = useState(readHistory)
  const [selectedId, setSelectedId] = useState(() => readHistory()[0]?.id || '')
  const [actions, setActions] = useState([])
  const [ownerName, setOwnerName] = useState('')
  const [transcriptView, setTranscriptView] = useState('important')
  const [question, setQuestion] = useState('')
  const [scope, setScope] = useState('meeting')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [output, setOutput] = useState(null)
  const [outputLoading, setOutputLoading] = useState('')
  const [copied, setCopied] = useState(false)
  const [gmail, setGmail] = useState({ loading: true, connected: false, email: '', configured: true, error: '' })
  const [mailOpen, setMailOpen] = useState(false)
  const [mailTo, setMailTo] = useState('')
  const [mailSubject, setMailSubject] = useState('')
  const [mailBody, setMailBody] = useState('')
  const [mailSending, setMailSending] = useState(false)
  const [mailMessage, setMailMessage] = useState('')
  const enrichedRef = useRef(new Set())
  const syncingActionsRef = useRef(new Set())
  const localSignatureRef = useRef('')

  const selected = useMemo(() => history.find(item => String(item.id) === String(selectedId)) || history[0] || null, [history, selectedId])
  const sections = useMemo(() => transcriptSections(selected), [selected])
  const visibleSections = transcriptView === 'important' ? sections.filter(item => item.label !== 'Chatter') : sections

  const refreshCloud = async () => {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) return
    setOwnerName(clean(user.user_metadata?.name) || clean(user.email?.split('@')[0]))

    const [{ data: meetings }, { data: actionRows }] = await Promise.all([
      supabase.from('meeting_records').select('id,client_id,title,started_at,ended_at,duration_ms,target,source,notes,original_text,translated_text').eq('user_id', user.id).order('started_at', { ascending: false, nullsFirst: false }).limit(100),
      supabase.from('meeting_actions').select('id,meeting_client_id,action_key,task,owner,deadline,status,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(300),
    ])

    const merged = mergeHistory(readHistory(), safeArray(meetings).map(mapRemoteMeeting))
    setHistory(merged)
    if (!selectedId && merged[0]?.id) setSelectedId(merged[0].id)
    setActions(safeArray(actionRows))
  }

  const syncRecordActions = async record => {
    if (!supabase || !record?.id) return
    const items = normalizeActions(record?.notes?.actions)
    if (!items.length || syncingActionsRef.current.has(record.id)) return
    syncingActionsRef.current.add(record.id)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      if (!user) return
      const rows = items.map(item => ({
        user_id: user.id,
        meeting_client_id: String(record.id),
        action_key: actionKey(item),
        task: item.task,
        owner: item.owner,
        deadline: item.deadline,
      }))
      const { error } = await supabase.from('meeting_actions').upsert(rows, { onConflict: 'user_id,meeting_client_id,action_key' })
      if (error) console.warn('[Ana meeting actions]', error.message)
      await refreshCloud()
    } finally { syncingActionsRef.current.delete(record.id) }
  }

  const updateRecordNotes = async (record, notes) => {
    const local = readHistory()
    const next = local.map(item => String(item.id) === String(record.id) ? { ...item, notes } : item)
    saveHistory(next)
    setHistory(previous => previous.map(item => String(item.id) === String(record.id) ? { ...item, notes } : item))

    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) return
    await supabase.from('meeting_records').update({ notes }).eq('user_id', user.id).eq('client_id', String(record.id))
  }

  const ensureEnriched = async record => {
    if (!record?.id || clean(record.originalText).length < 20 || transcriptSections(record).length || enrichedRef.current.has(record.id)) return
    enrichedRef.current.add(record.id)
    const instructions = `ANA_MEETING_ENRICHMENT. Analyse this meeting transcript without changing the raw transcript. Return JSON only with transcriptSections and actions. transcriptSections must be an array of logical chunks, each object containing label and text. label must be exactly one of Decision, Action, Important, Question, Chatter. Keep meaningful technical/business discussion under Important even if no decision was made. Chatter means greetings, jokes, filler, repeated remarks, private/off-topic conversation that does not affect the meeting outcome. Do not over-fragment: use coherent chunks. actions must be an array of objects with task, owner, deadline. Never invent an owner or deadline; use empty strings when absent. Understand English, German, Hindi and Hinglish code-switching.`
    try {
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: record.originalText, instructions }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Meeting analysis failed')
      const parsed = parseJson(data?.content)
      if (!parsed) return
      const existingNotes = record.notes && typeof record.notes === 'object' ? record.notes : {}
      const normalizedSections = safeArray(parsed.transcriptSections).map(item => ({ label: LABELS.has(item?.label) ? item.label : 'Important', text: clean(item?.text) })).filter(item => item.text)
      const enrichedActions = normalizeActions(parsed.actions)
      const notes = {
        ...existingNotes,
        ...(normalizedSections.length ? { transcriptSections: normalizedSections } : {}),
        actions: enrichedActions.length ? enrichedActions : normalizeActions(existingNotes.actions),
      }
      await updateRecordNotes(record, notes)
      await syncRecordActions({ ...record, notes })
    } catch (error) {
      console.warn('[Ana meeting enrichment]', error?.message || error)
    }
  }

  useEffect(() => {
    let mounted = true
    refreshCloud()
    const timer = setInterval(() => {
      if (!mounted) return
      const local = readHistory()
      const signature = JSON.stringify(local.map(item => [item?.id, item?.title, item?.notes?.summary, safeArray(item?.notes?.actions).length, safeArray(item?.notes?.transcriptSections).length]))
      if (signature !== localSignatureRef.current) {
        localSignatureRef.current = signature
        setHistory(previous => mergeHistory(local, previous))
        if (!selectedId && local[0]?.id) setSelectedId(local[0].id)
        local.forEach(record => syncRecordActions(record))
        refreshCloud()
      }
    }, 1600)
    return () => { mounted = false; clearInterval(timer) }
  }, [])

  useEffect(() => { if (selected) ensureEnriched(selected) }, [selected?.id])

  const loadGmailStatus = async () => {
    const token = await sessionToken()
    if (!token) { setGmail({ loading: false, connected: false, email: '', configured: true, error: 'Please sign in again.' }); return }
    try {
      const response = await fetch('/api/auth-notify?action=google-status', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const data = await response.json()
      setGmail({ loading: false, connected: Boolean(data?.connected), email: clean(data?.email), configured: response.status !== 503, error: response.ok ? '' : clean(data?.error) })
    } catch (error) {
      setGmail({ loading: false, connected: false, email: '', configured: true, error: error?.message || 'Could not check Gmail connection.' })
    }
  }

  useEffect(() => { loadGmailStatus() }, [])

  const connectGmail = async () => {
    const token = await sessionToken()
    if (!token) return
    setGmail(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const response = await fetch('/api/auth-notify?action=google-start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.origin}/?mode=meeting&gmail=connected` }),
      })
      const data = await response.json()
      if (!response.ok || !data?.url) throw new Error(data?.error || 'Could not connect Gmail.')
      window.location.assign(data.url)
    } catch (error) {
      setGmail(previous => ({ ...previous, loading: false, configured: !String(error?.message || '').toLowerCase().includes('not configured'), error: error?.message || 'Could not connect Gmail.' }))
    }
  }

  const disconnectGmail = async () => {
    const token = await sessionToken()
    if (!token) return
    await fetch('/api/auth-notify?action=google-disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    await loadGmailStatus()
  }

  const toggleAction = async action => {
    if (!supabase || !action?.id) return
    const nextStatus = action.status === 'done' ? 'open' : 'done'
    setActions(previous => previous.map(item => item.id === action.id ? { ...item, status: nextStatus } : item))
    const { error } = await supabase.from('meeting_actions').update({ status: nextStatus }).eq('id', action.id)
    if (error) { console.warn('[Ana meeting actions]', error.message); await refreshCloud() }
  }

  const askAna = async () => {
    const q = clean(question)
    if (!q || !history.length) return
    setAsking(true); setAnswer('')
    try {
      let meetings = scope === 'meeting' && selected ? [selected] : [...history]
      if (scope === 'all') {
        meetings = meetings.map(record => ({ record, score: scoreMeeting(record, q) })).sort((a, b) => b.score - a.score || Number(b.record.startedAt || 0) - Number(a.record.startedAt || 0)).slice(0, 8).map(item => item.record)
      }
      const corpus = meetings.map(record => {
        const notes = record.notes || {}
        return [
          `MEETING: ${record.title || 'Meeting'} | ${formatDate(record.startedAt)}`,
          notes.summary ? `SUMMARY: ${notes.summary}` : '',
          safeArray(notes.decisions).length ? `DECISIONS: ${notes.decisions.join(' | ')}` : '',
          normalizeActions(notes.actions).length ? `ACTIONS: ${normalizeActions(notes.actions).map(item => `${item.task}${item.owner ? ` [Owner: ${item.owner}]` : ''}${item.deadline ? ` [Deadline: ${item.deadline}]` : ''}`).join(' | ')}` : '',
          `TRANSCRIPT: ${clean(record.originalText).slice(0, 6500)}`,
        ].filter(Boolean).join('\n')
      }).join('\n\n---\n\n').slice(0, 42000)
      const openActions = actions.filter(item => item.status !== 'done').slice(0, 50).map(item => `${item.task}${item.owner ? ` | Owner: ${item.owner}` : ''}${item.deadline ? ` | Deadline: ${item.deadline}` : ''}`).join('\n')
      const instructions = `ANA_MEETING_QA. Answer the user's question using only the supplied meeting evidence and action list. User/owner name: ${ownerName || 'not specified'}. If the answer is not present, say that clearly instead of guessing. Distinguish decisions from suggestions. For cross-meeting answers, mention the relevant meeting title/date when useful. Be concise and practical. Question: ${q}\n\nOPEN ACTIONS:\n${openActions || 'None recorded.'}`
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: corpus, instructions }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Ana could not answer this meeting question.')
      setAnswer(clean(data?.content))
    } catch (error) { setAnswer(error?.message || 'Ana could not answer this meeting question.') }
    finally { setAsking(false) }
  }

  const generateOutput = async kind => {
    if (!selected) return
    setOutputLoading(kind); setOutput(null)
    const notes = selected.notes || {}
    const base = `${formatMom(selected)}\n\nRAW TRANSCRIPT (reference only):\n${clean(selected.originalText).slice(0, 16000)}`
    const prompts = {
      email: 'ANA_MEETING_OUTPUT. Write a concise professional follow-up email after this meeting. Include a useful subject line on the first line prefixed with "Subject:". Include decisions, agreed actions and deadlines only when supported. Do not include irrelevant chatter.',
      german: 'ANA_MEETING_OUTPUT. Create a polished German meeting protocol (MOM) suitable for professional circulation. Preserve facts, decisions, actions, owners and deadlines exactly. Do not add information.',
      customer: 'ANA_MEETING_OUTPUT. Create a customer-safe meeting summary. Keep commitments, decisions, requirements, risks and actions. Remove private/internal chatter, speculation about colleagues, jokes and unrelated internal commentary. Do not hide any material customer commitment.',
      teams: 'ANA_MEETING_OUTPUT. Create a Teams update in maximum 5 concise lines covering outcome, decisions, actions and blockers. No greeting and no filler.',
      todo: `ANA_MEETING_OUTPUT. Create the user's personal to-do list from this meeting. User name: ${ownerName || 'not specified'}. Prioritize actions explicitly assigned to the user. If ownership is unclear, put those under "Unassigned / check". Do not invent ownership or deadlines.`,
    }
    try {
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: base, instructions: prompts[kind] }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not create output.')
      setOutput({ kind, text: clean(data?.content) })
    } catch (error) { setOutput({ kind, text: error?.message || 'Could not create output.' }) }
    finally { setOutputLoading('') }
  }

  const copyOutput = async () => {
    if (!output?.text) return
    await navigator.clipboard.writeText(output.text)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }

  const openMailComposer = (useOutput = false) => {
    if (!selected) return
    const generated = useOutput && output?.kind === 'email' ? output.text : ''
    let subject = `MOM — ${selected.title || 'Meeting'}`
    let body = formatMom(selected)
    if (generated) {
      const lines = generated.split('\n')
      const subjectLine = lines.find(line => /^subject\s*:/i.test(line))
      if (subjectLine) subject = subjectLine.replace(/^subject\s*:/i, '').trim() || subject
      body = lines.filter(line => line !== subjectLine).join('\n').trim() || body
    }
    setMailSubject(subject); setMailBody(body); setMailMessage(''); setMailOpen(true)
  }

  const sendMail = async () => {
    const recipients = mailTo.split(/[;,]+/).map(value => value.trim()).filter(Boolean)
    if (!recipients.length || !clean(mailSubject) || !clean(mailBody)) { setMailMessage('Add at least one recipient, a subject and the email body.'); return }
    const token = await sessionToken()
    if (!token) { setMailMessage('Please sign in again.'); return }
    setMailSending(true); setMailMessage('')
    try {
      const response = await fetch('/api/auth-notify?action=google-send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipients, subject: mailSubject, body: mailBody }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Gmail could not send the message.')
      setMailMessage('Sent with Gmail.')
    } catch (error) { setMailMessage(error?.message || 'Gmail could not send the message.') }
    finally { setMailSending(false) }
  }

  if (!history.length) {
    return <section className="mi-shell mi-empty"><div><Sparkles size={17}/><strong>After-meeting intelligence</strong></div><p>Finish a meeting and Ana will unlock searchable meeting memory, actions, smart transcript filtering, one-click outputs and Gmail delivery here.</p></section>
  }

  return <section className="mi-shell">
    <div className="mi-head">
      <div><Sparkles size={17}/><span><strong>After-meeting intelligence</strong><small>Ask, act, filter and send.</small></span></div>
      <label className="mi-meeting-select"><span>Meeting</span><select value={selected?.id || ''} onChange={event => { setSelectedId(event.target.value); setAnswer(''); setOutput(null) }}>{history.map(record => { const meta = record?.metadata || record?.notes?._ana?.metadata || {}; return <option value={record.id} key={record.id}>{meta.customer ? `${meta.customer} · ` : ''}{meta.topic || record.title || 'Meeting'} · {formatShortDate(record.startedAt)}</option> })}</select></label>
    </div>

    <div className="mi-grid">
      <section className="mi-card mi-ask">
        <div className="mi-card-head"><Bot size={16}/><div><strong>Ask Ana</strong><small>Current meeting or all saved meetings</small></div></div>
        <div className="mi-scope"><button className={scope === 'meeting' ? 'active' : ''} onClick={() => setScope('meeting')}>This meeting</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All meetings</button></div>
        <div className="mi-ask-row"><input value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') askAna() }} placeholder="What did we decide about inspection plans?"/><button onClick={askAna} disabled={asking || !clean(question)}>{asking ? <span className="mi-spinner"/> : <Search size={15}/>} Ask</button></div>
        {answer && <div className="mi-answer">{answer}</div>}
      </section>

      <section className="mi-card mi-actions">
        <div className="mi-card-head"><ListTodo size={16}/><div><strong>Actions</strong><small>{actions.filter(item => item.status !== 'done').length} open across meetings</small></div></div>
        <div className="mi-action-list">{actions.length ? actions.slice(0, 40).map(action => {
          const meeting = history.find(item => String(item.id) === String(action.meeting_client_id))
          return <button className={`mi-action-row ${action.status === 'done' ? 'done' : ''}`} key={action.id} onClick={() => toggleAction(action)}><span className="mi-action-check">{action.status === 'done' ? <Check size={13}/> : <Circle size={13}/>}</span><span><strong>{action.task}</strong><small>{[action.owner ? `Owner: ${action.owner}` : '', action.deadline ? `Deadline: ${action.deadline}` : '', meeting?.title || ''].filter(Boolean).join(' · ')}</small></span></button>
        }) : <p className="mi-muted">No extracted actions yet.</p>}</div>
      </section>
    </div>

    <section className="mi-card mi-transcript">
      <div className="mi-card-head mi-between"><div><FileText size={16}/><span><strong>Smart transcript</strong><small>Chatter stays in the evidence, but you can hide it.</small></span></div><div className="mi-toggle"><button className={transcriptView === 'important' ? 'active' : ''} onClick={() => setTranscriptView('important')}>Important only</button><button className={transcriptView === 'full' ? 'active' : ''} onClick={() => setTranscriptView('full')}>Full</button></div></div>
      {sections.length ? <div className="mi-sections">{visibleSections.map((section, index) => <article className={`mi-section mi-${section.label.toLowerCase()}`} key={`${section.label}-${index}`}><span>{section.label}</span><p>{section.text}</p></article>)}</div> : <div className="mi-transcript-raw"><p>{selected?.originalText || 'No transcript saved.'}</p><small>Ana is preparing transcript labels for this meeting.</small></div>}
    </section>

    <section className="mi-card mi-outputs">
      <div className="mi-card-head"><MessageSquare size={16}/><div><strong>One-click outputs</strong><small>Reuse the meeting without rewriting it yourself.</small></div></div>
      <div className="mi-output-buttons">
        <button onClick={() => generateOutput('email')} disabled={Boolean(outputLoading)}>{outputLoading === 'email' ? <span className="mi-spinner"/> : <Mail size={14}/>} Follow-up email</button>
        <button onClick={() => generateOutput('german')} disabled={Boolean(outputLoading)}>German MOM</button>
        <button onClick={() => generateOutput('customer')} disabled={Boolean(outputLoading)}>Customer-safe</button>
        <button onClick={() => generateOutput('teams')} disabled={Boolean(outputLoading)}>5-line Teams</button>
        <button onClick={() => generateOutput('todo')} disabled={Boolean(outputLoading)}>My to-do list</button>
      </div>
      {output?.text && <div className="mi-output-result"><div><strong>Generated</strong><span><button onClick={copyOutput}><Clipboard size={13}/>{copied ? 'Copied' : 'Copy'}</button>{output.kind === 'email' && <button onClick={() => openMailComposer(true)}><Mail size={13}/>Use in Gmail</button>}</span></div><pre>{output.text}</pre></div>}
    </section>

    <section className="mi-card mi-gmail">
      <div className="mi-card-head mi-between"><div><Mail size={16}/><span><strong>Gmail</strong><small>{gmail.connected ? `Connected as ${gmail.email || 'Google account'}` : 'Send the MOM directly after review.'}</small></span></div>{gmail.connected ? <button className="mi-link-button" onClick={disconnectGmail}>Disconnect</button> : <button className="mi-connect" onClick={connectGmail} disabled={gmail.loading}>{gmail.loading ? 'Checking…' : 'Connect Gmail'}</button>}</div>
      {!gmail.configured && <div className="mi-warning">Google OAuth still needs the production Google client credentials configured before the Connect button can complete.</div>}
      {gmail.error && gmail.configured && <div className="mi-warning">{gmail.error}</div>}
      <button className="mi-email-mom" onClick={() => openMailComposer(false)} disabled={!gmail.connected}><Send size={15}/> Email this MOM</button>
      {mailOpen && <div className="mi-mail-composer">
        <label><span>To</span><input value={mailTo} onChange={event => setMailTo(event.target.value)} placeholder="name@company.com, another@company.com"/></label>
        <label><span>Subject</span><input value={mailSubject} onChange={event => setMailSubject(event.target.value)}/></label>
        <label><span>Message</span><textarea value={mailBody} onChange={event => setMailBody(event.target.value)} rows={12}/></label>
        {mailMessage && <div className="mi-mail-message">{mailMessage}</div>}
        <div className="mi-mail-actions"><button onClick={() => setMailOpen(false)}>Cancel</button><button className="primary" onClick={sendMail} disabled={mailSending}>{mailSending ? 'Sending…' : 'Send with Gmail'}</button></div>
      </div>}
    </section>
  </section>
}
