import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Languages, Mic, Square, Trash2 } from 'lucide-react'

const LANGS = [
  { name: 'English', iso: 'en' },
  { name: 'German', iso: 'de' },
  { name: 'Hindi', iso: 'hi' },
  { name: 'French', iso: 'fr' },
  { name: 'Spanish', iso: 'es' },
  { name: 'Italian', iso: 'it' },
]

const isoFor = language => LANGS.find(x => x.name === language)?.iso || 'en'

export default function LiveMode() {
  const [languageA, setLanguageA] = useState('Hindi')
  const [languageB, setLanguageB] = useState('German')
  const [sessionState, setSessionState] = useState('idle')
  const [interim, setInterim] = useState('')
  const [latestInput, setLatestInput] = useState('')
  const [latestOutput, setLatestOutput] = useState('')
  const [turns, setTurns] = useState([])
  const [error, setError] = useState('')

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
  const resumeTimerRef = useRef(null)

  const active = ['connecting', 'listening', 'translating', 'speaking'].includes(sessionState)
  const realtimeSupported = typeof window !== 'undefined' && Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)

  useEffect(() => () => stopSession(false), [])

  const setMicEnabled = enabled => {
    mediaRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
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

For every completed speech turn:
- Detect whether the speaker is speaking ${languageA} or ${languageB} from the audio and meaning.
- If the speaker uses ${languageA}, speak ONLY the natural ${languageB} translation aloud.
- If the speaker uses ${languageB}, speak ONLY the natural ${languageA} translation aloud.
- Preserve the speaker's first-person perspective, intent, tone, politeness, names, dates, numbers and meaning.
- If the speaker mixes languages, infer the intended meaning and translate it into the OTHER conversation language.
- Never answer a question yourself. Translate the question.
- Never solve a request yourself. Translate the request.
- Never explain, summarize, comment, add advice, introduce yourself, or say phrases such as “they said” or “the translation is”.
- Never repeat the source sentence before translating it.
- Do not continue the conversation on your own. After speaking the translation, stop and wait for either person to speak next.
- Sound like a natural human interpreter, not a robot. Keep the translation concise and faithful.`

  const finishTurn = () => {
    const original = lastInputRef.current.trim()
    const translation = outputRef.current.trim()
    if (original && translation) {
      setTurns(prev => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        original,
        translation,
      }])
    }
    lastInputRef.current = ''
    outputRef.current = ''
  }

  const handleRealtimeEvent = event => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (activeRef.current) {
          setInterim('')
          setLatestInput('')
          setLatestOutput('')
          lastInputRef.current = ''
          outputRef.current = ''
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
        if (transcript) {
          lastInputRef.current = transcript
          setLatestInput(transcript)
          setInterim('')
        }
        break
      }

      case 'response.created':
        if (activeRef.current) {
          setMicEnabled(false)
          setSessionState('translating')
        }
        break

      case 'response.output_audio_transcript.delta': {
        const delta = String(event.delta || '')
        if (delta) {
          outputRef.current += delta
          setLatestOutput(outputRef.current)
          setSessionState('speaking')
        }
        break
      }

      case 'response.output_audio_transcript.done': {
        const transcript = String(event.transcript || outputRef.current || '').trim()
        if (transcript) {
          outputRef.current = transcript
          setLatestOutput(transcript)
        }
        break
      }

      case 'response.done':
        finishTurn()
        if (activeRef.current) {
          clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = setTimeout(() => {
            if (!activeRef.current) return
            setMicEnabled(true)
            setSessionState('listening')
          }, 350)
        }
        break

      case 'error':
        setError(event.error?.message || 'Realtime interpretation error.')
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

    setError('')
    setInterim('')
    setLatestInput('')
    setLatestOutput('')
    setSessionState('connecting')
    activeRef.current = true

    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana Live.')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const pc = new RTCPeerConnection()
      peerRef.current = pc

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
            },
          },
        },
      })

      setSessionState('listening')
      setMicEnabled(true)
    } catch (err) {
      setError(err.message || 'Could not start realtime interpretation.')
      stopSession(false)
    }
  }

  function stopSession(clearLatest = true) {
    activeRef.current = false
    clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
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
    if (clearLatest) {
      setLatestInput('')
      setLatestOutput('')
      lastInputRef.current = ''
      outputRef.current = ''
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
  }

  const stateTitle = sessionState === 'connecting'
    ? 'Connecting Ana…'
    : sessionState === 'listening'
      ? 'Listening'
      : sessionState === 'translating'
        ? 'Translating…'
        : sessionState === 'speaking'
          ? 'Ana is speaking'
          : 'Ready for both of you'

  const stateDetail = sessionState === 'listening'
    ? (interim || `Either person can speak in ${languageA} or ${languageB}.`)
    : sessionState === 'translating'
      ? (latestInput || 'Understanding the finished turn…')
      : sessionState === 'speaking'
        ? (latestOutput || 'Speaking the translation aloud…')
        : sessionState === 'connecting'
          ? 'Starting realtime audio…'
          : 'Choose the two languages, then start once.'

  return <section className="live-wrap live-interpreter">
    <div className="live-head">
      <div className="eyebrow"><Mic size={14}/> Two-way live interpreter</div>
      <h1>Talk naturally. Ana handles both sides.</h1>
      <p>Speak either language. Ana detects who spoke, translates into the other language and says it aloud.</p>
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
        <div className={`live-status${active ? ' on' : ''}`}>{active ? `${languageA} ↔ ${languageB} · automatic direction` : 'Microphone off'}</div>
      </div>
    </div>

    {turns.length > 0 && <details className="live-history">
      <summary>Conversation transcript · {turns.length} turn{turns.length === 1 ? '' : 's'}</summary>
      <div>{turns.map(turn => <article key={turn.id}><div><span>Heard</span><p>{turn.original}</p></div><div><span>Ana interpreted</span><p>{turn.translation}</p></div></article>)}</div>
    </details>}
  </section>
}
