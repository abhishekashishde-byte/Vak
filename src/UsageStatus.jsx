import { useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import { ANA_ADMIN_EMAIL, getQuotaStatus, testerLimitLabel } from './usageQuota.js'
import './usage-status.css'

const dateText = value => {
  if (!value) return 'Never'
  try { return new Date(value).toLocaleString() } catch { return String(value) }
}
const duration = seconds => {
  const mins = Math.max(0, Math.round(Number(seconds || 0) / 60))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export default function UsageStatus() {
  const [status, setStatus] = useState(null)
  const [email, setEmail] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminRows, setAdminRows] = useState([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')

  const load = async () => {
    try {
      const [{ data: userData }, next] = await Promise.all([
        supabase?.auth.getUser?.() || Promise.resolve({ data: {} }),
        getQuotaStatus(),
      ])
      setEmail(String(userData?.user?.email || '').toLowerCase())
      setStatus(next)
    } catch {}
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    const onUpdate = event => event?.detail ? setStatus(event.detail) : load()
    window.addEventListener('ana-usage-updated', onUpdate)
    return () => {
      clearInterval(timer)
      window.removeEventListener('ana-usage-updated', onUpdate)
    }
  }, [])

  const isAdmin = Boolean(status?.isAdmin || email === ANA_ADMIN_EMAIL)
  const reset = useMemo(() => status?.weekEnd ? new Date(status.weekEnd).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' }) : '', [status?.weekEnd])

  const loadAdmin = async () => {
    if (!supabase || !isAdmin) return
    setAdminLoading(true); setAdminError('')
    try {
      const { data, error } = await supabase.rpc('ana_admin_user_usage')
      if (error) throw error
      setAdminRows(Array.isArray(data) ? data : [])
    } catch (error) {
      setAdminError(error?.message || 'Could not load tester activity.')
    } finally {
      setAdminLoading(false)
    }
  }

  const openAdmin = () => {
    setAdminOpen(true)
    loadAdmin()
  }

  if (!status) return null

  return <>
    <section className="ana-usage-strip" aria-label="Weekly tester allowance">
      <div className="ana-usage-title"><ShieldCheck size={14}/><span>{isAdmin ? 'Admin · unlimited' : 'Tester allowance'}</span>{!isAdmin && reset && <small>resets {reset}</small>}</div>
      {isAdmin ? <div className="ana-admin-unlimited">Tester limits do not apply to this admin account.</div> : <div className="ana-usage-items">
        <UsageItem label="Meeting notes" remaining={status.meetingNotes?.remainingSeconds} total={status.meetingNotes?.limitSeconds} />
        <UsageItem label="Live meeting" remaining={status.meetingLive?.remainingSeconds} total={status.meetingLive?.limitSeconds} />
        <UsageItem label="Talk for me" remaining={status.talk?.remainingSeconds} total={status.talk?.limitSeconds} />
        <div className="ana-usage-item"><span>Documents</span><strong>{Math.max(0,Number(status.documents?.remaining || 0))}/{Number(status.documents?.limit || 3)} left</strong></div>
      </div>}
      {isAdmin && <button className="ana-admin-open" type="button" onClick={openAdmin}><BarChart3 size={14}/> Admin</button>}
    </section>

    {adminOpen && <div className="ana-admin-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAdminOpen(false) }}>
      <section className="ana-admin-panel" role="dialog" aria-modal="true" aria-label="Ana tester admin">
        <header>
          <div><strong>Ana tester admin</strong><span>{adminRows.length} registered user{adminRows.length === 1 ? '' : 's'}</span></div>
          <div><button type="button" onClick={loadAdmin} disabled={adminLoading}><RefreshCw size={15}/></button><button type="button" onClick={() => setAdminOpen(false)}><X size={17}/></button></div>
        </header>
        <div className="ana-admin-summary">
          <div><strong>{adminRows.filter(row => row.has_logged_in).length}</strong><span>Logged in</span></div>
          <div><strong>{adminRows.filter(row => !row.has_logged_in).length}</strong><span>Never logged in</span></div>
          <div><strong>{duration(adminRows.reduce((sum,row)=>sum+Number(row.week_meeting_notes_seconds||0)+Number(row.week_live_seconds||0),0))}</strong><span>Meeting use this week</span></div>
          <div><strong>{adminRows.reduce((sum,row)=>sum+Number(row.week_documents||0),0)}</strong><span>Documents this week</span></div>
        </div>
        {adminError && <div className="ana-admin-error">{adminError}</div>}
        <div className="ana-admin-table-wrap">
          <table className="ana-admin-table">
            <thead><tr><th>User</th><th>Last login</th><th>This week</th><th>Tracked total</th></tr></thead>
            <tbody>
              {adminRows.map(row => <tr key={row.user_id}>
                <td><strong>{row.name || row.email}</strong><span>{row.email}</span>{row.location && <small>{row.location}</small>}</td>
                <td><strong>{row.has_logged_in ? dateText(row.last_sign_in_at) : 'Never'}</strong><span>Last limited use: {dateText(row.last_usage_at)}</span><small>Joined {dateText(row.created_at)}</small></td>
                <td>
                  <span>MOM {duration(row.week_meeting_notes_seconds)}</span>
                  <span>Live {duration(row.week_live_seconds)}</span>
                  <span>Talk {duration(row.week_talk_seconds)}</span>
                  <span>Docs {Number(row.week_documents||0)}/3</span>
                </td>
                <td>
                  <span>Timed {duration(Number(row.total_meeting_seconds||0)+Number(row.total_talk_seconds||0))}</span>
                  <span>Docs {Number(row.total_documents||0)}</span>
                  <span>Historical meetings {duration(row.historical_meeting_seconds)}</span>
                </td>
              </tr>)}
              {!adminRows.length && !adminLoading && <tr><td colSpan="4">No registered testers found.</td></tr>}
            </tbody>
          </table>
        </div>
        {adminLoading && <div className="ana-admin-loading">Refreshing tester activity…</div>}
      </section>
    </div>}
  </>
}

function UsageItem({ label, remaining, total }) {
  const left = Math.max(0,Number(remaining || 0))
  const max = Math.max(1,Number(total || 1))
  const percent = Math.max(0,Math.min(100,left/max*100))
  return <div className="ana-usage-item">
    <span>{label}</span>
    <strong>{testerLimitLabel(left)} left</strong>
    <i><b style={{width:`${percent}%`}}/></i>
  </div>
}
