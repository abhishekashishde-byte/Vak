import { useEffect, useRef, useState } from 'react'
import { Check, Clipboard, Download, Headphones, Mic, MonitorUp, Pause, Play, Square, Trash2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'

const TARGETS = ['English', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const STORAGE_KEY = 'ana-meeting-transcript-v2'

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

  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const streamRef = useRef(null)
  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const targetRef = useRef(target)
  const originalBufferRef = useRef('')
  const translatedBufferRef = useRef('')
  const commitTimerRef = useRef(null)
  const commitWaitsRef = useRef(0)

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

    if (original) setOriginalText(current => appendText(current, original))
    if (translated) setTranslatedText(current => appendText(current, translated))

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
    setSessionState('connecting')
    setPaused(false)
    pausedRef.current = false
    activeRef.current = true
    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    setLiveOriginal('')
    setLiveTranslation('')
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
    setSessionState(startedAt ? 'ended' : 'idle')
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
    setOriginalText('')
    setTranslatedText('')
    setStartedAt(null)
    setElapsed(0)
    setSessionState('idle')
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const copyTranscript = async () => {
    const value = clean(translatedText || originalText)
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const downloadTranscript = () => {
    if (!originalText && !translatedText) return
    const text = `Ana Meeting\nTranslated to: ${target}\n\nTRANSLATION\n${translatedText || '—'}\n\nORIGINAL TRANSCRIPT\n${originalText || '—'}\n`
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

  const currentOriginal = clean(liveOriginal) || (active ? 'Listening for speech…' : '')
  const currentTranslation = clean(liveTranslation)

  return <section className="meeting-wrap meeting-realtime">
    <header className="meeting-head">
      <div className="eyebrow"><Headphones size={14}/> Meeting</div>
      <h1>Hear it now. Understand it now.</h1>
      <p>Ana shows what she hears immediately, then streams the translation as it becomes available. The transcript is saved as continuous text — never as recorder chunks.</p>
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

      <div className={`meeting-live-card ${active ? 'active' : ''}`}>
        <div className="meeting-status-row meeting-live-status">
          <div><i className={active && !paused ? 'on' : ''}/><strong>{statusText}</strong></div>
          <span>{startedAt ? formatTime(elapsed) : '00:00'} · {source === 'screen' ? <><MonitorUp size={13}/> shared audio</> : <><Mic size={13}/> microphone</>}</span>
        </div>

        <div className="meeting-realtime-stack">
          <section className={`meeting-live-translation ${currentTranslation ? 'has-text' : ''}`}>
            <span>Live translation · {target}</span>
            <strong>{currentTranslation || (active && currentOriginal ? 'Translation is catching up…' : active ? 'Translation will appear here as soon as speech is understood.' : 'Start the meeting when you are ready.')}</strong>
          </section>

          <section className="meeting-live-hearing">
            <span>What Ana hears</span>
            <p>{currentOriginal || (originalText ? 'Ready to continue listening.' : 'The live transcription appears here immediately while people speak.')}</p>
          </section>
        </div>

        {error && <div className="error meeting-error">{error}</div>}

        <div className="meeting-controls">
          {!active ? <button className="meeting-start" onClick={startMeeting}><Headphones size={18}/> Start listening</button> : <>
            <button className="meeting-pause" onClick={togglePause}>{paused ? <Play size={17}/> : <Pause size={17}/>} {paused ? 'Resume' : 'Pause'}</button>
            <button className="meeting-stop" onClick={() => stopMeeting(true)}><Square size={16}/> End meeting</button>
          </>}
        </div>
      </div>
    </section>

    <section className="meeting-transcript meeting-continuous">
      <div className="meeting-transcript-head">
        <div><strong>Meeting transcript</strong><span>{originalText || liveOriginal ? 'building continuously as Ana listens' : 'Nothing saved yet'}</span></div>
        <div>
          <button onClick={copyTranscript} disabled={!translatedText && !originalText}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy translation'}</button>
          <button onClick={downloadTranscript} disabled={!translatedText && !originalText}><Download size={15}/> Download</button>
          <button onClick={clearTranscript} disabled={active || (!translatedText && !originalText)}><Trash2 size={15}/> Clear</button>
        </div>
      </div>

      <div className="meeting-continuous-body">
        <section className="meeting-saved-translation">
          <span>{target}</span>
          <p>{appendText(translatedText, liveTranslation) || 'The translated transcript will build here continuously.'}</p>
        </section>
        <section className="meeting-saved-original">
          <span>Original transcript</span>
          <p>{appendText(originalText, liveOriginal) || 'What Ana hears will build here continuously from the first words.'}</p>
        </section>
      </div>
    </section>

    <p className="meeting-footnote">Ana uses a realtime audio connection for the live transcription and translation. Audio itself is not saved by this meeting view; only the text transcript is kept on this device.</p>
  </section>
}
