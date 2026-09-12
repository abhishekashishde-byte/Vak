import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Languages, Mic, Pause, Send, Sparkles, UserRound } from 'lucide-react'

const HOME_LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'Hinglish', code: 'hi-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]

const OTHER_LANGS = HOME_LANGS.filter(x => x.name !== 'Hinglish')

const isoFor = language => ({
  English: 'en', German: 'de', Hindi: 'hi', French: 'fr', Spanish: 'es', Italian: 'it',
}[language] || 'en')

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}

async function askAna(text, instructions) {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Ana could not continue')
  return String(data.content || '').trim()
}

export default function TalkForMeRealtime() {
  const [stage, setStage] = useState('briefing')
  const [briefing, setBriefing] = useState([{ role: 'ana', text: 'What do you need me to handle for you?' }])
  const [briefInput, setBriefInput] = useState('')
  const [briefLoading, setBriefLoading] = useState(false)
  const [contextSummary, setContextSummary] = useState('')
  const [knownFacts, setKnownFacts] = useState([])
  const [homeLanguage, setHomeLanguage] = useState('English')
  const [otherLanguage, setOtherLanguage] = useState('German')

  const [sessionState, setSessionState] = useState('idle')
  const [latestOther, setLatestOther] = useState('')
  const [latestAna, setLatestAna] = useState('')
  const [interim, setInterim] = useState('')
  const [history, setHistory] = useState([])
  const [pending, setPending] = useState(null)
  const [decision, setDecision] = useState('')
  const [ownerListening, setOwnerListening] = useState(false)
  const [error, setError] = useState('')

  const blobRef = useRef(null)
  const peerRef = useRef(null)
  const dataChannelRef = useRef(null)
  const mediaRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const recognitionRef = useRef(null)
  const audioContextRef = useRef(null)
  const meterFrameRef = useRef(null)
  const activeRef = useRef(false)
  const openingRef = useRef(false)
  const ownerResumeRef = useRef(false)
  const lastOtherRef = useRef('')
  const latestAnaRef = useRef('')

  const speechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const realtimeSupported = typeof window !== 'undefined' && Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)

  useEffect(() => () => endRealtime(), [])

  const briefingTranscript = messages => messages.map(m => `${m.role === 'ana' ? 'ANA' : 'USER'}: ${m.text}`).join('\n')

  const sendBrief = async () => {
    const text = briefInput.trim()
    if (!text || briefLoading) return
    const next = [...briefing, { role: 'user', text }]
    setBriefing(next)
    setBriefInput('')
    setBriefLoading(true)
    setError('')

    try {
      const prompt = `CONVERSATION WITH USER:\n${briefingTranscript(next)}\n\nBuild the minimum sufficient mental model Ana needs to represent the user in a real conversation. Infer the outcome and implied intent. Separate missing information into: required before start, discoverable live from the other person, and owner decision later. Ask only for information required before start, one question at a time. If Ana can sensibly open the conversation and pursue the goal, set ready=true. Detect the language the user is naturally using; if it is Roman-script conversational Hindi, use Hinglish.\n\nReturn JSON only:\n{"ready":true|false,"summary":"concise operational brief","question":"one necessary follow-up in the user's own language, otherwise empty","knownFacts":["fact 1","fact 2"],"userLanguage":"English|German|Hindi|Hinglish|French|Spanish|Italian","otherLanguage":"German|English|Hindi|French|Spanish|Italian|"}`
      const instructions = `You are Ana preparing to speak on a user's behalf. Do not interrogate the user. Do not ask for information Ana can obtain from the other party. Never invent facts. The follow-up question must be in the language the user is currently using. Return valid JSON only.`
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed) throw new Error('Ana could not understand that. Please try again.')

      const summary = String(parsed.summary || '').trim()
      setContextSummary(summary || text)
      setKnownFacts(Array.isArray(parsed.knownFacts) ? parsed.knownFacts.filter(Boolean).map(String) : [])
      if (HOME_LANGS.some(x => x.name === parsed.userLanguage)) setHomeLanguage(parsed.userLanguage)
      if (OTHER_LANGS.some(x => x.name === parsed.otherLanguage)) setOtherLanguage(parsed.otherLanguage)

      if (parsed.ready) {
        setBriefing(prev => [...prev, { role: 'ana', text: 'I have enough context. I’m ready to take it from here.' }])
        setStage('ready')
      } else {
        const question = String(parsed.question || 'What else should I know before I speak for you?').trim()
        setBriefing(prev => [...prev, { role: 'ana', text: question }])
      }
    } catch (err) {
      setError(err.message || 'Could not prepare the conversation.')
    } finally {
      setBriefLoading(false)
    }
  }

  const stopMeter = () => {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    try { audioContextRef.current?.close() } catch {}
    audioContextRef.current = null
    blobRef.current?.style.setProperty('--voice', '0')
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
        blobRef.current?.style.setProperty('--voice', level.toFixed(3))
        meterFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {}
  }

  const setMicEnabled = enabled => {
    mediaRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const sendRealtime = event => {
    const dc = dataChannelRef.current
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event))
  }

  const realtimeInstructions = () => `You are Ana, a live speech-to-speech agent speaking to another person on the user's behalf.

USER'S GOAL / BRIEF:
${contextSummary}

KNOWN FACTS:
${knownFacts.map(x => `- ${x}`).join('\n') || '- No additional facts beyond the brief.'}

OWNER LANGUAGE: ${homeLanguage}
OTHER PERSON LANGUAGE: ${otherLanguage}

BEHAVIOR:
- Speak naturally, warmly and concisely to the other person in ${otherLanguage}. Do not sound like a script or a robot.
- You are not merely translating. You are actively conducting the conversation to achieve the user's goal.
- When the session begins, YOU must open the conversation proactively. Do not wait for the other person to speak first.
- Continue autonomously for routine, reversible dialogue and questions you can ask the other person directly.
- If the other person starts speaking while you are speaking, stop immediately and listen. Never talk over them. Treat their interruption as the new turn and respond to what they actually said.
- Never invent personal facts, dates, preferences, prices, availability or commitments.
- Before choosing or confirming an appointment/date/time, agreeing to a price/payment/purchase, accepting terms, sharing sensitive personal information, making a promise/commitment, or making another material choice, call the ask_owner tool and wait for the owner's answer.
- Do not call ask_owner for information that is already in the brief, or information you can simply ask the other person.
- When calling ask_owner, write the question in ${homeLanguage}. If ${homeLanguage} is Hinglish, use natural Roman-script Hindi, not Devanagari.
- Never verbalize an owner-only question to the other person. Use the tool silently.
- After receiving the owner's answer through the tool, continue speaking to the other person in ${otherLanguage}.
- Keep the conversation focused on the user's stated goal.`

  const handleOwnerTool = item => {
    if (!item?.call_id) return
    let args = {}
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    setMicEnabled(false)
    setPending({
      callId: item.call_id,
      question: String(args.question || 'I need one detail from you before I continue.').trim(),
      reason: String(args.reason || '').trim(),
    })
    setDecision('')
    setSessionState('needs-user')
    try { navigator.vibrate?.([120, 70, 120]) } catch {}
  }

  const handleRealtimeEvent = event => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (!pending) {
          setInterim('')
          setSessionState('listening')
        }
        break
      case 'input_audio_buffer.speech_stopped':
        if (!pending) setSessionState('thinking')
        break
      case 'conversation.item.input_audio_transcription.delta':
        setInterim(prev => `${prev}${event.delta || ''}`)
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript || '').trim()
        if (text) {
          lastOtherRef.current = text
          setLatestOther(text)
          setInterim('')
        }
        break
      }
      case 'response.created':
        if (!pending) setSessionState('thinking')
        break
      case 'response.output_audio_transcript.delta': {
        const delta = String(event.delta || '')
        if (delta) {
          latestAnaRef.current += delta
          setLatestAna(latestAnaRef.current)
          if (!pending) setSessionState('speaking')
        }
        break
      }
      case 'response.output_audio_transcript.done': {
        const transcript = String(event.transcript || latestAnaRef.current || '').trim()
        if (transcript) {
          latestAnaRef.current = transcript
          setLatestAna(transcript)
          const other = lastOtherRef.current
          if (other) {
            setHistory(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, other, anaSpoken: transcript }])
            lastOtherRef.current = ''
          }
        }
        break
      }
      case 'response.output_item.done':
        if (event.item?.type === 'function_call' && event.item?.name === 'ask_owner') handleOwnerTool(event.item)
        break
      case 'response.done':
        latestAnaRef.current = ''
        if (pending) break
        if (openingRef.current) openingRef.current = false
        if (ownerResumeRef.current) ownerResumeRef.current = false
        if (activeRef.current) {
          setMicEnabled(true)
          setSessionState('listening')
        }
        break
      case 'error':
        setError(event.error?.message || 'Realtime voice session error.')
        break
      default:
        break
    }
  }

  const startConversation = async () => {
    if (!realtimeSupported) {
      setError('Realtime voice is not supported in this browser.')
      return
    }

    setError('')
    setStage('conversation')
    setSessionState('connecting')
    setPending(null)
    setLatestOther('')
    setLatestAna('')
    setInterim('')
    activeRef.current = true
    openingRef.current = true

    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana voice.')

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
      micTrack.enabled = true
      pc.addTrack(micTrack, stream)

      const dc = pc.createDataChannel('oai-events')
      dataChannelRef.current = dc
      dc.addEventListener('message', message => {
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
      if (!sdpResponse.ok) throw new Error(await sdpResponse.text() || 'Could not connect Ana voice.')
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ana voice connection timed out.')), 10000)
        dc.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        dc.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Ana voice connection failed.')) }, { once: true })
      })

      sendRealtime({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
          instructions: realtimeInstructions(),
          audio: {
            output: { voice: 'marin' },
            input: {
              transcription: {
                model: 'gpt-live-transcribe',
                languages: [isoFor(otherLanguage)],
                delay: 'low',
              },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'high',
                create_response: true,
                interrupt_response: true,
              },
            },
          },
          tools: [{
            type: 'function',
            name: 'ask_owner',
            description: 'Pause the external conversation and ask the owner for a required material decision or missing fact. Use only when the answer cannot safely be inferred or obtained from the other person.',
            parameters: {
              type: 'object',
              properties: {
                question: { type: 'string', description: `One concise question for the owner in ${homeLanguage}.` },
                reason: { type: 'string', description: 'Short explanation of why the owner must decide.' },
              },
              required: ['question'],
            },
          }],
          tool_choice: 'auto',
        },
      })

      sendRealtime({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Begin now. Open the real conversation yourself in ${otherLanguage} and immediately work toward the user's goal. Speak to the other person, not to the owner.`,
          }],
        },
      })
      sendRealtime({ type: 'response.create' })
      setSessionState('thinking')
    } catch (err) {
      setError(err.message || 'Ana could not start the realtime conversation.')
      setSessionState('idle')
      endRealtime(false)
    }
  }

  const pauseConversation = () => {
    activeRef.current = false
    setMicEnabled(false)
    setSessionState('idle')
  }

  const resumeConversation = () => {
    if (pending) return
    activeRef.current = true
    setMicEnabled(true)
    setSessionState('listening')
  }

  const listenForOwner = () => {
    if (!pending || ownerListening || !speechSupported) return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = HOME_LANGS.find(x => x.name === homeLanguage)?.code || 'en-US'
    recognitionRef.current = recognition
    setOwnerListening(true)
    setDecision('')

    recognition.onresult = event => {
      let live = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript?.trim() || ''
        if (event.results[i].isFinal) finalText += `${text} `
        else live += `${text} `
      }
      setDecision((finalText || live).trim())
    }
    recognition.onerror = () => setOwnerListening(false)
    recognition.onend = () => setOwnerListening(false)
    try { recognition.start() } catch { setOwnerListening(false) }
  }

  const answerAna = () => {
    const answer = decision.trim()
    if (!answer || !pending) return
    try { recognitionRef.current?.stop() } catch {}
    const current = pending
    setPending(null)
    setDecision('')
    setOwnerListening(false)
    ownerResumeRef.current = true
    setSessionState('thinking')
    sendRealtime({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: current.callId,
        output: JSON.stringify({ answer }),
      },
    })
    setMicEnabled(true)
    sendRealtime({ type: 'response.create' })
  }

  function endRealtime(returnToReady = true) {
    activeRef.current = false
    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null
    try { dataChannelRef.current?.close() } catch {}
    dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    mediaRef.current?.getTracks?.().forEach(track => track.stop())
    mediaRef.current = null
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.pause() } catch {}
      remoteAudioRef.current.srcObject = null
    }
    remoteAudioRef.current = null
    stopMeter()
    setPending(null)
    setDecision('')
    setOwnerListening(false)
    setInterim('')
    setSessionState('idle')
    if (returnToReady) setStage('ready')
  }

  const startOver = () => {
    endRealtime(false)
    setBriefing([{ role: 'ana', text: 'What do you need me to handle for you?' }])
    setBriefInput('')
    setContextSummary('')
    setKnownFacts([])
    setHistory([])
    setLatestOther('')
    setLatestAna('')
    setHomeLanguage('English')
    setOtherLanguage('German')
    setStage('briefing')
  }

  if (stage === 'briefing') return <section className="talk-wrap">
    <div className="talk-intro">
      <div className="eyebrow"><Sparkles size={14}/> Talk for me</div>
      <h1>Tell Ana what you need.</h1>
      <p>Give as much or as little context as you have. Ana will work out what matters and ask only what is missing.</p>
    </div>

    <div className="brief-card">
      <div className="brief-thread">
        {briefing.map((message, index) => <div key={index} className={`brief-message ${message.role}`}>
          {message.role === 'ana' && <div className="brief-avatar">A</div>}
          <div><span>{message.role === 'ana' ? 'Ana' : 'You'}</span><p>{message.text}</p></div>
        </div>)}
        {briefLoading && <div className="brief-message ana"><div className="brief-avatar">A</div><div><span>Ana</span><div className="brief-thinking"><i/><i/><i/></div></div></div>}
      </div>
      {error && <div className="error brief-error">{error}</div>}
      <div className="brief-input-row">
        <textarea value={briefInput} onChange={e => setBriefInput(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendBrief() }} placeholder="I need to call my doctor and…" disabled={briefLoading}/>
        <button onClick={sendBrief} disabled={!briefInput.trim() || briefLoading}><Send size={18}/></button>
      </div>
    </div>
  </section>

  if (stage === 'ready') return <section className="talk-wrap ready-stage">
    <div className="talk-intro">
      <div className="eyebrow"><Check size={14}/> Ana is ready</div>
      <h1>Context understood.</h1>
      <p>Ana will open the conversation herself, speak naturally, and only interrupt you when your decision is actually needed.</p>
    </div>

    <div className="ready-card">
      <div className="ready-summary"><span>Your brief</span><p>{contextSummary}</p></div>
      {knownFacts.length > 0 && <div className="ready-facts">{knownFacts.map((fact, i) => <span key={i}>{fact}</span>)}</div>}
      <div className="ready-languages">
        <label><span>I understand</span><select value={homeLanguage} onChange={e => setHomeLanguage(e.target.value)}>{HOME_LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
        <ArrowRight size={16}/>
        <label><span>They speak</span><select value={otherLanguage} onChange={e => setOtherLanguage(e.target.value)}>{OTHER_LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
      </div>
      {error && <div className="error brief-error">{error}</div>}
      <button className="magic-start" onClick={startConversation}><Mic size={19}/> Start conversation</button>
      <button className="text-button" onClick={() => setStage('briefing')}>Add more context</button>
    </div>
  </section>

  return <section className="talk-wrap voice-stage">
    <div className="voice-topbar">
      <div><span className="talk-kicker">Ana is handling</span><p>{contextSummary}</p></div>
      <button className="ghost" onClick={() => endRealtime(true)}>End</button>
    </div>

    <div className={`voice-card${pending ? ' owner-pending' : ''}`}>
      {pending && <div className="owner-alert"><UserRound size={16}/><div><strong>Question for you</strong><span>Ana has paused the external conversation. Only you should answer now.</span></div></div>}
      <div className="voice-language"><Languages size={14}/><span>{homeLanguage}</span><span>↔</span><span>{otherLanguage}</span></div>

      <div className="orb-zone">
        <div ref={blobRef} className={`ana-orb ${sessionState}`}>
          <div className="orb-layer one"/><div className="orb-layer two"/><div className="orb-core">A</div>
        </div>
        <div className="voice-state-copy">
          <strong>{sessionState === 'connecting' ? 'Connecting Ana' : sessionState === 'listening' ? 'Listening' : sessionState === 'thinking' ? 'Thinking' : sessionState === 'speaking' ? 'Ana is speaking' : sessionState === 'needs-user' ? 'Waiting for you' : 'Paused'}</strong>
          <span>{sessionState === 'connecting' ? 'Starting realtime voice…' : sessionState === 'listening' ? (interim || 'The other person can speak naturally') : sessionState === 'thinking' ? 'Ana is working out the next move…' : sessionState === 'speaking' ? (latestAna || 'Speaking… You can interrupt Ana anytime.') : sessionState === 'needs-user' ? 'The other-person microphone is paused.' : 'Tap resume when you are ready.'}</span>
        </div>
      </div>

      {pending && <div className="decision-card owner-decision">
        <div className="decision-head"><UserRound size={18}/><div><span>Owner input required</span><strong>{pending.question}</strong></div></div>
        {pending.reason && <div className="decision-context"><span>Why Ana paused</span><p>{pending.reason}</p></div>}
        <div className="owner-answer-label"><span>Your answer — not the other speaker's</span></div>
        <div className="decision-input">
          <button className={`owner-mic${ownerListening ? ' active' : ''}`} onClick={listenForOwner} disabled={ownerListening || !speechSupported} title="Answer Ana by voice"><Mic size={17}/></button>
          <input autoFocus value={decision} onChange={e => setDecision(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') answerAna() }} placeholder={ownerListening ? 'Listening to you…' : 'Type or speak your answer to Ana…'}/>
          <button className="owner-send" onClick={answerAna} disabled={!decision.trim()}><Send size={17}/></button>
        </div>
        <div className="owner-hold-note">Ana will continue automatically after your answer.</div>
      </div>}

      {error && <div className="error voice-error">{error}</div>}

      {(latestOther || latestAna) && !pending && <div className="latest-exchange">
        {latestOther && <div><span>They said</span><p>{latestOther}</p></div>}
        {latestAna && <div><span>Ana</span><p>{latestAna}</p></div>}
      </div>}

      <div className="voice-controls">
        {pending ? <button className="waiting-owner" disabled><UserRound size={17}/> Waiting for your answer</button> : activeRef.current ? <button className="pause-btn" onClick={pauseConversation}><Pause size={17}/> Pause</button> : <button className="resume-btn" onClick={resumeConversation}><Mic size={17}/> Resume</button>}
        <button className="text-button" onClick={startOver}>Start over</button>
      </div>
    </div>

    {history.length > 0 && <details className="conversation-log"><summary>Conversation transcript · {history.length} exchanges</summary><div>{history.map(turn => <article key={turn.id}><div><span>They</span><p>{turn.other}</p></div><div><span>Ana</span><p>{turn.anaSpoken}</p></div></article>)}</div></details>}
  </section>
}
