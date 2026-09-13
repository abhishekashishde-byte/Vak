import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Languages, ListChecks, Mic, Pause, Send, ShieldCheck, Sparkles, UserRound } from 'lucide-react'

const HOME_LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Swabian German (Schwäbisch)', code: 'de-DE' },
  { name: 'Bavarian German (Bairisch)', code: 'de-DE' },
  { name: 'Low German (Plattdeutsch)', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'Hinglish', code: 'hi-IN' },
  { name: 'Bengali', code: 'bn-IN' },
  { name: 'Tamil', code: 'ta-IN' },
  { name: 'Telugu', code: 'te-IN' },
  { name: 'Marathi', code: 'mr-IN' },
  { name: 'Gujarati', code: 'gu-IN' },
  { name: 'Punjabi', code: 'pa-IN' },
  { name: 'Malayalam', code: 'ml-IN' },
  { name: 'Kannada', code: 'kn-IN' },
  { name: 'Urdu', code: 'ur-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]

const OTHER_LANGS = [...HOME_LANGS]
const COMPLETE_STATUSES = new Set(['confirmed', 'unavailable'])

const isoFor = language => ({
  English: 'en', German: 'de', 'Swabian German (Schwäbisch)': 'de', 'Bavarian German (Bairisch)': 'de', 'Low German (Plattdeutsch)': 'de',
  Hindi: 'hi', Hinglish: 'hi', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa', Malayalam: 'ml', Kannada: 'kn', Urdu: 'ur',
  French: 'fr', Spanish: 'es', Italian: 'it',
}[language] || 'en')

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}

function factKey(value, index = 0) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return key || `fact_${index + 1}`
}

function normalizeCriticalFacts(items = []) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  return items.slice(0, 12).map((item, index) => {
    const label = String(item?.label || item?.key || `Critical detail ${index + 1}`).trim()
    let key = factKey(item?.key || label, index)
    while (seen.has(key)) key = `${key}_${index + 1}`
    seen.add(key)
    const status = ['confirmed', 'observed', 'unavailable'].includes(item?.status) ? item.status : 'missing'
    return {
      key,
      label,
      required: item?.required !== false,
      risk: ['high', 'normal'].includes(item?.risk) ? item.risk : 'normal',
      status,
      value: String(item?.value || '').trim(),
      evidence: String(item?.evidence || '').trim(),
      reason: String(item?.reason || '').trim(),
    }
  })
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
  const [criticalFacts, setCriticalFacts] = useState([])
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
  const [debrief, setDebrief] = useState(null)
  const [debriefLoading, setDebriefLoading] = useState(false)
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
  const historyRef = useRef([])
  const criticalFactsRef = useRef([])
  const pendingRef = useRef(null)
  const awaitingClosingRef = useRef(false)
  const closingResponseRef = useRef(null)
  const finishingRef = useRef(false)

  const speechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const realtimeSupported = typeof window !== 'undefined' && Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia)

  useEffect(() => () => endRealtime(false), [])

  const briefingTranscript = messages => messages.map(m => `${m.role === 'ana' ? 'ANA' : 'USER'}: ${m.text}`).join('\n')

  const replaceCriticalFacts = facts => {
    criticalFactsRef.current = facts
    setCriticalFacts(facts)
  }

  const updateCriticalFact = (key, patch) => {
    const current = criticalFactsRef.current
    const index = current.findIndex(item => item.key === key)
    const next = index >= 0
      ? current.map((item, i) => i === index ? { ...item, ...patch } : item)
      : [...current, {
        key,
        label: patch.label || key.replace(/_/g, ' '),
        required: patch.required !== false,
        risk: patch.risk || 'normal',
        status: 'missing',
        value: '',
        evidence: '',
        reason: '',
        ...patch,
      }]
    replaceCriticalFacts(next)
  }

  const appendHistory = turn => {
    historyRef.current = [...historyRef.current, turn]
    setHistory(historyRef.current)
  }

  const unresolvedCriticalFacts = () => criticalFactsRef.current.filter(item => item.required && !COMPLETE_STATUSES.has(item.status))

  const sendBrief = () => {
    const text = briefInput.trim()
    if (!text || briefLoading) return

    const next = [...briefing, { role: 'user', text }]
    setBriefing(next)
    setBriefInput('')
    setBriefLoading(false)
    setError('')

    // Talk for Me must never block the owner on a separate reasoning call.
    // The owner's own words become the operational brief immediately. The
    // Realtime agent discovers routine facts live and the deterministic
    // completion gate still prevents the task from closing prematurely.
    const userBrief = next
      .filter(message => message.role === 'user')
      .map(message => String(message.text || '').trim())
      .filter(Boolean)
      .join('\n')

    setContextSummary(userBrief || text)
    setKnownFacts([])
    replaceCriticalFacts([{
      key: 'owner_goal_requirements',
      label: "Owner's requested outcome and conditions",
      required: true,
      risk: 'high',
      status: 'missing',
      value: '',
      evidence: '',
      reason: 'Ana must verify that the explicit owner goal and every material condition are satisfied before closing.',
    }])

    setBriefing(prev => [...prev, { role: 'ana', text: 'I have enough context. I’m ready to take it from here.' }])
    setStage('ready')
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

  const checklistForInstructions = () => criticalFactsRef.current.length
    ? criticalFactsRef.current.map(item => `- ${item.key}: ${item.label} | required=${item.required} | risk=${item.risk} | current=${item.status}${item.value ? ` | value=${item.value}` : ''}`).join('\n')
    : '- No precomputed critical facts. Create a critical fact dynamically only if the conversation reveals a material detail the owner must reliably know.'

  const realtimeInstructions = () => `You are Ana, a live speech-to-speech agent speaking to another person on the user's behalf.

USER'S GOAL / BRIEF:
${contextSummary}

KNOWN FACTS:
${knownFacts.map(x => `- ${x}`).join('\n') || '- No additional facts beyond the brief.'}

CRITICAL FACT COMPLETION CHECKLIST:
${checklistForInstructions()}

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
- Keep the conversation focused on the user's stated goal.

CRITICAL FACT VERIFICATION — mandatory:
- Treat every explicit outcome, constraint and condition in USER'S GOAL / BRIEF as binding. The owner must not have to repeat it.
- At the beginning of the live task, identify the material requirements in the brief and create/update structured critical facts for them as they become relevant. If the conversation reveals a new material dependency, rule or condition, create a required critical fact for that too.
- The synthetic owner_goal_requirements fact is always required. Keep it unresolved until the requested outcome and every material owner condition have actually been satisfied or explicitly established as unavailable. Immediately before completing, record owner_goal_requirements as confirmed with concise evidence of why the owner's goal is satisfied. Never confirm it merely because the other person ended the conversation.
- Maintain the checklist above as structured evidence, not just as memory in prose.
- Whenever a checklist fact is learned, call record_critical_fact before considering the task complete.
- Use status=confirmed only when the other person's statement is sufficiently clear and internally consistent to rely on in the owner handoff, or when it was already explicitly supplied by the owner.
- Use status=observed when you heard a candidate value but it remains ambiguous, incomplete, inconsistent, acoustically uncertain, or needs a meaningful breakdown. An observed fact does NOT satisfy completion.
- Use status=unavailable only when the other person explicitly cannot provide the required information or the information genuinely does not exist; record why.
- For money, exact dates/times, quantities, names, addresses, reference numbers, appointments and commitments, be conservative. If the audio is plausibly ambiguous (for example eighteen versus eighty), if two statements conflict, or if the consequence of a mistake is material, naturally read back or clarify the value before marking it confirmed.
- A clear ordinary statement does not need pointless repetition. Verification should be targeted, not bureaucratic.
- If a total covers multiple requested people/items/categories, the total alone does not satisfy a required component-breakdown fact. Ask the smallest useful breakdown question.
- If numerical components do not reconcile with the stated total, clarify once and do not silently choose one version.
- You may create a new critical fact through record_critical_fact if the conversation reveals another material detail that the owner must reliably know.
- Do NOT say the words 'critical fact', 'verification checklist', or describe this internal mechanism to the other person.
- When the user's real goal is achieved, call complete_task instead of continuing small talk. complete_task will refuse completion if a required critical fact is still unresolved. If it refuses, obtain only the listed missing details and try again.`

  const handleOwnerTool = item => {
    if (!item?.call_id) return
    let args = {}
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    setMicEnabled(false)
    const nextPending = {
      callId: item.call_id,
      question: String(args.question || 'I need one detail from you before I continue.').trim(),
      reason: String(args.reason || '').trim(),
    }
    pendingRef.current = nextPending
    setPending(nextPending)
    setDecision('')
    setSessionState('needs-user')
    try { navigator.vibrate?.([120, 70, 120]) } catch {}
  }

  const handleCriticalFactTool = item => {
    if (!item?.call_id) return
    let args = {}
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    const key = factKey(args.fact_key || args.label || `fact_${criticalFactsRef.current.length + 1}`)
    const status = ['confirmed', 'observed', 'unavailable'].includes(args.status) ? args.status : 'observed'
    updateCriticalFact(key, {
      label: String(args.label || '').trim() || undefined,
      required: args.required !== false,
      risk: args.risk === 'high' ? 'high' : undefined,
      status,
      value: String(args.value || '').trim(),
      evidence: String(args.evidence || '').trim(),
      reason: String(args.reason || '').trim(),
    })
    sendRealtime({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({ ok: true, fact_key: key, status }),
      },
    })
    sendRealtime({ type: 'response.create' })
  }

  const handleCompleteTaskTool = item => {
    if (!item?.call_id) return
    const unresolved = unresolvedCriticalFacts()
    if (unresolved.length) {
      sendRealtime({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify({
            accepted: false,
            unresolved: unresolved.map(fact => ({ key: fact.key, label: fact.label, status: fact.status, risk: fact.risk })),
            instruction: 'Do not close yet. Obtain or explicitly resolve only these required details, then call complete_task again.',
          }),
        },
      })
      sendRealtime({ type: 'response.create' })
      return
    }

    awaitingClosingRef.current = true
    sendRealtime({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({
          accepted: true,
          instruction: `The task is complete. Give exactly one brief, natural closing sentence in ${otherLanguage}. Do not introduce a new question or topic.`,
        }),
      },
    })
    sendRealtime({ type: 'response.create' })
  }

  const buildDebrief = async (manual = false) => {
    if (finishingRef.current) return
    finishingRef.current = true
    const factsSnapshot = criticalFactsRef.current
    const historySnapshot = historyRef.current

    endRealtime(false)
    setStage('debrief')
    setDebriefLoading(true)
    setDebrief(null)
    setError('')

    try {
      const prompt = `OWNER'S ORIGINAL GOAL:\n${contextSummary}\n\nSTRUCTURED CRITICAL FACTS:\n${JSON.stringify(factsSnapshot, null, 2)}\n\nCONVERSATION TRANSCRIPT:\n${historySnapshot.map(turn => `OTHER: ${turn.other}\nANA: ${turn.anaSpoken}`).join('\n\n') || '(No complete transcript turns were captured.)'}\n\nThe conversation ${manual ? 'was ended manually by the owner' : 'reached Ana\'s completion gate'}. Prepare the owner handoff. Treat structured facts with status=confirmed as authoritative. A fact with status=observed is NOT verified and must not be presented as certain. A fact with status=unavailable should be stated as unavailable if relevant. Do not invent a price, time, date, rule, name, condition, agreement or next step from an uncertain transcript fragment.\n\nReturn JSON only:\n{"status":"completed|action_required|incomplete","outcome":"concise owner-facing explanation of what happened","nextSteps":["only actions the owner actually needs to take"],"important":["important confirmed details or clearly labelled unavailable/unresolved details"]}`
      let instructions = `You are Ana reviewing a live real-world conversation after speaking for the user. Accuracy is more important than sounding complete. Use confirmed structured facts over free-form transcript wording. Never silently upgrade an observed or ambiguous value into a fact. Keep the handoff concise and practical in ${homeLanguage}. Return valid JSON only.`
      if (homeLanguage === 'Hinglish') instructions += ' Write natural conversational Hindi entirely in Roman/Latin letters. Never use Devanagari.'
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed) throw new Error('Ana could not prepare the handoff.')
      setDebrief({
        status: ['completed', 'action_required', 'incomplete'].includes(parsed.status) ? parsed.status : 'incomplete',
        outcome: String(parsed.outcome || '').trim(),
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.filter(Boolean).map(String) : [],
        important: Array.isArray(parsed.important) ? parsed.important.filter(Boolean).map(String) : [],
      })
    } catch (err) {
      setError(err.message || 'Ana could not prepare the handoff.')
      setDebrief({
        status: manual ? 'incomplete' : 'completed',
        outcome: manual ? 'The conversation ended before Ana could prepare a verified summary.' : 'The conversation finished, but Ana could not prepare the summary.',
        nextSteps: [],
        important: factsSnapshot.filter(f => COMPLETE_STATUSES.has(f.status)).map(f => `${f.label}: ${f.status === 'unavailable' ? 'Unavailable' : f.value}`),
      })
    } finally {
      setDebriefLoading(false)
      finishingRef.current = false
    }
  }

  const handleRealtimeEvent = event => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (!pendingRef.current) {
          setInterim('')
          setSessionState('listening')
        }
        break
      case 'input_audio_buffer.speech_stopped':
        if (!pendingRef.current) setSessionState('thinking')
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
        if (awaitingClosingRef.current) {
          closingResponseRef.current = event.response?.id || null
          awaitingClosingRef.current = false
        }
        if (!pendingRef.current) setSessionState('thinking')
        break
      case 'response.output_audio_transcript.delta': {
        const delta = String(event.delta || '')
        if (delta) {
          latestAnaRef.current += delta
          setLatestAna(latestAnaRef.current)
          if (!pendingRef.current) setSessionState('speaking')
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
            appendHistory({ id: `${Date.now()}-${Math.random()}`, other, anaSpoken: transcript })
            lastOtherRef.current = ''
          }
        }
        break
      }
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          if (event.item?.name === 'ask_owner') handleOwnerTool(event.item)
          if (event.item?.name === 'record_critical_fact') handleCriticalFactTool(event.item)
          if (event.item?.name === 'complete_task') handleCompleteTaskTool(event.item)
        }
        break
      case 'response.done': {
        const responseId = event.response?.id || null
        latestAnaRef.current = ''
        if (closingResponseRef.current && responseId === closingResponseRef.current) {
          closingResponseRef.current = null
          buildDebrief(false)
          break
        }
        if (pendingRef.current) break
        if (openingRef.current) openingRef.current = false
        if (ownerResumeRef.current) ownerResumeRef.current = false
        if (activeRef.current) {
          setMicEnabled(true)
          setSessionState('listening')
        }
        break
      }
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
    setDebrief(null)
    setStage('conversation')
    setSessionState('connecting')
    pendingRef.current = null
    setPending(null)
    setLatestOther('')
    setLatestAna('')
    setInterim('')
    historyRef.current = []
    setHistory([])
    activeRef.current = true
    openingRef.current = true
    awaitingClosingRef.current = false
    closingResponseRef.current = null

    try {
      // Keep microphone access directly attached to the user's Start tap on iOS/WebKit.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana voice.')

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
      const answerSdp = await sdpResponse.text()
      if (!sdpResponse.ok) throw new Error(answerSdp || 'Could not connect Ana voice.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

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
          tools: [
            {
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
            },
            {
              type: 'function',
              name: 'record_critical_fact',
              description: 'Record or update one material fact needed for a reliable owner handoff. Call whenever such a fact is learned, clarified, becomes unavailable, or remains only observed/uncertain.',
              parameters: {
                type: 'object',
                properties: {
                  fact_key: { type: 'string', description: 'Use a key from the checklist when possible, otherwise create a short stable snake_case key.' },
                  label: { type: 'string', description: 'Plain owner-facing label for a newly discovered fact.' },
                  value: { type: 'string', description: 'Exact value as established in the conversation.' },
                  status: { type: 'string', enum: ['confirmed', 'observed', 'unavailable'] },
                  required: { type: 'boolean', description: 'Whether this fact must be resolved before task completion. Default true.' },
                  risk: { type: 'string', enum: ['normal', 'high'], description: 'Use high when a mistaken value could materially change money, timing, identity, quantity, commitment or outcome.' },
                  evidence: { type: 'string', description: 'Very short description of what established or failed to establish the fact.' },
                  reason: { type: 'string', description: 'Why unavailable or why the value remains uncertain, when relevant.' },
                },
                required: ['fact_key', 'status'],
              },
            },
            {
              type: 'function',
              name: 'complete_task',
              description: 'Attempt to finish the external conversation only after the user goal is achieved. The app will reject completion while required critical facts remain unresolved.',
              parameters: {
                type: 'object',
                properties: {
                  reason: { type: 'string', description: 'Short internal reason the goal is now complete.' },
                },
              },
            },
          ],
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
            text: `Begin now. Open the real conversation yourself in ${otherLanguage}, introduce yourself naturally as Ana, and immediately work toward the user's goal. Speak to the other person, not to the owner. Keep the critical-fact completion checklist current through the tools and finish as soon as the verified goal is achieved.`,
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
    if (pendingRef.current) return
    activeRef.current = true
    setMicEnabled(true)
    setSessionState('listening')
  }

  const listenForOwner = () => {
    if (!pendingRef.current || ownerListening || !speechSupported) return
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
    const current = pendingRef.current
    if (!answer || !current) return
    try { recognitionRef.current?.stop() } catch {}
    pendingRef.current = null
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
    pendingRef.current = null
    setPending(null)
    setDecision('')
    setOwnerListening(false)
    setInterim('')
    setSessionState('idle')
    awaitingClosingRef.current = false
    closingResponseRef.current = null
    if (returnToReady) setStage('ready')
  }

  const startOver = () => {
    endRealtime(false)
    setBriefing([{ role: 'ana', text: 'What do you need me to handle for you?' }])
    setBriefInput('')
    setContextSummary('')
    setKnownFacts([])
    replaceCriticalFacts([])
    historyRef.current = []
    setHistory([])
    setLatestOther('')
    setLatestAna('')
    setDebrief(null)
    setHomeLanguage('English')
    setOtherLanguage('German')
    setError('')
    setStage('briefing')
  }

  const verifiedCount = criticalFacts.filter(fact => fact.required && COMPLETE_STATUSES.has(fact.status)).length
  const requiredCount = criticalFacts.filter(fact => fact.required).length

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
      <p>Ana will open the conversation herself, verify what matters, and only interrupt you when your decision is actually needed.</p>
    </div>

    <div className="ready-card">
      <div className="ready-summary"><span>Your brief</span><p>{contextSummary}</p></div>
      {knownFacts.length > 0 && <div className="ready-facts">{knownFacts.map((fact, i) => <span key={i}>{fact}</span>)}</div>}
      {criticalFacts.length > 0 && <div className="verification-preview">
        <div className="verification-preview-head"><ShieldCheck size={17}/><div><strong>Ana will verify what matters</strong><span>{criticalFacts.filter(f => f.required).length} required detail{criticalFacts.filter(f => f.required).length === 1 ? '' : 's'} before handoff</span></div></div>
        <div className="verification-preview-list">{criticalFacts.filter(f => f.required).map(fact => <span key={fact.key}>{fact.label}{fact.risk === 'high' ? ' · double-check if unclear' : ''}</span>)}</div>
      </div>}
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

  if (stage === 'debrief') return <section className="talk-wrap ready-stage debrief-stage">
    <div className="talk-intro">
      <div className="eyebrow"><ShieldCheck size={14}/> Back to you</div>
      <h1>{debriefLoading ? 'Ana is checking the handoff…' : 'Here’s what you need to know.'}</h1>
      <p>{debriefLoading ? 'Using verified details from the conversation, not guesses.' : 'Important details below are grounded in the conversation verification state.'}</p>
    </div>

    <div className="ready-card debrief-card">
      {debriefLoading ? <div className="debrief-loading"><div className="brief-thinking"><i/><i/><i/></div><span>Preparing verified summary…</span></div> : <>
        {debrief && <div className={`debrief-status ${debrief.status}`}><ShieldCheck size={17}/><span>{debrief.status === 'completed' ? 'Completed' : debrief.status === 'action_required' ? 'Your action is needed' : 'Incomplete'}</span></div>}
        {debrief?.outcome && <div className="ready-summary"><span>What happened</span><p>{debrief.outcome}</p></div>}

        {criticalFacts.length > 0 && <div className="verified-facts-card">
          <div className="verified-facts-head"><ListChecks size={17}/><strong>Conversation facts</strong></div>
          {criticalFacts.filter(f => f.required || f.value).map(fact => <div className={`verified-fact ${fact.status}`} key={fact.key}>
            <span>{fact.label}</span>
            <strong>{fact.status === 'confirmed' ? (fact.value || 'Confirmed') : fact.status === 'unavailable' ? 'Unavailable' : fact.status === 'observed' ? `${fact.value || 'Heard'} · not verified` : 'Not resolved'}</strong>
          </div>)}
        </div>}

        {debrief?.nextSteps?.length > 0 && <div className="debrief-section"><span>What you need to do now</span>{debrief.nextSteps.map((step, i) => <p key={i}>• {step}</p>)}</div>}
        {debrief?.important?.length > 0 && <div className="debrief-section"><span>Important</span>{debrief.important.map((item, i) => <p key={i}>• {item}</p>)}</div>}
        {error && <div className="error brief-error">{error}</div>}
        <button className="magic-start" onClick={startOver}>Start a new conversation</button>
      </>}
    </div>
  </section>

  return <section className="talk-wrap voice-stage">
    <div className="voice-topbar">
      <div><span className="talk-kicker">Ana is handling</span><p>{contextSummary}</p></div>
      <button className="ghost" onClick={() => buildDebrief(true)}>End</button>
    </div>

    <div className={`voice-card${pending ? ' owner-pending' : ''}`}>
      {pending && <div className="owner-alert"><UserRound size={16}/><div><strong>Question for you</strong><span>Ana has paused the external conversation. Only you should answer now.</span></div></div>}
      <div className="voice-language"><Languages size={14}/><span>{homeLanguage}</span><span>↔</span><span>{otherLanguage}</span></div>

      {requiredCount > 0 && <div className="verification-live"><ShieldCheck size={14}/><span>{verifiedCount}/{requiredCount} key details resolved</span></div>}

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
