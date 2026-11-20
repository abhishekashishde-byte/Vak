import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from './lib/supabase.js'

const LAST_WORKSHOP_KEY = 'ana-wani-last-workshop'

async function waniRoute(operation, body = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in to Ana first.')
  const response = await fetch('/api/action-route', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, ...body }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(result?.error || 'Wani request failed'); Object.assign(error, result); throw error }
  return result
}

// Sends the selected meeting's transcript to the user's Wani workshop, ready for analysis there.
export default function SendToWani({ meeting }) {
  const [status, setStatus] = useState({ loading: true, connected: false, keyHint: '' })
  const [key, setKey] = useState('')
  const [workshops, setWorkshops] = useState([])
  const [workshopId, setWorkshopId] = useState(() => { try { return localStorage.getItem(LAST_WORKSHOP_KEY) || '' } catch { return '' } })
  const [retention, setRetention] = useState('30')
  const [busy, setBusy] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(false)
  const [consent, setConsent] = useState(false)
  const [message, setMessage] = useState(null)

  const loadWorkshops = async () => {
    const data = await waniRoute('wani-workshops')
    setWorkshops(data.workshops || [])
    setWorkshopId(current => (data.workshops || []).some(w => w.id === current) ? current : data.workshops?.[0]?.id || '')
  }

  useEffect(() => {
    let alive = true
    waniRoute('wani-status')
      .then(data => { if (!alive) return; setStatus({ loading: false, ...data }); if (data.connected) loadWorkshops().catch(error => setMessage({ error: error.message })) })
      .catch(() => { if (alive) setStatus({ loading: false, connected: false, keyHint: '' }) })
    return () => { alive = false }
  }, [])
  useEffect(() => { setMessage(null); setNeedsConsent(false); setConsent(false) }, [meeting?.id])

  const connect = async () => {
    setBusy(true); setMessage(null)
    try {
      const data = await waniRoute('wani-connect', { key: key.trim() })
      setStatus({ loading: false, connected: true, keyHint: data.keyHint }); setKey('')
      setWorkshops(data.workshops || []); setWorkshopId(data.workshops?.[0]?.id || '')
    } catch (error) { setMessage({ error: error.message }) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true); setMessage(null)
    try { await waniRoute('wani-disconnect'); setStatus({ loading: false, connected: false, keyHint: '' }); setWorkshops([]) } catch (error) { setMessage({ error: error.message }) } finally { setBusy(false) }
  }
  const send = async () => {
    if (!meeting?.id || !workshopId) return
    setBusy(true); setMessage(null)
    const workshop = workshops.find(w => w.id === workshopId)
    try {
      const data = await waniRoute('wani-send', { meetingId: String(meeting.id), workshopId, workshopLabel: workshop?.label || '', retentionDays: Number(retention) || null, consentConfirmed: needsConsent && consent })
      try { localStorage.setItem(LAST_WORKSHOP_KEY, workshopId) } catch {}
      setNeedsConsent(false); setConsent(false)
      setMessage({ ok: data.duplicate ? `Already in Wani (${workshop?.label || 'workshop'}).` : `Sent to ${workshop?.label || 'Wani'}. Open Transcript analysis in Wani to analyse it.`, url: data.waniUrl })
    } catch (error) {
      if (error.needsConsent) setNeedsConsent(true)
      if (error.needsConnection) setStatus({ loading: false, connected: false, keyHint: '' })
      setMessage({ error: error.message })
    } finally { setBusy(false) }
  }

  if (status.loading) return null
  return (
    <section className="mi-card mi-wani">
      <div className="mi-card-head"><Send size={16}/><div><strong>Send to Wani</strong><small>{status.connected ? `Connected (${status.keyHint})` : 'Analyse this meeting in your Wani workshop without copy and paste.'}</small></div></div>
      {!status.connected ? <div className="mi-wani-row">
        <input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Paste the Wani connection key (Wani → Transcript analysis → Send transcripts from Ana)" />
        <button onClick={connect} disabled={busy || !key.trim().startsWith('wani_ak_')}>{busy ? 'Connecting…' : 'Connect'}</button>
      </div> : <>
        <div className="mi-wani-row">
          <select value={workshopId} onChange={event => setWorkshopId(event.target.value)} disabled={busy || !workshops.length} aria-label="Wani workshop">
            {workshops.length ? workshops.map(w => <option key={w.id} value={w.id}>{w.label}</option>) : <option value="">No active workshops in Wani</option>}
          </select>
          <select value={retention} onChange={event => setRetention(event.target.value)} disabled={busy} aria-label="Delete in Wani after">
            <option value="7">Delete in Wani after 7 days</option><option value="30">after 30 days</option><option value="90">after 90 days</option><option value="0">Keep until deleted</option>
          </select>
          <button onClick={send} disabled={busy || !meeting?.id || !workshopId || (needsConsent && !consent)}>{busy ? 'Sending…' : 'Send transcript'}</button>
        </div>
        {needsConsent && <label className="mi-wani-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> All participants agreed to this meeting being recorded and transcribed.</label>}
        <button className="mi-wani-link" onClick={disconnect} disabled={busy}>Disconnect Wani</button>
      </>}
      {message?.error && <div className="mi-warning">{message.error}</div>}
      {message?.ok && <div className="mi-wani-ok">{message.ok}{message.url ? <> <a href={message.url} target="_blank" rel="noreferrer">Open Wani</a></> : null}</div>}
    </section>
  )
}
