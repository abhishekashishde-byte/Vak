import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Languages, Mic, Square, Trash2, Volume2 } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'

const LANGS = [
  { name: 'English', iso: 'en' },
  { name: 'German', iso: 'de' },
  { name: 'Swabian German (Schwäbisch)', iso: 'de' },
  { name: 'Bavarian German (Bairisch)', iso: 'de' },
  { name: 'Low German (Plattdeutsch)', iso: 'de' },
  { name: 'Hindi', iso: 'hi' },
  { name: 'Hinglish', iso: 'hi' },
  { name: 'Bengali', iso: 'bn' },
  { name: 'Tamil', iso: 'ta' },
  { name: 'Telugu', iso: 'te' },
  { name: 'Marathi', iso: 'mr' },
  { name: 'Gujarati', iso: 'gu' },
  { name: 'Punjabi', iso: 'pa' },
  { name: 'Malayalam', iso: 'ml' },
  { name: 'Kannada', iso: 'kn' },
  { name: 'Urdu', iso: 'ur' },
  { name: 'French', iso: 'fr' },
  { name: 'Spanish', iso: 'es' },
  { name: 'Italian', iso: 'it' },
]
const INDIAN_SPEECH_LANGS = new Set(['Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu'])

const isoFor = language => LANGS.find(x => x.name === language)?.iso || 'en'
const validLanguage = value => LANGS.some(x => x.name === value)
const rememberedPair = () => {
  const pair = getPersonalLanguageMemory()?.lastLiveLanguages
  return Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1] && pair.every(validLanguage) ? pair : ['Hindi', 'German']
}
const normalise = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const NON_SPEECH = new Set(['uh', 'um', 'hmm', 'hm', 'mm', 'mmm', 'äh', 'ähm', 'eh', 'erm', 'ah'])
const ignorableFragment = value => {
  const text = normalise(value)
  if (!text) return true
  const words = text.split(/\s+/).filter(Boolean)
  return words.length === 1 && NON_SPEECH.has(words[0])
}

export default function LiveMode() {
  const initialPair = rememberedPair()
  const [languageA, setLanguageA] = useState(initialPair[0])
  const [languageB, setLanguageB] = useState(initialPair[1])
  const [sessionState, setSessionState] = useState('idle')
  const [interim, setInterim] = useState('')
  const [latestInput, setLatestInput] = useState('')
  const [latestOutput, setLatestOutput] = useState('')
  const [turns, setTurns] = useState([])
  const [error, setError] = useState('')
  const [listeningMode, setListeningMode] = useState('auto')
  const [holding, setHolding] = useState(false)

  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const mediaRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const activeRef = useRef(false)
  const lastInputRef = useRef('')
  const outputRef = useRef('')
  const orbRef = useRef(null)
  const audioContextRef = useRef(null)
  const meterFrameRef = useRef(null)
  const suppressResponseRef = useRef(false)
  const lastInputSeenRef = useRef({ text: '', at: 0 })
  const lastCommittedRef = useRef({ original: '', translation: '', at: 0 })
  const currentResponseRef = useRef(null)
  const sessionStateRef = useRef('idle')

  const active = ['connecting', 'listening', 'translating', 'speaking'].includes(sessionState)
  const realtimeSupported = typeof window !== 'undefined' && Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)

  useEffect(() => { sessionStateRef.current = sessionState }, [sessionState])
  useEffect(() => () => stopSession(false), [])
  useEffect(() => {
    if (active) return
    rememberPersonalLanguagePreference({ lastLiveLanguages: [languageA, languageB] })
  }, [languageA, languageB, active])
  useEffect(() => {
    const hydrate = () => {
      if (activeRef.current) return
      const pair = rememberedPair()
      setLanguageA(pair[0])
      setLanguageB(pair[1])
    }
    window.addEventListener('ana-account-preferences-hydrated', hydrate)
    return () => window.removeEventListener('ana-account-preferences-hydrated', hydrate)
  }, [])
  useEffect(() => {
    if (!activeRef.current) return
    if (listeningMode === 'manual') setMicEnabled(holding && sessionState === 'listening')
    else setMicEnabled(true)
  }, [listeningMode, holding, sessionState])

  const setMicEnabled = enabled => {
    mediaRef.current?.getAudioTracks?.().forEach(track => { track.enabled = Boolean(enabled) })
  }

  const stopMeter = () => {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    try { audioContextRef.current?.close() } catch {}
    audioContextRef.current = null
    orbRef.current?.style.setProperty('--voice', '0')
  }

  const startMeter = stream => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const ctx = new AudioContext()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const samples = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(samples)
        let sum = 0
        for (const value of samples) sum += value
        const level = Math.min(1, (sum / samples.length) / 80)
        orbRef.current?.style.setProperty('--voice', level.toFixed(3))
        meterFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {}
  }

  const sendRealtime = event => {
    const channel = dataChannelRef.current
    if (channel?.readyState === 'open') channel.send(JSON.stringify(event))
  }

  const interpreterInstructions = () => `You are Ana, a live two-way interpreter between ${languageA} and ${languageB}.

YOUR ONLY JOB IS TO INTERPRET. You are not a conversational assistant in this mode.

TURN QUALITY:
- Wait for a complete communicative thought before translating. A natural short pause inside a sentence is not automatically the end of the turn.
- Ignore obvious background speech, television/radio bleed, accidental distant voices, mic bumps, breathing, and non-lexical fillers such as “uh”, “hmm” or “äh” when they do not carry a message for the conversation.
- Do NOT ignore meaningful short replies such as yes/no, okay, thanks, a number, a name, a price, or a time.
- If audio is too fragmentary to establish a useful meaning, remain silent rather than inventing a translation.
- Never translate the same completed turn twice. If a speaker interrupts your translation, stop immediately; listen to the new turn and do not replay the interrupted translation from the beginning unless the speaker explicitly asks.

LANGUAGE DIRECTION:
- Detect whether the speaker's intended side of the conversation is ${languageA} or ${languageB} from the whole utterance, not from one borrowed word.
- If the speaker uses ${languageA}, speak ONLY the natural ${languageB} translation aloud.
- If the speaker uses ${languageB}, speak ONLY the natural ${languageA} translation aloud.
- Mixed-language speech is normal. Determine the dominant sentence intent and translate the whole intended message once into the other conversation language.
${INDIAN_SPEECH_LANGS.has(languageA) || INDIAN_SPEECH_LANGS.has(languageB) ? '- Natural code-switching with English or German is normal for Indian-language speakers. Determine the intended language from the whole utterance rather than a borrowed word. For Hinglish, treat Roman-script conversational Hindi as the Hindi side and never mistake Latin script alone for English.\n' : ''}- Preserve the speaker's first-person perspective, intent, tone, politeness, names, dates, numbers and meaning.
- Never answer a question yourself. Translate the question.
- Never solve a request yourself. Translate the request.
- Never explain, summarize, comment, add advice, introduce yourself, or say phrases such as “they said” or “the translation is”.
- Never repeat the source sentence before translating it.
- Do not continue the conversation on your own. After speaking the translation, stop and wait for either person to speak next.
- Sound like a natural human interpreter, not a robot. Keep the translation concise and faithful.`

  const resetTurnBuffers = () => {
    lastInputRef.current = ''
    outputRef.current = ''
    currentResponseRef.current = null
    suppressResponseRef.current = false
  }

  const finishTurn = () => {
    const original = lastInputRef.current.trim()
    const translation = outputRef.current.trim()
    if (original && translation) {
      const now = Date.now()
      const previous = lastCommittedRef.current
      const duplicate = normalise(original) === normalise(previous.original)
        && normalise(translation) === normalise(previous.translation)
        && now - previous.at < 5000
      if (!duplicate) {
        lastCommittedRef.current = { original, translation, at: now }
        setTurns(prev => [...prev, { id: `${now}-${Math.random()}`, original, translation }])
      }
    }
    resetTurnBuffers()
  }

  const cancelSuppressedResponse = () => {
    sendRealtime({ type: 'response.cancel' })
    outputRef.current = ''
    setLatestOutput('')
    suppressResponseRef.current = false
  }

  const handleRealtimeEvent = event => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (activeRef.current) {
          if (sessionStateRef.current === 'speaking') {
            outputRef.current = ''
            setLatestOutput('')
          }
          setInterim('')
          setLatestInput('')
          setLatestOutput('')
          lastInputRef.current = ''
          outputRef.current = ''
          suppressResponseRef.current = false
          setSessionState('listening')
        }
        break

      case 'input_audio_buffer.speech_stopped':
        if (activeRef.current) setSessionState('translating')
        break

      case 'conversation.item.input_audio_transcription.delta':
        setInterim(prev => `${prev}${event.delta || ''}`)
        break

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = String(event.transcript || '').trim()
        const now = Date.now()
        const normalized = normalise(transcript)
        const duplicate = normalized && normalized === lastInputSeenRef.current.text && now - lastInputSeenRef.current.at < 1800
        lastInputSeenRef.current = { text: normalized, at: now }
        if (!transcript || ignorableFragment(transcript) || duplicate) {
          suppressResponseRef.current = true
          lastInputRef.current = ''
          setLatestInput('')
          setInterim('')
          break
        }
        lastInputRef.current = transcript
        setLatestInput(transcript)
        setInterim('')
        break
      }

      case 'response.created':
        currentResponseRef.current = event.response?.id || null
        if (suppressResponseRef.current) {
          cancelSuppressedResponse()
          if (activeRef.current) setSessionState('listening')
          break
        }
        if (activeRef.current) setSessionState('translating')
        break

      case 'response.output_audio_transcript.delta': {
        if (suppressResponseRef.current) break
        const delta = String(event.delta || '')
        if (delta) {
          outputRef.current += delta
          setLatestOutput(outputRef.current)
          setSessionState('speaking')
        }
        break
      }

      case 'response.output_audio_transcript.done': {
        if (suppressResponseRef.current) break
        const transcript = String(event.transcript || outputRef.current || '').trim()
        if (transcript) {
          outputRef.current = transcript
          setLatestOutput(transcript)
        }
        break
      }

      case 'response.done': {
        const status = event.response?.status || 'completed'
        if (!suppressResponseRef.current && status === 'completed') finishTurn()
        else resetTurnBuffers()
        if (activeRef.current) {
          setSessionState('listening')
          if (listeningMode === 'manual') setMicEnabled(holding)
        }
        break
      }

      case 'error':
        if (!/cancel/i.test(event.error?.message || '')) setError(event.error?.message || 'Realtime interpretation error.')
        break

      default:
        break
    }
  }

  const startSession = async () => {
    if (!realtimeSupported) {
      setError('Realtime interpretation is not supported in this browser.')
      return
    }
    if (languageA === languageB) {
      setError('Choose two different languages.')
      return
    }

    rememberPersonalLanguagePreference({ lastLiveLanguages: [languageA, languageB] })
    setError('')
    setInterim('')
    setLatestInput('')
    setLatestOutput('')
    setSessionState('connecting')
    activeRef.current = true
    resetTurnBuffers()

    try {
      // iOS/WebKit requires microphone access to happen directly from the user's tap.
      // Acquire the mic before any network await so transient user activation is not lost.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana Live.')

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      pc.addEventListener('connectionstatechange', () => {
        if (!activeRef.current) return
        if (pc.connectionState === 'failed') {
          setMicEnabled(false)
          setError('The connection dropped. End and start again when your network is stable.')
          setSessionState('idle')
          activeRef.current = false
        }
      })

      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.playsInline = true
      remoteAudioRef.current = audio
      pc.ontrack = event => {
        audio.srcObject = event.streams[0]
        audio.play?.().catch(() => {})
      }

      const micTrack = stream.getAudioTracks()[0]
      pc.addTrack(micTrack, stream)

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
      if (!sdpResponse.ok) throw new Error(answerSdp || 'Could not connect Ana Live.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ana Live connection timed out.')), 10000)
        channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Ana Live connection failed.')) }, { once: true })
      })

      sendRealtime({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          instructions: interpreterInstructions(),
          audio: {
            output: { voice: 'marin' },
            input: {
              transcription: {
                model: 'gpt-live-transcribe',
                languages: [isoFor(languageA), isoFor(languageB)],
                delay: 'low',
              },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'medium',
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      })

      setSessionState('listening')
      setMicEnabled(listeningMode === 'auto')
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || /not allowed|permission denied|permission/i.test(String(err?.message || ''))
      setError(denied
        ? 'Microphone access is blocked for this website. Allow Microphone for Ana in your browser/site settings, then tap Start conversation again.'
        : (err?.message || 'Could not start realtime interpretation.'))
      stopSession(false)
    }
  }

  function stopSession(clearLatest = true) {
    activeRef.current = false
    setHolding(false)
    try { dataChannelRef.current?.close() } catch {}
    dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    mediaRef.current?.getTracks?.().forEach(track => track.stop())
    mediaRef.current = null
    try {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause?.()
        remoteAudioRef.current.srcObject = null
      }
    } catch {}
    remoteAudioRef.current = null
    stopMeter()
    setInterim('')
    resetTurnBuffers()
    if (clearLatest) {
      setLatestInput('')
      setLatestOutput('')
    }
    setSessionState('idle')
  }

  const swapLanguages = () => {
    if (active) return
    const first = languageA
    setLanguageA(languageB)
    setLanguageB(first)
  }

  const clearTranscript = () => {
    setTurns([])
    setLatestInput('')
    setLatestOutput('')
    setInterim('')
    setError('')
    lastCommittedRef.current = { original: '', translation: '', at: 0 }
  }

  const beginHold = event => {
    if (!active || listeningMode !== 'manual' || sessionState !== 'listening') return
    event?.preventDefault?.()
    setHolding(true)
    setMicEnabled(true)
    try { event?.currentTarget?.setPointerCapture?.(event.pointerId) } catch {}
  }

  const endHold = event => {
    event?.preventDefault?.()
    setHolding(false)
    setMicEnabled(false)
  }

  const stateTitle = sessionState === 'connecting'
    ? 'Connecting Ana…'
    : sessionState === 'listening'
      ? (listeningMode === 'manual' && !holding ? 'Ready when you are' : 'Listening')
      : sessionState === 'translating'
        ? 'Translating…'
        : sessionState === 'speaking'
          ? 'Ana is speaking'
          : 'Ready for both of you'

  const stateDetail = sessionState === 'listening'
    ? (interim || (listeningMode === 'manual' ? (holding ? 'Speak now. Release when the person is finished.' : 'Hold the button below while either person speaks.') : `Either person can speak in ${languageA} or ${languageB}.`))
    : sessionState === 'translating'
      ? (latestInput || 'Waiting for the thought to finish…')
      : sessionState === 'speaking'
        ? (latestOutput || 'Speaking the translation aloud… You can interrupt Ana anytime.')
        : sessionState === 'connecting'
          ? 'Starting realtime audio…'
          : 'Choose the two languages, then start once.'

  return <section className="live-wrap live-interpreter">
    <div className="live-head">
      <div className="eyebrow"><Mic size={14}/> Two-way live interpreter</div>
      <h1>Talk naturally. Ana handles both sides.</h1>
      <p>Ana waits for the thought, handles mixed language naturally and stays quiet when background noise is not part of the conversation.</p>
    </div>

    <div className="live-card live-interpreter-card">
      <div className="live-toolbar live-pair-toolbar">
        <Languages size={16}/>
        <select value={languageA} onChange={e => setLanguageA(e.target.value)} disabled={active}>
          {LANGS.filter(x => x.name !== languageB).map(x => <option key={x.name}>{x.name}</option>)}
        </select>
        <button className="live-swap" onClick={swapLanguages} disabled={active} title="Swap languages"><ArrowLeftRight size={16}/></button>
        <select value={languageB} onChange={e => setLanguageB(e.target.value)} disabled={active}>
          {LANGS.filter(x => x.name !== languageA).map(x => <option key={x.name}>{x.name}</option>)}
        </select>
        <div className="live-listen-mode" aria-label="Listening mode">
          <button className={listeningMode === 'auto' ? 'active' : ''} onClick={() => setListeningMode('auto')} disabled={active && sessionState !== 'listening'}>Automatic</button>
          <button className={listeningMode === 'manual' ? 'active' : ''} onClick={() => setListeningMode('manual')} disabled={active && sessionState !== 'listening'}>Noisy place</button>
        </div>
        <div className="spacer"/>
        <button className="ghost icon-text" onClick={clearTranscript} disabled={active && !turns.length}><Trash2 size={15}/> Clear</button>
      </div>

      <div className="live-orb-zone">
        <div ref={orbRef} className={`ana-orb ${sessionState === 'translating' ? 'thinking' : sessionState === 'connecting' ? 'thinking' : sessionState}`}>
          <div className="orb-layer one"/>
          <div className="orb-layer two"/>
          <div className="orb-core">A</div>
        </div>
        <div className="voice-state-copy live-state-copy">
          <strong>{stateTitle}</strong>
          <span>{stateDetail}</span>
        </div>
      </div>

      {(latestInput || latestOutput) && <div className="live-latest">
        {latestInput && <div><span>Heard</span><p>{latestInput}</p></div>}
        {latestOutput && <div><span>Ana said</span><p>{latestOutput}</p></div>}
      </div>}

      {error && <div className="error live-error">{error}</div>}

      <div className="live-controls">
        <button className={`live-mic${active ? ' active' : ''}`} onClick={active ? () => stopSession() : startSession} disabled={sessionState === 'connecting'}>
          {active ? <Square size={19}/> : <Mic size={21}/>}<span>{sessionState === 'connecting' ? 'Connecting…' : active ? 'End conversation' : 'Start conversation'}</span>
        </button>
        {active && listeningMode === 'manual' && <button
          className={`live-hold${holding ? ' active' : ''}`}
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onLostPointerCapture={endHold}
          disabled={sessionState !== 'listening'}
        ><Volume2 size={18}/><span>{holding ? 'Listening — release when finished' : 'Hold while someone speaks'}</span></button>}
        <div className={`live-status${active ? ' on' : ''}`}>{active ? `${languageA} ↔ ${languageB} · ${listeningMode === 'manual' ? 'controlled listening' : 'automatic direction'} · interruptible` : `Microphone off · ${languageA} ↔ ${languageB} remembered`}</div>
      </div>
    </div>

    {turns.length > 0 && <details className="live-history">
      <summary>Conversation transcript · {turns.length} turn{turns.length === 1 ? '' : 's'}</summary>
      <div>{turns.map(turn => <article key={turn.id}><div><span>Heard</span><p>{turn.original}</p></div><div><span>Ana interpreted</span><p>{turn.translation}</p></div></article>)}</div></details>}
  </section>
}
