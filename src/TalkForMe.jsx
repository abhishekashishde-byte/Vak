import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Languages, Mic, Pause, Send, Sparkles, UserRound, Volume2 } from 'lucide-react'

const LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]

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

export default function TalkForMe() {
  const [stage, setStage] = useState('briefing')
  const [briefing, setBriefing] = useState([{ role: 'ana', text: 'What do you need me to handle for you?' }])
  const [briefInput, setBriefInput] = useState('')
  const [briefLoading, setBriefLoading] = useState(false)
  const [contextSummary, setContextSummary] = useState('')
  const [knownFacts, setKnownFacts] = useState([])
  const [homeLanguage, setHomeLanguage] = useState('English')
  const [otherLanguage, setOtherLanguage] = useState('German')

  const [sessionState, setSessionState] = useState('idle')
  const [interim, setInterim] = useState('')
  const [latestOther, setLatestOther] = useState('')
  const [latestAna, setLatestAna] = useState('')
  const [history, setHistory] = useState([])
  const [pending, setPending] = useState(null)
  const [decision, setDecision] = useState('')
  const [ownerListening, setOwnerListening] = useState(false)
  const [error, setError] = useState('')

  const recognitionRef = useRef(null)
  const activeRef = useRef(false)
  const processingRef = useRef(false)
  const needsUserRef = useRef(false)
  const blobRef = useRef(null)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const meterFrameRef = useRef(null)

  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => {
    activeRef.current = false
    try { recognitionRef.current?.stop() } catch {}
    try { window.speechSynthesis?.cancel() } catch {}
    stopMeter()
  }, [])

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
      const prompt = `CONVERSATION WITH USER:\n${briefingTranscript(next)}\n\nDecide whether Ana has enough information to represent the user in a real conversation. Ask only for information that could materially affect what Ana should say. Infer obvious context instead of interrogating the user. Ask at most ONE concise follow-up question at a time. When enough information is available, mark ready=true.\n\nReturn JSON only:\n{"ready":true|false,"summary":"concise operational brief of what the user wants and all useful constraints/facts already supplied","question":"one follow-up question if needed, otherwise empty","knownFacts":["fact 1","fact 2"],"otherLanguage":"German|English|Hindi|French|Spanish|Italian|"}`
      const instructions = `You are Ana preparing to speak on a user's behalf. Your job is to understand the goal before the live conversation starts. Do not ask for details that are not actually necessary. Never invent facts. If the user has given enough to start and any remaining choice can safely be asked during the live conversation, set ready=true. Return valid JSON only.`
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed) throw new Error('Ana could not understand that. Please try again.')
      const summary = String(parsed.summary || '').trim()
      setContextSummary(summary || text)
      setKnownFacts(Array.isArray(parsed.knownFacts) ? parsed.knownFacts.filter(Boolean).map(String) : [])
      if (LANGS.some(x => x.name === parsed.otherLanguage)) setOtherLanguage(parsed.otherLanguage)
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

  function stopMeter() {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    try { audioContextRef.current?.close() } catch {}
    audioContextRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    blobRef.current?.style.setProperty('--voice', '0')
  }

  const startMeter = async () => {
    if (!navigator.mediaDevices?.getUserMedia || streamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
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

  const stopRecognition = () => {
    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null
    setInterim('')
    setOwnerListening(false)
  }

  const conversationForPrompt = () => history.map((turn, i) =>
    `${i + 1}. OTHER: ${turn.other}\nANA: ${turn.anaSpoken}`
  ).join('\n')

  const speakAndResume = (spokenReply, homeSummary, otherText, meaning) => {
    setLatestAna(spokenReply)
    setHistory(prev => [...prev, {
      id: crypto.randomUUID(),
      other: otherText,
      meaning,
      anaHome: homeSummary,
      anaSpoken: spokenReply,
    }])

    if (!('speechSynthesis' in window)) {
      setError('Spoken playback is not supported in this browser.')
      processingRef.current = false
      setSessionState('idle')
      return
    }

    setSessionState('speaking')
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(spokenReply)
    utterance.lang = LANGS.find(x => x.name === otherLanguage)?.code || 'de-DE'
    utterance.rate = 0.96
    utterance.onend = () => {
      processingRef.current = false
      if (!activeRef.current) return
      setSessionState('listening')
      setTimeout(() => startListening(), 250)
    }
    utterance.onerror = () => {
      processingRef.current = false
      setError('Ana could not play the spoken reply.')
      if (activeRef.current) setTimeout(() => startListening(), 250)
    }
    window.speechSynthesis.speak(utterance)
  }

  const askOwner = (heard, meaning, question) => {
    stopRecognition()
    needsUserRef.current = true
    processingRef.current = false
    setPending({ heard, meaning, question })
    setSessionState('needs-user')
    setDecision('')
    try { navigator.vibrate?.([120, 70, 120]) } catch {}
  }

  const handleOtherSpeech = async rawText => {
    const text = String(rawText || '').trim()
    if (!text || processingRef.current) return
    processingRef.current = true
    stopRecognition()
    setLatestOther(text)
    setLatestAna('')
    setSessionState('thinking')
    setError('')

    try {
      const prompt = `USER BRIEF:\n${contextSummary}\n\nKNOWN FACTS:\n${knownFacts.map(x => `- ${x}`).join('\n') || '(none beyond the brief)'}\n\nUSER'S LANGUAGE: ${homeLanguage}\nOTHER PERSON'S LANGUAGE: ${otherLanguage}\n\nCONVERSATION SO FAR:\n${conversationForPrompt() || '(none yet)'}\n\nTHE OTHER PERSON JUST SAID:\n${text}\n\nDecide Ana's next move. Return JSON only:\n{"meaning":"short explanation in ${homeLanguage} of what they said","action":"speak|ask_user","spokenReply":"exact natural reply in ${otherLanguage}, empty if asking user","homeSummary":"short ${homeLanguage} summary of what Ana will say","askUser":"one concise question for the user if their decision/info is required, otherwise empty","reason":"short reason"}`
      const instructions = `You are Ana speaking on the user's behalf in a live real-world conversation. Work toward the user's brief naturally and confidently. For routine, reversible, non-material dialogue, respond autonomously. Never invent facts. Use action=ask_user whenever a missing fact matters, or before choosing/confirming an appointment/date/time, price/payment/purchase, accepting terms, sharing sensitive personal information, making a promise/commitment, or making any material choice for the user. Do not ask the user when the answer is already in the brief. Keep spoken replies concise and human. Return valid JSON only.`
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed) throw new Error('Ana could not work out the next reply.')
      const meaning = String(parsed.meaning || '').trim()
      if (parsed.action === 'ask_user' || !parsed.spokenReply) {
        askOwner(text, meaning, String(parsed.askUser || 'I need one detail from you before I answer.').trim())
        return
      }
      speakAndResume(String(parsed.spokenReply).trim(), String(parsed.homeSummary || '').trim(), text, meaning)
    } catch (err) {
      processingRef.current = false
      setSessionState('idle')
      setError(err.message || 'Ana could not prepare the next reply.')
    }
  }

  const startListening = () => {
    if (!activeRef.current || processingRef.current || needsUserRef.current) return
    if (!supported) {
      setSessionState('idle')
      setError('Automatic voice conversation is not supported in this browser yet. Try Chrome on Android or desktop.')
      return
    }

    try { recognitionRef.current?.stop() } catch {}
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = LANGS.find(x => x.name === otherLanguage)?.code || 'de-DE'

    recognition.onresult = event => {
      let live = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript?.trim() || ''
        if (event.results[i].isFinal) finalText += `${text} `
        else live += `${text} `
      }
      setInterim(live.trim())
      if (finalText.trim()) handleOtherSpeech(finalText.trim())
    }

    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        activeRef.current = false
        setSessionState('idle')
        setError('Microphone access is blocked. Allow microphone permission for Ana and start again.')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`Microphone error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      recognitionRef.current = null
      if (activeRef.current && !processingRef.current && !needsUserRef.current) {
        setTimeout(() => startListening(), 300)
      }
    }

    recognitionRef.current = recognition
    setSessionState('listening')
    try { recognition.start() } catch {}
  }

  const listenForOwner = () => {
    if (!pending || ownerListening || !supported) return
    stopRecognition()
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = LANGS.find(x => x.name === homeLanguage)?.code || 'en-US'
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
    recognition.onerror = event => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') setError(`Owner microphone error: ${event.error}`)
      setOwnerListening(false)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setOwnerListening(false)
    }
    recognitionRef.current = recognition
    try { recognition.start() } catch {
      setOwnerListening(false)
    }
  }

  const startConversation = async () => {
    setError('')
    setStage('conversation')
    activeRef.current = true
    processingRef.current = false
    needsUserRef.current = false
    await startMeter()
    startListening()
  }

  const pauseConversation = () => {
    activeRef.current = false
    stopRecognition()
    try { window.speechSynthesis?.cancel() } catch {}
    setSessionState('idle')
  }

  const resumeConversation = () => {
    if (pending) return
    activeRef.current = true
    processingRef.current = false
    needsUserRef.current = false
    startListening()
  }

  const answerAna = async () => {
    const answer = decision.trim()
    if (!answer || !pending) return
    stopRecognition()
    setDecision('')
    setSessionState('thinking')
    processingRef.current = true
    needsUserRef.current = false
    setError('')
    try {
      const prompt = `USER BRIEF:\n${contextSummary}\n\nOTHER PERSON SAID:\n${pending.heard}\n\nANA ASKED USER:\n${pending.question}\n\nUSER ANSWERED:\n${answer}\n\nCONVERSATION SO FAR:\n${conversationForPrompt() || '(none yet)'}\n\nReturn JSON only:\n{"spokenReply":"exact natural reply Ana should now say in ${otherLanguage}","homeSummary":"short ${homeLanguage} summary","askUser":"empty unless one truly essential detail is still missing"}`
      const instructions = `You are Ana speaking for the user. Use the user's answer exactly as context; do not invent additional facts. If one essential material detail is still missing, leave spokenReply empty and ask one concise question in askUser. Otherwise produce a concise natural spoken reply. Return valid JSON only.`
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed?.spokenReply) {
        askOwner(pending.heard, pending.meaning, String(parsed?.askUser || 'I still need one detail from you.').trim())
        return
      }
      const current = pending
      setPending(null)
      setKnownFacts(prev => [...prev, `Owner answered during conversation: ${answer}`])
      speakAndResume(String(parsed.spokenReply).trim(), String(parsed.homeSummary || '').trim(), current.heard, current.meaning)
    } catch (err) {
      processingRef.current = false
      needsUserRef.current = true
      setSessionState('needs-user')
      setError(err.message || 'Ana could not use that answer.')
    }
  }

  const endConversation = () => {
    activeRef.current = false
    processingRef.current = false
    needsUserRef.current = false
    stopRecognition()
    try { window.speechSynthesis?.cancel() } catch {}
    stopMeter()
    setSessionState('idle')
    setPending(null)
    setDecision('')
    setStage('ready')
  }

  const startOver = () => {
    endConversation()
    setBriefing([{ role: 'ana', text: 'What do you need me to handle for you?' }])
    setBriefInput('')
    setContextSummary('')
    setKnownFacts([])
    setHistory([])
    setLatestOther('')
    setLatestAna('')
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
      <p>From here, Ana can run the conversation and only come back to you when your decision is actually needed.</p>
    </div>

    <div className="ready-card">
      <div className="ready-summary"><span>Your brief</span><p>{contextSummary}</p></div>
      {knownFacts.length > 0 && <div className="ready-facts">{knownFacts.map((fact, i) => <span key={i}>{fact}</span>)}</div>}
      <div className="ready-languages">
        <label><span>I understand</span><select value={homeLanguage} onChange={e => setHomeLanguage(e.target.value)}>{LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
        <ArrowRight size={16}/>
        <label><span>They speak</span><select value={otherLanguage} onChange={e => setOtherLanguage(e.target.value)}>{LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
      </div>
      <button className="magic-start" onClick={startConversation}><Mic size={19}/> Start with Ana</button>
      <button className="text-button" onClick={() => setStage('briefing')}>Add more context</button>
    </div>
  </section>

  return <section className="talk-wrap voice-stage">
    <div className="voice-topbar">
      <div><span className="talk-kicker">Ana is handling</span><p>{contextSummary}</p></div>
      <button className="ghost" onClick={endConversation}>End</button>
    </div>

    <div className={`voice-card${pending ? ' owner-pending' : ''}`}>
      {pending && <div className="owner-alert"><UserRound size={16}/><div><strong>Question for you</strong><span>Ana has stopped listening to the other person. Only you should answer now.</span></div></div>}
      <div className="voice-language"><Languages size={14}/><span>{homeLanguage}</span><span>↔</span><span>{otherLanguage}</span></div>

      <div className="orb-zone">
        <div ref={blobRef} className={`ana-orb ${sessionState}`}>
          <div className="orb-layer one"/><div className="orb-layer two"/><div className="orb-core">A</div>
        </div>
        <div className="voice-state-copy">
          <strong>{sessionState === 'listening' ? 'Listening to them' : sessionState === 'thinking' ? 'Understanding' : sessionState === 'speaking' ? 'Ana is speaking' : sessionState === 'needs-user' ? 'Waiting for you' : 'Paused'}</strong>
          <span>{sessionState === 'listening' ? (interim || 'The other person can speak now') : sessionState === 'thinking' ? 'Working out what to say next…' : sessionState === 'speaking' ? latestAna : sessionState === 'needs-user' ? 'Speaker microphone is paused. Answer Ana below to continue.' : 'Tap resume when you are ready.'}</span>
        </div>
      </div>

      {pending && <div className="decision-card owner-decision">
        <div className="decision-head"><UserRound size={18}/><div><span>Owner input required</span><strong>{pending.question}</strong></div></div>
        <div className="decision-context"><span>Why Ana paused</span><p>{pending.meaning || pending.heard}</p></div>
        <div className="owner-answer-label"><span>Your answer — not the other speaker's</span></div>
        <div className="decision-input">
          <button className={`owner-mic${ownerListening ? ' active' : ''}`} onClick={listenForOwner} disabled={ownerListening} title="Answer Ana by voice"><Mic size={17}/></button>
          <input autoFocus value={decision} onChange={e => setDecision(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') answerAna() }} placeholder={ownerListening ? 'Listening to you…' : 'Type or speak your answer to Ana…'}/>
          <button className="owner-send" onClick={answerAna} disabled={!decision.trim()}><Send size={17}/></button>
        </div>
        <div className="owner-hold-note">Ana will not resume the conversation until you reply.</div>
      </div>}

      {error && <div className="error voice-error">{error}</div>}

      {(latestOther || latestAna) && !pending && <div className="latest-exchange">
        {latestOther && <div><span>They said</span><p>{latestOther}</p></div>}
        {latestAna && <div><span>Ana replied</span><p>{latestAna}</p><button onClick={() => { const u = new SpeechSynthesisUtterance(latestAna); u.lang = LANGS.find(x => x.name === otherLanguage)?.code || 'de-DE'; window.speechSynthesis?.speak(u) }}><Volume2 size={13}/> Play again</button></div>}
      </div>}

      <div className="voice-controls">
        {pending ? <button className="waiting-owner" disabled><UserRound size={17}/> Waiting for your answer</button> : activeRef.current ? <button className="pause-btn" onClick={pauseConversation}><Pause size={17}/> Pause</button> : <button className="resume-btn" onClick={resumeConversation}><Mic size={17}/> Resume</button>}
        <button className="text-button" onClick={startOver}>Start over</button>
      </div>
    </div>

    {history.length > 0 && <details className="conversation-log"><summary>Conversation transcript · {history.length} exchanges</summary><div>{history.map(turn => <article key={turn.id}><div><span>They</span><p>{turn.other}</p></div><div><span>Ana</span><p>{turn.anaSpoken}</p></div></article>)}</div></details>}
  </section>
}