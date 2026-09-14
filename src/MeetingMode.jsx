import { useEffect, useRef, useState } from 'react'
import { Check, Clipboard, Download, Headphones, History, Mic, MonitorUp, Pause, Play, Sparkles, Square, Trash2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'
import './meeting-notes.css'

const TARGETS = ['English', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const STORAGE_KEY = 'ana-meeting-transcript-v2'
const HISTORY_KEY = 'ana-meeting-history-v1'

const LANGUAGE_CODES = {
  German: 'de',
  'Swabian German (Schwäbisch)': 'de',
  'Bavarian German (Bairisch)': 'de',
  'Low German (Plattdeutsch)': 'de',
  English: 'en',
  Hindi: 'hi',
  Hinglish: 'hi',
  Bengali: 'bn',
  Tamil: 'ta',
  Telugu: 'te',
  Marathi: 'mr',
  Gujarati: 'gu',
  Punjabi: 'pa',
  Malayalam: 'ml',
  Kannada: 'kn',
  Urdu: 'ur',
  French: 'fr',
  Spanish: 'es',
  Italian: 'it',
}

const clean = value => String(value || '').trim()
const codeFor = target => LANGUAGE_CODES[target] || 'en'
const appendText = (base, next) => [clean(base), clean(next)].filter(Boolean).join(' ').replace(/\s+([,.;!?])/g, '$1').trim()

function readMeetingHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function formatMeetingDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function readSavedMeeting() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function initialTarget() {
  const saved = readSavedMeeting()
  if (TARGETS.includes(saved.target)) return saved.target
  const memory = getPersonalLanguageMemory?.() || {}
  if (TARGETS.includes(memory.lastMeetingTarget)) return memory.lastMeetingTarget
  if (TARGETS.includes(memory.ownerLanguage)) return memory.ownerLanguage
  return 'English'
}

function formatTime(ms = 0) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function MeetingMode() {
  const saved = readSavedMeeting()
  const [target, setTarget] = useState(initialTarget)
  const [source, setSource] = useState('microphone')
  const [sessionState, setSessionState] = useState('idle')
  const [paused, setPaused] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Number(saved.startedAt) || null)
  const [elapsed, setElapsed] = useState(0)
  const [originalText, setOriginalText] = useState(() => clean(saved.originalText))
  const [translatedText, setTranslatedText] = useState(() => clean(saved.translatedText))
  const [liveOriginal, setLiveOriginal] = useState('')
  const [liveTranslation, setLiveTranslation] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [notesStatus, setNotesStatus] = useState('idle')
  const [meetingNotes, setMeetingNotes] = useState(null)
  const [notesError, setNotesError] = useState('')
  const [meetingHistory, setMeetingHistory] = useState(readMeetingHistory)

  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const streamRef = useRef(null)
  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const targetRef = useRef(target)
  const startedAtRef = useRef(Number(saved.startedAt) || 0)
  const originalTextRef = useRef(clean(saved.originalText))
  const translatedTextRef = useRef(clean(saved.translatedText))
  const originalBufferRef = useRef('')
  const translatedBufferRef = useRef('')
  const commitTimerRef = useRef(null)
  const commitWaitsRef = useRef(0)
  const translationPaneRef = useRef(null)
  const hearingPaneRef = useRef(null)

  const active = ['connecting', 'listening', 'recovering'].includes(sessionState) || paused
  const screenSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)

  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000)
    setElapsed(Math.max(0, Date.now() - startedAt))
    return () => clearInterval(timer)
  }, [startedAt])

  useEffect(() => {
    if (!originalText && !translatedText) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ target, startedAt, originalText, translatedText, updatedAt: Date.now() }))
    } catch {}
  }, [target, startedAt, originalText, translatedText])

  useEffect(() => { originalTextRef.current = originalText }, [originalText])
  useEffect(() => { translatedTextRef.current = translatedText }, [translatedText])
  useEffect(() => { startedAtRef.current = startedAt || 0 }, [startedAt])

  useEffect(() => {
    const node = translationPaneRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [translatedText, liveTranslation])

  useEffect(() => {
    const node = hearingPaneRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [originalText, liveOriginal])

  useEffect(() => () => stopMeeting(false), [])

  const setTrackEnabled = enabled => {
    streamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const sendRealtime = event => {
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event))
  }

  const clearCommitTimer = () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current)
    commitTimerRef.current = null
  }

  const commitCurrentSpeech = (force = false) => {
    clearCommitTimer()
    const original = clean(originalBufferRef.current)
    const translated = clean(translatedBufferRef.current)

    if (!original && !translated) return

    if (!force && original && !translated && commitWaitsRef.current < 3) {
      commitWaitsRef.current += 1
      commitTimerRef.current = setTimeout(() => commitCurrentSpeech(false), 650)
      return
    }

    if (original) { const value=appendText(originalTextRef.current, original); originalTextRef.current=value; setOriginalText(value) }
    if (translated) { const value=appendText(translatedTextRef.current, translated); translatedTextRef.current=value; setTranslatedText(value) }

    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    commitWaitsRef.current = 0
    setLiveOriginal('')
    setLiveTranslation('')
  }

  const scheduleCommit = () => {
    clearCommitTimer()
    commitWaitsRef.current = 0
    commitTimerRef.current = setTimeout(() => commitCurrentSpeech(false), 1500)
  }

  const handleRealtimeEvent = event => {
    if (pausedRef.current) return

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const delta = String(event.delta || '')
        if (!delta) break
        originalBufferRef.current += delta
        setLiveOriginal(originalBufferRef.current)
        scheduleCommit()
        break
      }
      case 'session.output_transcript.delta': {
        const delta = String(event.delta || '')
        if (!delta) break
        translatedBufferRef.current += delta
        setLiveTranslation(translatedBufferRef.current)
        scheduleCommit()
        break
      }
      case 'session.input_transcript.done':
      case 'session.output_transcript.done':
        scheduleCommit()
        break
      case 'session.closed':
        if (activeRef.current) stopMeeting(true)
        break
      case 'error':
      case 'session.error':
        setError(event.error?.message || 'Live meeting translation was interrupted.')
        break
      default:
        break
    }
  }

  const getMeetingStream = async () => {
    if (source === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Computer audio sharing is not supported in this browser.')
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const audioTrack = stream.getAudioTracks?.()[0]
      if (!audioTrack) {
        stream.getTracks().forEach(track => track.stop())
        throw new Error('No computer audio was shared. Choose a tab/window/screen with audio enabled, or use Microphone / speakers.')
      }
      return stream
    }

    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  const startMeeting = async () => {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setError('Live Meeting is not supported in this browser.')
      return
    }

    setError('')
    setNotesError('')
    setMeetingNotes(null)
    setNotesStatus('idle')
    setSessionState('connecting')
    setPaused(false)
    pausedRef.current = false
    activeRef.current = true
    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    setLiveOriginal('')
    setLiveTranslation('')
    originalTextRef.current = ''
    translatedTextRef.current = ''
    setOriginalText('')
    setTranslatedText('')
    try { localStorage.removeItem(STORAGE_KEY) } catch {}

    try {
      const stream = await getMeetingStream()
      streamRef.current = stream
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (activeRef.current) stopMeeting(true)
        }, { once: true })
      })

      const tokenResponse = await fetch('/api/realtime-translation-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage: codeFor(targetRef.current) }),
      })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start realtime meeting translation.')

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      const audioTrack = stream.getAudioTracks()[0]
      pc.addTrack(audioTrack, stream)
      pc.ontrack = () => {}

      pc.addEventListener('connectionstatechange', () => {
        if (!activeRef.current) return
        if (pc.connectionState === 'connected') setSessionState(pausedRef.current ? 'paused' : 'listening')
        else if (['disconnected', 'connecting'].includes(pc.connectionState)) setSessionState('recovering')
        else if (['failed', 'closed'].includes(pc.connectionState)) {
          setError('The live meeting connection ended. Start again to continue.')
          stopMeeting(true)
        }
      })

      const channel = pc.createDataChannel('oai-events')
      dataChannelRef.current = channel
      channel.addEventListener('message', message => {
        try { handleRealtimeEvent(JSON.parse(message.data)) } catch {}
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenData.value}`,
          'Content-Type': 'application/sdp',
        },
      })
      const answerSdp = await sdpResponse.text()
      if (!sdpResponse.ok) throw new Error(answerSdp || 'Could not connect live meeting translation.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      await new Promise((resolve, reject) => {
        if (channel.readyState === 'open') return resolve()
        const timer = setTimeout(() => reject(new Error('Live meeting connection timed out.')), 10000)
        channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Live meeting could not connect.')) }, { once: true })
      })

      const now = Date.now()
      startedAtRef.current = now
      setStartedAt(now)
      setElapsed(0)
      setSessionState('listening')
    } catch (err) {
      setError(err.message || 'Ana could not start listening to the meeting.')
      stopMeeting(false)
    }
  }

  function stopMeeting(saveLive = true) {
    activeRef.current = false
    pausedRef.current = false
    clearCommitTimer()
    if (saveLive) commitCurrentSpeech(true)
    try { dataChannelRef.current?.close() } catch {}
    dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    setPaused(false)
    setSessionState(startedAtRef.current ? 'ended' : 'idle')
  }

  const saveMeetingRecord = record => {
    const next = [record, ...readMeetingHistory().filter(item => item?.id !== record.id)].slice(0, 50)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
    setMeetingHistory(next)
  }

  const generateMeetingNotes = async ({ transcript, translation, start, end }) => {
    const outputLanguage = targetRef.current
    setNotesStatus('preparing')
    setNotesError('')
    const instructions = 'Create concise post-meeting notes from this transcript. Write in ' + outputLanguage + '. Return JSON only with title, summary, keyPoints, decisions, actions, openQuestions. Each action must contain task, owner and deadline. Never invent owners, deadlines, facts or decisions; use empty strings when owner or deadline was not stated. Derive the title from the meeting topic.'
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript, instructions }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not prepare meeting notes.')
      const raw = String(data?.content || '').replace(/```json|```/g, '').trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      const notes = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw)
      const record = {
        id: (start || Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
        title: clean(notes?.title) || 'Meeting',
        startedAt: start || end,
        endedAt: end,
        durationMs: Math.max(0, end - (start || end)),
        target: outputLanguage,
        notes,
        originalText: transcript,
        translatedText: translation,
      }
      setMeetingNotes(record)
      saveMeetingRecord(record)
      setNotesStatus('ready')
    } catch (err) {
      const record = {
        id: (start || Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
        title: 'Meeting · ' + formatMeetingDate(start || end),
        startedAt: start || end,
        endedAt: end,
        durationMs: Math.max(0, end - (start || end)),
        target: outputLanguage,
        notes: null,
        originalText: transcript,
        translatedText: translation,
      }
      saveMeetingRecord(record)
      setNotesError(err.message || 'The transcript was saved, but Ana could not create notes.')
      setNotesStatus('error')
    }
  }

  const endMeeting = async () => {
    if (!activeRef.current) return
    const finalOriginal = appendText(originalTextRef.current, originalBufferRef.current)
    const finalTranslation = appendText(translatedTextRef.current, translatedBufferRef.current)
    const start = startedAtRef.current || Date.now()
    const end = Date.now()
    setOriginalText(finalOriginal)
    setTranslatedText(finalTranslation)
    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    setLiveOriginal('')
    setLiveTranslation('')
    stopMeeting(false)
    setSessionState('ended')
    if (finalOriginal.length >= 20) await generateMeetingNotes({ transcript: finalOriginal, translation: finalTranslation, start, end })
    else {
      setNotesStatus('error')
      setNotesError('Not enough speech was captured to create meeting notes.')
    }
  }

  const togglePause = () => {
    if (!activeRef.current) return
    const next = !pausedRef.current
    if (next) commitCurrentSpeech(true)
    pausedRef.current = next
    setPaused(next)
    setTrackEnabled(!next)
    setSessionState(next ? 'paused' : 'listening')
  }

  const changeTarget = value => {
    if (activeRef.current) commitCurrentSpeech(true)
    targetRef.current = value
    setTarget(value)
    rememberPersonalLanguagePreference?.({ lastMeetingTarget: value })
    if (activeRef.current) {
      sendRealtime({
        type: 'session.update',
        session: { audio: { output: { language: codeFor(value) } } },
      })
    }
  }

  const clearTranscript = () => {
    if (activeRef.current) return
    originalTextRef.current = ''
    translatedTextRef.current = ''
    startedAtRef.current = 0
    setOriginalText('')
    setTranslatedText('')
    setMeetingNotes(null)
    setNotesStatus('idle')
    setNotesError('')
    setStartedAt(null)
    setElapsed(0)
    setSessionState('idle')
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const fullOriginal = appendText(originalText, liveOriginal)
  const fullTranslation = appendText(translatedText, liveTranslation)

  const copyTranscript = async () => {
    const value = clean(fullTranslation || fullOriginal)
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const downloadTranscript = () => {
    if (!fullOriginal && !fullTranslation) return
    const text = `Ana Meeting\nTranslated to: ${target}\n\nTRANSLATION\n${fullTranslation || '—'}\n\nANA HEARS\n${fullOriginal || '—'}\n`
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ana-meeting-${new Date(startedAt || Date.now()).toISOString().slice(0, 10)}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const statusText = sessionState === 'connecting' ? 'Connecting…'
    : sessionState === 'recovering' ? 'Reconnecting…'
      : paused ? 'Paused'
        : active ? 'Ana is listening now' : sessionState === 'ended' ? 'Meeting ended' : 'Ready'

  return <section className="meeting-wrap meeting-realtime">
    <header className="meeting-head">
      <div className="eyebrow"><Headphones size={14}/> Meeting</div>
      <h1>Hear it now. Understand it now.</h1>
      <p>One live screen: the translation stays on top and everything Ana hears builds continuously underneath it.</p>
    </header>

    <section className="meeting-setup">
      <div className="meeting-toolbar">
        <label>
          <span>Listen to</span>
          <select value={source} onChange={event => setSource(event.target.value)} disabled={active}>
            <option value="microphone">Microphone / speakers</option>
            {screenSupported && <option value="screen">Computer / tab audio</option>}
          </select>
        </label>
        <label>
          <span>Translate to</span>
          <select value={target} onChange={event => changeTarget(event.target.value)}>
            {TARGETS.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <div className={`meeting-single-card ${active ? 'active' : ''}`}>
        <div className="meeting-status-row meeting-live-status">
          <div><i className={active && !paused ? 'on' : ''}/><strong>{statusText}</strong></div>
          <span>{startedAt ? formatTime(elapsed) : '00:00'} · {source === 'screen' ? <><MonitorUp size={13}/> shared audio</> : <><Mic size={13}/> microphone</>}</span>
        </div>

        <div className="meeting-single-screen">
          <section className="meeting-complete-translation">
            <div className="meeting-screen-label"><span>Translation · {target}</span>{active && liveOriginal && !liveTranslation ? <em>catching up…</em> : null}</div>
            <div ref={translationPaneRef} className="meeting-screen-scroll meeting-translation-scroll">
              <p>{fullTranslation || (active ? 'Translation will appear here as soon as Ana understands the speech.' : 'Your translated meeting will appear here.')}</p>
            </div>
          </section>

          <section className="meeting-complete-hearing">
            <div className="meeting-screen-label"><span>What Ana hears</span>{active && !paused ? <em className="meeting-hearing-live">● live</em> : null}</div>
            <div ref={hearingPaneRef} className="meeting-screen-scroll meeting-hearing-scroll">
              <p>{fullOriginal || (active ? 'Listening for speech…' : 'Start listening and the transcription will appear here immediately.')}</p>
            </div>
          </section>
        </div>

        {error && <div className="error meeting-error">{error}</div>}

        <div className="meeting-single-footer">
          <div className="meeting-controls">
            {!active ? <button className="meeting-start" onClick={startMeeting}><Headphones size={18}/> Start listening</button> : <>
              <button className="meeting-pause" onClick={togglePause}>{paused ? <Play size={17}/> : <Pause size={17}/>} {paused ? 'Resume' : 'Pause'}</button>
              <button className="meeting-stop" onClick={endMeeting}><Square size={16}/> End meeting</button>
            </>}
          </div>

          <div className="meeting-transcript-actions meeting-single-actions">
            <button onClick={copyTranscript} disabled={!fullTranslation && !fullOriginal}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy'}</button>
            <button onClick={downloadTranscript} disabled={!fullTranslation && !fullOriginal}><Download size={15}/> Download</button>
            <button onClick={clearTranscript} disabled={active || (!fullTranslation && !fullOriginal)}><Trash2 size={15}/> Clear</button>
          </div>
        </div>
      </div>
    </section>

    {(notesStatus !== 'idle' || meetingNotes) && <section className="meeting-notes-card">
      <div className="meeting-notes-head"><div><Sparkles size={16}/><h2>After the meeting</h2></div><span>Created once when you end the meeting</span></div>
      {notesStatus === 'preparing' && <div className="meeting-notes-loading"><i/>Ana is preparing the meeting title, summary, key points and actions…</div>}
      {meetingNotes?.notes && <div className="meeting-notes-body">
        <h2 className="meeting-notes-title">{meetingNotes.title}</h2>
        <div className="meeting-notes-meta">{formatMeetingDate(meetingNotes.startedAt)} · {formatTime(meetingNotes.durationMs)} · {meetingNotes.target}</div>
        {meetingNotes.notes.summary && <section className="meeting-notes-section"><h3>Summary</h3><p>{meetingNotes.notes.summary}</p></section>}
        {!!meetingNotes.notes.keyPoints?.length && <section className="meeting-notes-section"><h3>Key points</h3><ul>{meetingNotes.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {!!meetingNotes.notes.decisions?.length && <section className="meeting-notes-section"><h3>Decisions</h3><ul>{meetingNotes.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {!!meetingNotes.notes.actions?.length && <section className="meeting-notes-section"><h3>To-do / actions</h3><div className="meeting-action-list">{meetingNotes.notes.actions.map((item,index)=><div className="meeting-action" key={index}><strong>{typeof item==='string'?item:item?.task}</strong>{typeof item!=='string'&&(item?.owner||item?.deadline)&&<small>{item?.owner?'Owner: '+item.owner:'Owner: not specified'}{item?.deadline?' · Deadline: '+item.deadline:''}</small>}</div>)}</div></section>}
        {!!meetingNotes.notes.openQuestions?.length && <section className="meeting-notes-section"><h3>Open questions</h3><ul>{meetingNotes.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
      </div>}
      {notesError && <div className="meeting-notes-error">{notesError}</div>}
    </section>}

    {!!meetingHistory.length && <section className="meeting-history">
      <div className="meeting-history-head"><div><History size={16}/><h2>Meeting history</h2></div><span>{meetingHistory.length} saved</span></div>
      <div className="meeting-history-list">{meetingHistory.map(record=><details className="meeting-history-item" key={record.id}><summary><div className="meeting-history-summary"><strong>{record.title||'Meeting'}</strong><span>{formatMeetingDate(record.startedAt)} · {formatTime(record.durationMs||0)}</span></div><span>{record.target}</span></summary><div className="meeting-history-detail">{record.notes?.summary&&<div><h4>Summary</h4><p>{record.notes.summary}</p></div>}{!!record.notes?.keyPoints?.length&&<div><h4>Key points</h4><ul>{record.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.decisions?.length&&<div><h4>Decisions</h4><ul>{record.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.actions?.length&&<div><h4>To-do / actions</h4><ul>{record.notes.actions.map((item,index)=><li key={index}>{typeof item==='string'?item:[item?.task,item?.owner?'Owner: '+item.owner:'',item?.deadline?'Deadline: '+item.deadline:''].filter(Boolean).join(' · ')}</li>)}</ul></div>}{!!record.notes?.openQuestions?.length&&<div><h4>Open questions</h4><ul>{record.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}<div className="meeting-history-transcripts"><details><summary>Translated transcript</summary><p>{record.translatedText||'—'}</p></details><details><summary>Original transcript</summary><p>{record.originalText||'—'}</p></details></div></div></details>)}</div>
    </section>}

    <p className="meeting-footnote">During the meeting Ana only listens, transcribes and translates. When you press End meeting, Ana uses the original transcript once to create the meeting title, summary, key points, decisions, actions and open questions, then saves the complete record in Meeting History on this device.</p>
  </section>
}