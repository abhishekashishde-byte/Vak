import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Download, Headphones, Pause, Play, Square, Trash2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'

const TARGETS = ['English', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const STORAGE_KEY = 'ana-meeting-transcript-v1'
const SEGMENT_MS = 4000

const clean = value => String(value || '').trim()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || ''
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const size = 0x8000
  for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size))
  return btoa(binary)
}

async function sendSegment(blob, target) {
  const audio = bufferToBase64(await blob.arrayBuffer())
  const response = await fetch('/api/meeting-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm', target }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not translate this meeting segment.')
  return { transcript: clean(data.transcript), translation: clean(data.translation) }
}

export default function MeetingMode() {
  const saved = useMemo(() => readSavedMeeting(), [])
  const [target, setTarget] = useState(initialTarget)
  const [source, setSource] = useState('microphone')
  const [status, setStatus] = useState('idle')
  const [entries, setEntries] = useState(() => Array.isArray(saved.entries) ? saved.entries : [])
  const [startedAt, setStartedAt] = useState(() => Number(saved.startedAt) || null)
  const [elapsed, setElapsed] = useState(0)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const streamRef = useRef(null)
  const audioStreamRef = useRef(null)
  const recorderRef = useRef(null)
  const queueRef = useRef([])
  const processingRef = useRef(false)
  const pendingRef = useRef(0)
  const targetRef = useRef(target)
  const startedAtRef = useRef(startedAt || 0)
  const segmentLoopRef = useRef(null)

  const screenSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
  const recorderSupported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
  const active = ['starting', 'listening', 'paused', 'finishing'].includes(status)

  useEffect(() => {
    if (!screenSupported && source === 'screen') setSource('microphone')
  }, [screenSupported, source])

  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    setElapsed(Math.max(0, Date.now() - startedAt))
    return () => clearInterval(timer)
  }, [startedAt])

  useEffect(() => {
    if (!entries.length) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ target, startedAt, entries, updatedAt: Date.now() }))
    } catch {}
  }, [entries, target, startedAt])

  useEffect(() => () => stopMeeting(false), [])

  const setPendingCount = value => {
    pendingRef.current = Math.max(0, value)
    setPending(pendingRef.current)
  }

  const setTracksEnabled = enabled => {
    audioStreamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const processQueue = async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      while (queueRef.current.length) {
        const item = queueRef.current.shift()
        try {
          const result = await sendSegment(item.blob, item.target)
          if (result.transcript || result.translation) {
            setEntries(current => [...current, {
              id: `${Date.now()}-${Math.random()}`,
              at: item.at,
              original: result.transcript,
              translated: result.translation || result.transcript,
              target: item.target,
            }])
          }
        } catch (err) {
          setError(err.message || 'A meeting segment could not be translated.')
        } finally {
          setPendingCount(pendingRef.current - 1)
        }
      }
    } finally {
      processingRef.current = false
      if (!activeRef.current && pendingRef.current === 0) setStatus(current => current === 'idle' ? current : 'ended')
    }
  }

  const enqueueSegment = (blob, at) => {
    if (!blob || blob.size < 600) return
    queueRef.current.push({ blob, at, target: targetRef.current })
    setPendingCount(pendingRef.current + 1)
    processQueue()
  }

  const recordSegment = stream => new Promise((resolve, reject) => {
    const mimeType = preferredMimeType()
    let recorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch (err) {
      reject(err)
      return
    }

    recorderRef.current = recorder
    const chunks = []
    let timer
    recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data) })
    recorder.addEventListener('error', event => {
      clearTimeout(timer)
      reject(event.error || new Error('Meeting audio capture failed.'))
    }, { once: true })
    recorder.addEventListener('stop', () => {
      clearTimeout(timer)
      if (recorderRef.current === recorder) recorderRef.current = null
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }))
    }, { once: true })
    recorder.start()
    timer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, SEGMENT_MS)
  })

  const segmentLoop = async stream => {
    while (activeRef.current) {
      if (pausedRef.current) {
        await sleep(180)
        continue
      }
      const at = Math.max(0, Date.now() - startedAtRef.current)
      try {
        const blob = await recordSegment(stream)
        if (!pausedRef.current && blob?.size) enqueueSegment(blob, at)
      } catch (err) {
        if (activeRef.current) {
          setError(err.message || 'Meeting audio capture stopped.')
          stopMeeting(false)
        }
        break
      }
    }
  }

  const getMeetingStream = async () => {
    if (source === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Computer audio sharing is not supported in this browser. Use Microphone / speakers instead.')
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const audioTrack = display.getAudioTracks?.()[0]
      if (!audioTrack) {
        display.getTracks().forEach(track => track.stop())
        throw new Error('No computer audio was shared. Choose a tab/window/screen with audio sharing enabled, or use Microphone / speakers.')
      }
      streamRef.current = display
      return new MediaStream([audioTrack])
    }

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    streamRef.current = mic
    return mic
  }

  const startMeeting = async () => {
    if (!recorderSupported || !navigator.mediaDevices?.getUserMedia) {
      setError('Meeting Listen is not supported in this browser.')
      return
    }

    setError('')
    setStatus('starting')
    setEntries([])
    setPendingCount(0)
    queueRef.current = []
    try { localStorage.removeItem(STORAGE_KEY) } catch {}

    try {
      const audioStream = await getMeetingStream()
      audioStreamRef.current = audioStream
      const now = Date.now()
      startedAtRef.current = now
      setStartedAt(now)
      setElapsed(0)
      activeRef.current = true
      pausedRef.current = false
      setStatus('listening')

      streamRef.current?.getTracks?.().forEach(track => {
        track.addEventListener('ended', () => {
          if (activeRef.current) stopMeeting(true)
        }, { once: true })
      })

      segmentLoopRef.current = segmentLoop(audioStream)
    } catch (err) {
      setError(err.message || 'Ana could not start listening to the meeting.')
      activeRef.current = false
      setStatus('idle')
      streamRef.current?.getTracks?.().forEach(track => track.stop())
      streamRef.current = null
      audioStreamRef.current = null
    }
  }

  function stopMeeting(finishQueue = true) {
    activeRef.current = false
    pausedRef.current = false
    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    } catch {}
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    audioStreamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    audioStreamRef.current = null
    setStatus(finishQueue && pendingRef.current > 0 ? 'finishing' : 'ended')
  }

  const togglePause = () => {
    if (!activeRef.current) return
    const next = !pausedRef.current
    pausedRef.current = next
    setTracksEnabled(!next)
    setStatus(next ? 'paused' : 'listening')
    try {
      if (next && recorderRef.current?.state === 'recording') recorderRef.current.stop()
    } catch {}
  }

  const changeTarget = value => {
    targetRef.current = value
    setTarget(value)
    rememberPersonalLanguagePreference?.({ lastMeetingTarget: value })
  }

  const clearTranscript = () => {
    if (activeRef.current) return
    setEntries([])
    setStartedAt(null)
    setElapsed(0)
    setStatus('idle')
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const transcriptText = () => entries.map(item => `[${formatTime(item.at)}]\nOriginal: ${item.original}\n${item.target}: ${item.translated}`).join('\n\n')

  const copyTranscript = async () => {
    if (!entries.length) return
    await navigator.clipboard.writeText(transcriptText())
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const downloadTranscript = () => {
    if (!entries.length) return
    const blob = new Blob([`Ana Meeting Listen\nTranslated to: ${target}\n\n${transcriptText()}\n`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ana-meeting-${new Date(startedAt || Date.now()).toISOString().slice(0, 10)}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const latest = entries[entries.length - 1]
  const statusText = status === 'starting' ? 'Starting…'
    : status === 'listening' ? 'Listening'
      : status === 'paused' ? 'Paused'
        : status === 'finishing' ? 'Finishing last lines…'
          : status === 'ended' ? 'Meeting ended'
            : 'Ready'

  return <section className="meeting-wrap">
    <header className="meeting-head">
      <div className="eyebrow"><Headphones size={14}/> Meeting Listen</div>
      <h1>Listen once. Read it in your language.</h1>
      <p>Keep Ana open beside Teams, Zoom or any meeting. Ana translates in short rolling segments and saves the text on this device. Audio is never saved.</p>
    </header>

    <section className="meeting-setup">
      <div className="meeting-toolbar">
        <label>
          <span>Listen to</span>
          <select value={source} onChange={event => setSource(event.target.value)} disabled={active}>
            <option value="microphone">Microphone / speakers — no screen sharing</option>
            {screenSupported && <option value="screen">Computer / tab audio — opens share picker</option>}
          </select>
        </label>
        <label>
          <span>Translate to</span>
          <select value={target} onChange={event => changeTarget(event.target.value)} disabled={active}>
            {TARGETS.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <div className="meeting-promise">
        <span><Check size={15}/> Cost-optimized near-live translation</span>
        <span><Check size={15}/> Transcript saved automatically</span>
        <span><Check size={15}/> No meeting audio stored</span>
      </div>

      <div className={`meeting-live-card ${active ? 'active' : ''}`}>
        <div className="meeting-status-row">
          <div><i className={status === 'listening' ? 'on' : ''}/><strong>{statusText}</strong></div>
          <span>{startedAt ? formatTime(elapsed) : '00:00'}{pending ? ` · ${pending} segment${pending === 1 ? '' : 's'} processing` : ''}</span>
        </div>

        <div className="meeting-now">
          <span>Latest translation</span>
          <strong>{latest?.translated || (active ? 'Ana will show the translated meeting here as people speak…' : entries.length ? 'Your last meeting transcript is saved below.' : 'Start when your meeting begins.')}</strong>
          {latest?.original && <p>{latest.original}</p>}
        </div>

        {error && <div className="error meeting-error">{error}</div>}

        <div className="meeting-controls">
          {!active ? <button className="meeting-start" onClick={startMeeting}><Headphones size={18}/> Start listening</button> : <>
            {status !== 'finishing' && <button className="meeting-pause" onClick={togglePause}>{status === 'paused' ? <Play size={17}/> : <Pause size={17}/>} {status === 'paused' ? 'Resume' : 'Pause'}</button>}
            <button className="meeting-stop" onClick={() => stopMeeting(true)}><Square size={16}/> End meeting</button>
          </>}
        </div>
      </div>
    </section>

    <section className="meeting-transcript">
      <div className="meeting-transcript-head">
        <div><strong>Saved transcript</strong><span>{entries.length ? `${entries.length} translated segment${entries.length === 1 ? '' : 's'} · saved on this device` : 'Nothing saved yet'}</span></div>
        <div>
          <button onClick={copyTranscript} disabled={!entries.length}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy'}</button>
          <button onClick={downloadTranscript} disabled={!entries.length}><Download size={15}/> Download</button>
          <button onClick={clearTranscript} disabled={active || !entries.length}><Trash2 size={15}/> Clear</button>
        </div>
      </div>
      <div className="meeting-lines">
        {entries.length ? entries.map(item => <article key={item.id}>
          <time>{formatTime(item.at)}</time>
          <div><strong>{item.translated}</strong><p>{item.original}</p></div>
        </article>) : <div className="meeting-empty">Your translated meeting transcript will build here automatically.</div>}
      </div>
    </section>

    <p className="meeting-footnote"><b>Microphone / speakers</b> is the default and does not ask you to share the screen. Use <b>Computer / tab audio</b> only when you want Ana to capture meeting audio directly; browsers require a share picker for that option. Translation usually follows a few seconds behind the speaker.</p>
  </section>
}
