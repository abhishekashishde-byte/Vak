import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, Expand, Mic, MonitorUp, Pause, Play, Square, Trash2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'

const TARGETS = ['Original only', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']

const LANGUAGE_CODES = {
  'Original only': 'en',
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

function initialTarget() {
  const memory = getPersonalLanguageMemory?.() || {}
  if (TARGETS.includes(memory.lastCaptionTarget)) return memory.lastCaptionTarget
  if (TARGETS.includes(memory.ownerLanguage)) return memory.ownerLanguage
  return 'English'
}

export default function CaptionsMode() {
  const [target, setTarget] = useState(initialTarget)
  const [source, setSource] = useState('microphone')
  const [sessionState, setSessionState] = useState('idle')
  const [paused, setPaused] = useState(false)
  const [interimOriginal, setInterimOriginal] = useState('')
  const [interimTranslated, setInterimTranslated] = useState('')
  const [captions, setCaptions] = useState([])
  const [error, setError] = useState('')

  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const streamRef = useRef(null)
  const activeRef = useRef(false)
  const pausedRef = useRef(false)
  const targetRef = useRef(target)
  const scrollRef = useRef(null)
  const originalBufferRef = useRef('')
  const translatedBufferRef = useRef('')
  const segmentTimerRef = useRef(null)

  const active = ['connecting', 'listening', 'recovering'].includes(sessionState) || paused
  const screenSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
  const latest = captions[captions.length - 1] || null
  const visibleCaptions = useMemo(() => captions.slice(-80), [captions])

  useEffect(() => () => stopSession(false, false), [])
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [captions, interimOriginal, interimTranslated])

  const setTrackEnabled = enabled => {
    streamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const sendRealtime = event => {
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event))
  }

  const clearSegmentTimer = () => {
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current)
    segmentTimerRef.current = null
  }

  const commitLiveSegment = (force = false) => {
    clearSegmentTimer()
    const original = clean(originalBufferRef.current)
    const translated = clean(translatedBufferRef.current)
    const currentTarget = targetRef.current

    if (!original) {
      originalBufferRef.current = ''
      translatedBufferRef.current = ''
      setInterimOriginal('')
      setInterimTranslated('')
      return
    }

    if (!force && currentTarget !== 'Original only' && !translated) {
      segmentTimerRef.current = setTimeout(() => commitLiveSegment(true), 650)
      return
    }

    setCaptions(current => [...current, {
      id: `${Date.now()}-${Math.random()}`,
      original,
      translated: currentTarget === 'Original only' ? '' : translated,
      target: currentTarget,
      createdAt: Date.now(),
    }])

    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    setInterimOriginal('')
    setInterimTranslated('')
  }

  const scheduleSegmentCommit = () => {
    clearSegmentTimer()
    segmentTimerRef.current = setTimeout(() => commitLiveSegment(false), 1050)
  }

  const handleRealtimeEvent = event => {
    if (pausedRef.current) return

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const delta = String(event.delta || '')
        if (!delta) break
        originalBufferRef.current += delta
        setInterimOriginal(originalBufferRef.current)
        scheduleSegmentCommit()
        break
      }
      case 'session.output_transcript.delta': {
        const delta = String(event.delta || '')
        if (!delta) break
        translatedBufferRef.current += delta
        setInterimTranslated(translatedBufferRef.current)
        scheduleSegmentCommit()
        break
      }
      case 'session.closed':
        if (activeRef.current) stopSession(false, true)
        break
      case 'error':
      case 'session.error':
        setError(event.error?.message || 'Live captioning was interrupted.')
        break
      default:
        break
    }
  }

  const getSourceStream = async () => {
    if (source === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab or screen audio is not supported in this browser.')
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const audioTrack = stream.getAudioTracks?.()[0]
      if (!audioTrack) {
        stream.getTracks().forEach(track => track.stop())
        throw new Error('No shared audio was provided. Choose a tab or screen with audio sharing enabled.')
      }
      return stream
    }

    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  const startSession = async () => {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setError('Live captions are not supported in this browser.')
      return
    }

    setError('')
    setInterimOriginal('')
    setInterimTranslated('')
    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    pausedRef.current = false
    setPaused(false)
    setSessionState('connecting')
    activeRef.current = true

    try {
      // Acquire the media stream directly from the user's tap. This is important on iOS/WebKit.
      const stream = await getSourceStream()
      streamRef.current = stream
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (activeRef.current) stopSession(false, true)
        }, { once: true })
      })

      const tokenResponse = await fetch('/api/realtime-translation-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage: codeFor(targetRef.current) }),
      })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start realtime translation captions.')

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      const audioTrack = stream.getAudioTracks()[0]
      pc.addTrack(audioTrack, stream)

      // Translation sessions also return translated audio. Captions intentionally do not play it;
      // the remote track is left unattached while transcript deltas are rendered on screen.
      pc.ontrack = () => {}

      pc.addEventListener('connectionstatechange', () => {
        if (!activeRef.current) return
        if (pc.connectionState === 'connected') setSessionState(pausedRef.current ? 'paused' : 'listening')
        else if (['disconnected', 'connecting'].includes(pc.connectionState)) setSessionState('recovering')
        else if (['failed', 'closed'].includes(pc.connectionState)) {
          setError('The live caption connection ended. Start captions again to continue.')
          stopSession(false, true)
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
      if (!sdpResponse.ok) throw new Error(answerSdp || 'Could not connect realtime translation captions.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      await new Promise((resolve, reject) => {
        if (channel.readyState === 'open') return resolve()
        const timer = setTimeout(() => reject(new Error('Realtime captions connection timed out.')), 10000)
        channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Realtime captions could not connect.')) }, { once: true })
      })

      setSessionState('listening')
    } catch (err) {
      setError(err.message || 'Could not start Universal Captions.')
      stopSession(false, false)
    }
  }

  function stopSession(clearLive = true, saveLive = true) {
    activeRef.current = false
    pausedRef.current = false
    clearSegmentTimer()
    if (saveLive) commitLiveSegment(true)
    try { dataChannelRef.current?.close() } catch {}
    dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    if (clearLive) {
      originalBufferRef.current = ''
      translatedBufferRef.current = ''
      setInterimOriginal('')
      setInterimTranslated('')
    }
    setPaused(false)
    setSessionState('idle')
  }

  const togglePause = () => {
    if (!activeRef.current) return
    const next = !pausedRef.current
    if (next) commitLiveSegment(true)
    pausedRef.current = next
    setPaused(next)
    setTrackEnabled(!next)
    setSessionState(next ? 'paused' : 'listening')
  }

  const changeTarget = value => {
    if (activeRef.current) commitLiveSegment(true)
    targetRef.current = value
    setTarget(value)
    rememberPersonalLanguagePreference?.({ lastCaptionTarget: value })

    if (activeRef.current) {
      sendRealtime({
        type: 'session.update',
        session: {
          audio: {
            output: { language: codeFor(value) },
          },
        },
      })
    }
  }

  const clearCaptions = () => {
    setCaptions([])
    originalBufferRef.current = ''
    translatedBufferRef.current = ''
    setInterimOriginal('')
    setInterimTranslated('')
  }

  const enterFullscreen = () => {
    const node = document.querySelector('.captions-stage')
    if (!node) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else node.requestFullscreen?.().catch(() => {})
  }

  const statusLabel = sessionState === 'connecting'
    ? 'Connecting…'
    : sessionState === 'recovering'
      ? 'Reconnecting…'
      : paused
        ? 'Paused'
        : active
          ? 'Listening · translating live'
          : 'Ready'

  const displayOriginal = interimOriginal || latest?.original || (active ? 'Waiting for speech…' : 'Start captions when you’re ready.')
  const displayTranslation = interimTranslated || (!interimOriginal ? latest?.translated : '')

  return <section className="captions-wrap">
    <header className="captions-head">
      <div className="eyebrow"><Captions size={14}/> Universal Captions</div>
      <h1>Understand what’s being said, live.</h1>
      <p>Source speech and its translation now stream onto the screen while the person is still speaking.</p>
    </header>

    <div className="captions-toolbar">
      <label><span>Listen to</span><select value={source} onChange={e => setSource(e.target.value)} disabled={active}>
        <option value="microphone">Microphone</option>
        {screenSupported && <option value="screen">Tab / screen audio</option>}
      </select></label>
      <label><span>Translate captions to</span><select value={target} onChange={e => changeTarget(e.target.value)}>
        {TARGETS.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <button className="captions-icon-btn" onClick={enterFullscreen} title="Fullscreen captions"><Expand size={17}/></button>
      <button className="captions-icon-btn" onClick={clearCaptions} disabled={!captions.length && !interimOriginal && !interimTranslated} title="Clear captions"><Trash2 size={17}/></button>
    </div>

    <div className={`captions-stage ${active ? 'active' : ''}`}>
      <div className="captions-stage-top">
        <div className={`captions-listen-dot ${active && !paused ? 'on' : ''}`}/><span>{statusLabel}</span>
        <span className="captions-source-label">{source === 'screen' ? <><MonitorUp size={13}/> Shared audio</> : <><Mic size={13}/> Microphone</>}</span>
      </div>

      <div className="captions-live-copy">
        <div className="captions-original">{displayOriginal}</div>
        {target !== 'Original only' && <div className={`captions-translation ${interimOriginal && !interimTranslated ? 'pending' : ''}`}>
          {displayTranslation || (interimOriginal ? '…' : `Translation will appear here in ${target}.`)}
        </div>}
      </div>

      <div ref={scrollRef} className="captions-history">
        {visibleCaptions.map(item => <article key={item.id}>
          <p>{item.original}</p>
          {item.target !== 'Original only' && <strong>{item.translated || '—'}</strong>}
        </article>)}
      </div>

      {error && <div className="error captions-error">{error}</div>}

      <div className="captions-controls">
        {!active ? <button className="captions-start" onClick={startSession} disabled={sessionState === 'connecting'}><Mic size={19}/> Start captions</button> : <>
          <button className="captions-pause" onClick={togglePause}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? 'Resume' : 'Pause'}</button>
          <button className="captions-stop" onClick={() => stopSession()}><Square size={17}/> End</button>
        </>}
      </div>
    </div>

    <p className="captions-footnote">Captions stay in this session and are not added to Ana’s personal language memory.</p>
  </section>
}
