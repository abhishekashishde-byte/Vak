import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, Expand, Mic, MonitorUp, Pause, Play, Square, Trash2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'

const TARGETS = ['Original only', 'English', 'German', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']

const clean = value => String(value || '').trim()

function initialTarget() {
  const memory = getPersonalLanguageMemory?.() || {}
  if (TARGETS.includes(memory.lastCaptionTarget)) return memory.lastCaptionTarget
  if (TARGETS.includes(memory.ownerLanguage)) return memory.ownerLanguage
  return 'English'
}

async function translateCaption(text, target) {
  if (!text || target === 'Original only') return ''
  let instructions = `You are Ana creating live translated subtitles. Detect the source language automatically and translate ONLY the supplied speech into natural ${target}. Preserve the speaker's first-person perspective, intent, tone, names, numbers, dates, uncertainty and factual meaning. Do not answer questions, summarize, explain, censor or add commentary. If the speech is already in ${target}, return it naturally without changing its meaning. Return ONLY the translated subtitle text.`
  if (target === 'Hinglish') instructions += ' Hinglish means natural conversational Hindi written entirely in Roman/Latin letters. Never use Devanagari.'

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not translate this caption.')
  return clean(data.content)
}

export default function CaptionsMode() {
  const [target, setTarget] = useState(initialTarget)
  const [source, setSource] = useState('microphone')
  const [sessionState, setSessionState] = useState('idle')
  const [paused, setPaused] = useState(false)
  const [interim, setInterim] = useState('')
  const [captions, setCaptions] = useState([])
  const [error, setError] = useState('')

  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const streamRef = useRef(null)
  const activeRef = useRef(false)
  const scrollRef = useRef(null)

  const active = ['connecting', 'listening', 'recovering'].includes(sessionState) || paused
  const screenSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
  const latest = captions[captions.length - 1] || null

  const visibleCaptions = useMemo(() => captions.slice(-80), [captions])

  useEffect(() => () => stopSession(false), [])
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [captions, interim])

  const setTrackEnabled = enabled => {
    streamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const sendRealtime = event => {
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event))
  }

  const addCompletedCaption = transcript => {
    const original = clean(transcript)
    if (!original) return
    const id = `${Date.now()}-${Math.random()}`
    const item = {
      id,
      original,
      translated: target === 'Original only' ? '' : null,
      target,
      createdAt: Date.now(),
    }
    setCaptions(current => [...current, item])
    setInterim('')

    if (target === 'Original only') return
    translateCaption(original, target)
      .then(translated => {
        setCaptions(current => current.map(value => value.id === id ? { ...value, translated } : value))
      })
      .catch(() => {
        setCaptions(current => current.map(value => value.id === id ? { ...value, translated: '', translationFailed: true } : value))
      })
  }

  const handleRealtimeEvent = event => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (activeRef.current && !paused) setSessionState('listening')
        break
      case 'conversation.item.input_audio_transcription.delta':
        if (!paused) setInterim(current => `${current}${event.delta || ''}`)
        break
      case 'conversation.item.input_audio_transcription.completed':
        if (!paused) addCompletedCaption(event.transcript)
        break
      case 'error':
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
    setInterim('')
    setPaused(false)
    setSessionState('connecting')
    activeRef.current = true

    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Universal Captions.')

      const stream = await getSourceStream()
      streamRef.current = stream
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (activeRef.current) stopSession(false)
        }, { once: true })
      })

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      const audioTrack = stream.getAudioTracks()[0]
      pc.addTrack(audioTrack, stream)

      pc.addEventListener('connectionstatechange', () => {
        if (!activeRef.current) return
        if (pc.connectionState === 'connected') setSessionState(paused ? 'paused' : 'listening')
        else if (['disconnected', 'connecting'].includes(pc.connectionState)) setSessionState('recovering')
        else if (['failed', 'closed'].includes(pc.connectionState)) {
          setError('The live caption connection ended. Start captions again to continue.')
          stopSession(false)
        }
      })

      const channel = pc.createDataChannel('oai-events')
      dataChannelRef.current = channel
      channel.addEventListener('message', message => {
        try { handleRealtimeEvent(JSON.parse(message.data)) } catch {}
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenData.value}`,
          'Content-Type': 'application/sdp',
        },
      })
      const answerSdp = await sdpResponse.text()
      if (!sdpResponse.ok) throw new Error(answerSdp || 'Could not connect Universal Captions.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Universal Captions connection timed out.')), 10000)
        channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Universal Captions could not connect.')) }, { once: true })
      })

      sendRealtime({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          instructions: 'You are Ana Universal Captions. This session is transcription-only. Never create spoken or text responses. Preserve multilingual speech and code-switching faithfully in the input transcription.',
          audio: {
            input: {
              transcription: {
                model: 'gpt-live-transcribe',
                delay: 'low',
              },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'medium',
                create_response: false,
                interrupt_response: false,
              },
            },
          },
        },
      })

      setSessionState('listening')
    } catch (err) {
      setError(err.message || 'Could not start Universal Captions.')
      stopSession(false)
    }
  }

  function stopSession(clearInterim = true) {
    activeRef.current = false
    try { dataChannelRef.current?.close() } catch {}
    dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    if (clearInterim) setInterim('')
    setPaused(false)
    setSessionState('idle')
  }

  const togglePause = () => {
    if (!activeRef.current) return
    const next = !paused
    setPaused(next)
    setTrackEnabled(!next)
    setSessionState(next ? 'paused' : 'listening')
    if (next) setInterim('')
  }

  const changeTarget = value => {
    setTarget(value)
    rememberPersonalLanguagePreference?.({ lastCaptionTarget: value })
  }

  const clearCaptions = () => {
    setCaptions([])
    setInterim('')
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
          ? 'Listening'
          : 'Ready'

  return <section className="captions-wrap">
    <header className="captions-head">
      <div className="eyebrow"><Captions size={14}/> Universal Captions</div>
      <h1>Understand what’s being said, live.</h1>
      <p>Use the microphone for people around you, or share tab/screen audio when your browser supports it.</p>
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
      <button className="captions-icon-btn" onClick={clearCaptions} disabled={!captions.length && !interim} title="Clear captions"><Trash2 size={17}/></button>
    </div>

    <div className={`captions-stage ${active ? 'active' : ''}`}>
      <div className="captions-stage-top">
        <div className={`captions-listen-dot ${active && !paused ? 'on' : ''}`}/><span>{statusLabel}</span>
        <span className="captions-source-label">{source === 'screen' ? <><MonitorUp size={13}/> Shared audio</> : <><Mic size={13}/> Microphone</>}</span>
      </div>

      <div className="captions-live-copy">
        <div className="captions-original">{interim || latest?.original || (active ? 'Waiting for speech…' : 'Start captions when you’re ready.')}</div>
        {target !== 'Original only' && <div className={`captions-translation ${latest?.translated === null ? 'pending' : ''}`}>
          {interim
            ? '…'
            : latest?.translated === null
              ? 'Translating…'
              : latest?.translationFailed
                ? 'Translation unavailable for this line.'
                : latest?.translated || `Translation will appear here in ${target}.`}
        </div>}
      </div>

      <div ref={scrollRef} className="captions-history">
        {visibleCaptions.map(item => <article key={item.id}>
          <p>{item.original}</p>
          {item.target !== 'Original only' && <strong>{item.translated === null ? 'Translating…' : item.translated || '—'}</strong>}
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
