import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Unplug, Video } from 'lucide-react'
import './zoom-integration.css'

function formatMeetingStart(value) {
  if (!value) return 'Time not set'
  try {
    return new Date(value).toLocaleString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export default function ZoomMeetingConnector({ disabled = false, onUseMeeting }) {
  const [status, setStatus] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [meetings, setMeetings] = useState([])
  const [loadingMeetings, setLoadingMeetings] = useState(false)
  const [error, setError] = useState('')
  const [preparedId, setPreparedId] = useState('')

  const zoomMessage = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      return params.get('zoom_message') || ''
    } catch {
      return ''
    }
  }, [])

  const loadMeetings = async () => {
    setLoadingMeetings(true)
    setError('')
    try {
      const response = await fetch('/api/zoom/meetings', { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load Zoom meetings.')
      setMeetings(Array.isArray(data?.meetings) ? data.meetings : [])
    } catch (err) {
      setError(err.message || 'Could not load Zoom meetings.')
    } finally {
      setLoadingMeetings(false)
    }
  }

  const loadStatus = async () => {
    setStatus('loading')
    setError('')
    try {
      const response = await fetch('/api/zoom/status', { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not check Zoom connection.')
      if (!data?.connected) {
        setStatus('disconnected')
        setProfile(null)
        setMeetings([])
        if (data?.error) setError(data.error)
        return
      }
      setStatus('connected')
      setProfile(data.profile || null)
      await loadMeetings()
    } catch (err) {
      setStatus('disconnected')
      setError(err.message || 'Could not check Zoom connection.')
    }
  }

  useEffect(() => {
    loadStatus()
    if (zoomMessage) setError(zoomMessage)
  }, [zoomMessage])

  const connectZoom = () => {
    window.location.assign('/api/zoom/connect')
  }

  const disconnectZoom = async () => {
    setError('')
    try {
      await fetch('/api/zoom/disconnect', { method: 'POST', credentials: 'include' })
    } finally {
      setStatus('disconnected')
      setProfile(null)
      setMeetings([])
      setPreparedId('')
    }
  }

  const useMeeting = meeting => {
    setPreparedId(meeting.id)
    onUseMeeting?.(meeting)
  }

  const openMeeting = meeting => {
    if (!meeting?.joinUrl) return
    window.open(meeting.joinUrl, '_blank', 'noopener,noreferrer')
  }

  return <section className="zoom-connector" aria-label="Zoom integration">
    <div className="zoom-connector-head">
      <div className="zoom-brand-mark"><Video size={19}/></div>
      <div>
        <span className="zoom-kicker">Zoom</span>
        <h2>Bring your Zoom meeting into Ana</h2>
        <p>Connect once, pick a meeting, then let Ana translate, build the transcript and prepare MOMs and to-dos.</p>
      </div>
      {status === 'connected' && <span className="zoom-connected-pill"><CheckCircle2 size={14}/> Connected</span>}
    </div>

    {status === 'loading' && <div className="zoom-loading"><LoaderCircle size={16}/> Checking Zoom connection…</div>}

    {status === 'disconnected' && <div className="zoom-connect-row">
      <div>
        <strong>Connect your Zoom account</strong>
        <span>Ana only asks Zoom for the meeting information required for this integration.</span>
      </div>
      <button type="button" className="zoom-primary" onClick={connectZoom} disabled={disabled}>Connect Zoom</button>
    </div>}

    {status === 'connected' && <>
      <div className="zoom-account-row">
        <div>
          <strong>{profile?.name || 'Zoom connected'}</strong>
          {profile?.email && <span>{profile.email}</span>}
        </div>
        <div className="zoom-account-actions">
          <button type="button" onClick={loadMeetings} disabled={disabled || loadingMeetings}><RefreshCw size={14}/> Refresh</button>
          <button type="button" onClick={disconnectZoom} disabled={disabled}><Unplug size={14}/> Disconnect</button>
        </div>
      </div>

      <div className="zoom-meeting-list">
        {loadingMeetings && <div className="zoom-loading"><LoaderCircle size={16}/> Loading upcoming meetings…</div>}
        {!loadingMeetings && !meetings.length && <div className="zoom-empty"><CalendarDays size={18}/><span>No upcoming hosted Zoom meetings were found.</span></div>}
        {!loadingMeetings && meetings.map(meeting => <article className={`zoom-meeting-item ${preparedId === meeting.id ? 'prepared' : ''}`} key={meeting.uuid || meeting.id}>
          <div className="zoom-meeting-copy">
            <strong>{meeting.topic || 'Zoom meeting'}</strong>
            <span>{formatMeetingStart(meeting.startTime)}{meeting.duration ? ` · ${meeting.duration} min` : ''}</span>
          </div>
          <div className="zoom-meeting-actions">
            <button type="button" className="zoom-use" onClick={() => useMeeting(meeting)} disabled={disabled}>{preparedId === meeting.id ? <CheckCircle2 size={15}/> : <Video size={15}/>} {preparedId === meeting.id ? 'Ready in Ana' : 'Use with Ana'}</button>
            {meeting.joinUrl && <button type="button" onClick={() => openMeeting(meeting)}><ExternalLink size={14}/> Open Zoom</button>}
          </div>
          {preparedId === meeting.id && <p className="zoom-ready-note">Open the meeting in your browser. Then press <strong>Start listening</strong> below and share the Zoom tab with audio when your browser asks.</p>}
        </article>)}
      </div>
    </>}

    {error && <div className="zoom-error">{error}</div>}

    <p className="zoom-privacy-note">Version 1 uses Zoom account connection for meeting selection and Ana's existing browser audio capture for the live translation. Native Zoom RTMS streaming can be added after RTMS credentials and Developer Pack access are configured.</p>
  </section>
}
