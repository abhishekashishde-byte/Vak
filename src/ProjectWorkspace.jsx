import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, CircleAlert, FolderKanban, ListTodo, MessagesSquare } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import './project-workspace.css'

const clean = value => String(value || '').trim()
const safeArray = value => Array.isArray(value) ? value : []

function meta(record) {
  return record?.notes?._ana?.metadata || {}
}

function textList(value) {
  return safeArray(value).map(clean).filter(Boolean)
}

function sectionValues(notes, names) {
  const wanted = names.map(name => name.toLocaleLowerCase())
  const sources = [
    ...safeArray(notes?.sections),
    ...safeArray(notes?.customSections),
  ]
  return sources.flatMap(section => {
    const title = clean(section?.title || section?.name).toLocaleLowerCase()
    if (!wanted.some(name => title.includes(name))) return []
    const body = section?.items ?? section?.content ?? section?.text
    return Array.isArray(body) ? body.map(clean).filter(Boolean) : clean(body) ? [clean(body)] : []
  })
}

export default function ProjectWorkspace() {
  const [meetings, setMeetings] = useState([])
  const [actions, setActions] = useState([])
  const [glossary, setGlossary] = useState([])
  const [scopeType, setScopeType] = useState('project')
  const [scopeValue, setScopeValue] = useState('')

  const refresh = async () => {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) return
    const [{ data: meetingRows }, { data: actionRows }, { data: glossaryRows }] = await Promise.all([
      supabase.from('meeting_records').select('client_id,title,started_at,notes').eq('user_id', user.id).order('started_at', { ascending: false }).limit(200),
      supabase.from('meeting_actions').select('id,meeting_client_id,task,owner,deadline,status').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(500),
      supabase.from('glossary_entries').select('client_id,target,source,preferred,scope,context,rule').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(300),
    ])
    setMeetings(safeArray(meetingRows))
    setActions(safeArray(actionRows))
    setGlossary(safeArray(glossaryRows))
  }

  useEffect(() => {
    refresh()
    const onRefresh = () => refresh()
    window.addEventListener('ana-actions-changed', onRefresh)
    const timer = setInterval(refresh, 7000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('ana-actions-changed', onRefresh)
    }
  }, [])

  const projects = useMemo(() => [...new Set(meetings.map(record => clean(meta(record).project)).filter(Boolean))].sort(), [meetings])
  const customers = useMemo(() => [...new Set(meetings.map(record => clean(meta(record).customer)).filter(Boolean))].sort(), [meetings])
  const choices = scopeType === 'project' ? projects : customers

  useEffect(() => {
    if (scopeValue && choices.includes(scopeValue)) return
    setScopeValue(choices[0] || '')
  }, [scopeType, projects.join('|'), customers.join('|')])

  const scopedMeetings = useMemo(() => meetings.filter(record => {
    const data = meta(record)
    return scopeType === 'project'
      ? clean(data.project) === scopeValue
      : clean(data.customer) === scopeValue
  }), [meetings, scopeType, scopeValue])

  const scopedIds = useMemo(() => new Set(scopedMeetings.map(record => String(record.client_id))), [scopedMeetings])
  const scopedActions = useMemo(() => actions.filter(item => scopedIds.has(String(item.meeting_client_id))), [actions, scopedIds])

  const decisions = useMemo(() => scopedMeetings.flatMap(record => textList(record?.notes?.decisions)).slice(0, 30), [scopedMeetings])
  const risks = useMemo(() => scopedMeetings.flatMap(record => textList(record?.notes?.risks)).slice(0, 30), [scopedMeetings])
  const questions = useMemo(() => scopedMeetings.flatMap(record => textList(record?.notes?.openQuestions)).slice(0, 30), [scopedMeetings])
  const requirements = useMemo(() => scopedMeetings.flatMap(record => {
    const notes = record?.notes || {}
    return [
      ...textList(notes.customerRequirements),
      ...textList(notes.requirements),
      ...sectionValues(notes, ['customer requirements', 'requirements', 'business requirement']),
    ]
  }).filter(Boolean).slice(0, 30), [scopedMeetings])

  const scopedGlossary = useMemo(() => glossary.filter(item => {
    if (item.scope === 'personal') return false
    if (item.scope === 'company') return scopeType === 'customer' && clean(item.context).toLocaleLowerCase() === scopeValue.toLocaleLowerCase()
    if (item.scope === 'project') return scopeType === 'project' && clean(item.context).toLocaleLowerCase() === scopeValue.toLocaleLowerCase()
    return false
  }), [glossary, scopeType, scopeValue])

  if (!choices.length) return null

  const openActions = scopedActions.filter(item => item.status !== 'done')

  return <section className="project-workspace">
    <div className="project-workspace-head">
      <div><FolderKanban size={18}/><div><h2>Project / Customer workspace</h2><p>One durable view across meetings, terminology and follow-up.</p></div></div>
      <div className="project-workspace-picker">
        <select value={scopeType} onChange={event=>setScopeType(event.target.value)}><option value="project">Project</option><option value="customer">Customer</option></select>
        <select value={scopeValue} onChange={event=>setScopeValue(event.target.value)}>{choices.map(value=><option key={value}>{value}</option>)}</select>
      </div>
    </div>

    <div className="project-workspace-stats">
      <div><strong>{scopedMeetings.length}</strong><span>Meetings</span></div>
      <div><strong>{decisions.length}</strong><span>Decisions</span></div>
      <div><strong>{openActions.length}</strong><span>Open actions</span></div>
      <div><strong>{risks.length}</strong><span>Risks</span></div>
      <div><strong>{scopedGlossary.length}</strong><span>Shared terms</span></div>
    </div>

    <div className="project-workspace-grid">
      <article><div className="pw-card-head"><CheckCircle2 size={14}/><strong>Decisions</strong></div>{decisions.length ? decisions.slice(0,10).map((item,index)=><p key={index}>{item}</p>) : <small>No extracted decisions yet.</small>}</article>
      <article><div className="pw-card-head"><BookOpen size={14}/><strong>Requirements</strong></div>{requirements.length ? requirements.slice(0,10).map((item,index)=><p key={index}>{item}</p>) : <small>No structured requirements yet.</small>}</article>
      <article><div className="pw-card-head"><CircleAlert size={14}/><strong>Risks & open questions</strong></div>{[...risks,...questions].length ? [...risks,...questions].slice(0,10).map((item,index)=><p key={index}>{item}</p>) : <small>No open risks/questions.</small>}</article>
      <article><div className="pw-card-head"><ListTodo size={14}/><strong>Open actions</strong></div>{openActions.length ? openActions.slice(0,10).map(item=><p key={item.id}>{item.task}{item.owner ? ` · ${item.owner}` : ''}{item.deadline ? ` · ${item.deadline}` : ''}</p>) : <small>No open actions.</small>}</article>
      <article className="pw-meetings"><div className="pw-card-head"><MessagesSquare size={14}/><strong>Recent meetings</strong></div>{scopedMeetings.slice(0,8).map(record=><button key={record.client_id} onClick={()=>window.dispatchEvent(new CustomEvent('ana-open-meeting',{detail:{id:String(record.client_id)}}))}><strong>{record.title || 'Meeting'}</strong><span>{record.started_at ? new Date(record.started_at).toLocaleDateString() : ''}</span></button>)}</article>
      <article className="pw-glossary"><div className="pw-card-head"><BookOpen size={14}/><strong>Shared glossary</strong></div>{scopedGlossary.length ? scopedGlossary.slice(0,12).map(item=><p key={item.client_id}><b>{item.source}</b><span>{item.rule === 'locked' ? 'keep exactly' : item.preferred}</span></p>) : <small>No scoped glossary terms yet.</small>}</article>
    </div>
  </section>
}
