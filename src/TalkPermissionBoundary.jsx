import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { createTalkPermissionSession, getTalkDisclosure, recordTalkPermissionOutcome } from './talkConsent.js'

const isoFor = language => ({
  English: 'en', German: 'de', 'Swabian German (Schwäbisch)': 'de', 'Bavarian German (Bairisch)': 'de', 'Low German (Plattdeutsch)': 'de',
  Hindi: 'hi', Hinglish: 'hi', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa', Malayalam: 'ml', Kannada: 'kn', Urdu: 'ur',
  French: 'fr', Spanish: 'es', Italian: 'it',
}[language] || 'en')

export default function TalkPermissionBoundary({ children }) {
  const rootRef = useRef(null)
  const peerRef = useRef(null)
  const dataRef = useRef(null)
  const streamRef = useRef(null)
  const audioRef = useRef(null)
  const pendingButtonRef = useRef(null)
  const bypassButtonRef = useRef(null)
  const disclosureResponseRef = useRef(null)
  const permissionSessionRef = useRef(null)
  const statusRef = useRef('idle')

  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [language, setLanguage] = useState('English')
  const [heard, setHeard] = useState('')
  const [error, setError] = useState('')

  useEffect(() => () => cleanup(), [])

  const setPermissionStatus = value => {
    statusRef.current = value
    setStatus(value)
  }

  const setMicEnabled = enabled => {
    streamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  }

  const send = event => {
    if (dataRef.current?.readyState === 'open') dataRef.current.send(JSON.stringify(event))
  }

  const cleanup = () => {
    try { dataRef.current?.close() } catch {}
    dataRef.current = null
    try { peerRef.current?.close() } catch {}
    peerRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    if (audioRef.current) {
      try { audioRef.current.pause() } catch {}
      audioRef.current.srcObject = null
    }
    audioRef.current = null
    disclosureResponseRef.current = null
  }

  const proceed = () => {
    const button = pendingButtonRef.current
    if (!button?.isConnected) return
    pendingButtonRef.current = null
    bypassButtonRef.current = button
    button.dataset.anaPrivacyBypass = '1'
    setOpen(false)
    setPermissionStatus('idle')
    queueMicrotask(() => button.click())
  }

  const accept = () => {
    if (!permissionSessionRef.current || statusRef.current === 'accepted') return
    recordTalkPermissionOutcome(permissionSessionRef.current, 'accepted')
    setPermissionStatus('accepted')
    setMicEnabled(false)
    cleanup()
    setTimeout(proceed, 260)
  }

  const decline = (outcome = 'declined') => {
    if (permissionSessionRef.current) recordTalkPermissionOutcome(permissionSessionRef.current, outcome)
    setMicEnabled(false)
    cleanup()
    setPermissionStatus(outcome === 'withdrawn' ? 'withdrawn' : 'declined')
  }

  const handlePermissionTool = item => {
    let args = {}
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    const decision = ['accepted', 'declined', 'unclear'].includes(args.decision) ? args.decision : 'unclear'
    if (decision === 'accepted') {
      accept()
      return
    }
    if (decision === 'declined') {
      decline('declined')
      return
    }

    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ accepted: false, unclear: true }) } })
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `The answer was unclear. Ask only one short question in ${language}: whether they agree to continue with Ana and AI voice processing. Do not discuss the user's task.` }] } })
    send({ type: 'response.create' })
    setPermissionStatus('awaiting')
  }

  const handleRealtimeEvent = event => {
    if (event.type === 'response.created' && statusRef.current === 'disclosing' && !disclosureResponseRef.current) {
      disclosureResponseRef.current = event.response?.id || null
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(event.transcript || '').trim()
      if (text) setHeard(text)
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call' && event.item?.name === 'record_counterparty_permission') {
      handlePermissionTool(event.item)
    }
    if (event.type === 'response.done' && disclosureResponseRef.current && event.response?.id === disclosureResponseRef.current) {
      disclosureResponseRef.current = null
      setPermissionStatus('awaiting')
      setMicEnabled(true)
    }
    if (event.type === 'error') {
      setError(event.error?.message || 'Ana could not complete the permission check.')
      setPermissionStatus('error')
      setMicEnabled(false)
    }
  }

  const startPermission = async nextLanguage => {
    cleanup()
    setLanguage(nextLanguage)
    setHeard('')
    setError('')
    setOpen(true)
    setPermissionStatus('connecting')
    permissionSessionRef.current = createTalkPermissionSession(nextLanguage)

    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana voice.')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      streamRef.current = stream
      const micTrack = stream.getAudioTracks()[0]
      micTrack.enabled = false

      const pc = new RTCPeerConnection()
      peerRef.current = pc
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.playsInline = true
      audioRef.current = audio
      pc.ontrack = event => {
        audio.srcObject = event.streams[0]
        audio.play?.().catch(() => {})
      }
      pc.addTrack(micTrack, stream)

      const dc = pc.createDataChannel('oai-events')
      dataRef.current = dc
      dc.addEventListener('message', message => {
        try { handleRealtimeEvent(JSON.parse(message.data)) } catch {}
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', body: offer.sdp,
        headers: { Authorization: `Bearer ${tokenData.value}`, 'Content-Type': 'application/sdp' },
      })
      const answer = await sdpResponse.text()
      if (!sdpResponse.ok) throw new Error(answer || 'Could not connect Ana voice.')
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ana permission check timed out.')), 10000)
        dc.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
        dc.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Ana permission check could not connect.')) }, { once: true })
      })

      send({
        type: 'session.update',
        session: {
          type: 'realtime', model: 'gpt-realtime-2.1',
          instructions: `You are only Ana's mandatory counterparty permission gate. Do not reveal or discuss the user's task. The app will give you fixed disclosure text. Speak it faithfully. After it finishes, listen for whether the other person agrees to continue with AI voice processing. Silence, unrelated speech and politeness are not consent. On a clear yes, call record_counterparty_permission with accepted. On a clear no or objection, call it with declined. If genuinely unclear, call it with unclear and then ask only one short clarification in ${nextLanguage}.`,
          audio: {
            output: { voice: 'marin' },
            input: {
              transcription: { model: 'gpt-live-transcribe', languages: [isoFor(nextLanguage)], delay: 'low' },
              turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true },
            },
          },
          tools: [{
            type: 'function', name: 'record_counterparty_permission',
            description: 'Classify only the other person’s response to the mandatory AI disclosure.',
            parameters: { type: 'object', properties: { decision: { type: 'string', enum: ['accepted', 'declined', 'unclear'] } }, required: ['decision'] },
          }],
          tool_choice: 'auto',
        },
      })

      setPermissionStatus('disclosing')
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Read this exact disclosure to the other person. Do not add task details: ${getTalkDisclosure(nextLanguage)}` }] } })
      send({ type: 'response.create' })
    } catch (err) {
      cleanup()
      setError(err.message || 'Ana could not start the permission check.')
      setPermissionStatus('error')
    }
  }

  const handleCapture = event => {
    const button = event.target?.closest?.('button')
    if (!button || !rootRef.current?.contains(button)) return
    if (button === bypassButtonRef.current) {
      bypassButtonRef.current = null
      return
    }
    if (!button.classList.contains('magic-start') || !/start conversation/i.test(button.textContent || '')) return

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent?.stopImmediatePropagation?.()
    pendingButtonRef.current = button
    const selects = rootRef.current.querySelectorAll('.ready-languages select')
    const nextLanguage = selects?.[1]?.value || 'English'
    startPermission(nextLanguage)
  }

  const cancel = () => {
    cleanup()
    pendingButtonRef.current = null
    setOpen(false)
    setPermissionStatus('idle')
  }

  return <div ref={rootRef} onClickCapture={handleCapture}>
    {children}
    {open && <div className="talk-permission-layer" role="presentation">
      <section className="talk-permission-card" role="dialog" aria-modal="true" aria-label="Permission before Talk for Me">
        <div className="talk-permission-head"><div><span>Before Ana begins</span><h2>AI disclosure & permission</h2></div><button onClick={cancel} aria-label="Cancel"><X size={19}/></button></div>
        <div className="talk-permission-language">{language}</div>
        <p className="talk-permission-copy">{getTalkDisclosure(language)}</p>

        <div className={`talk-permission-status ${status}`}>
          {status === 'connecting' && <><LoaderCircle className="spin" size={18}/><span>Connecting for the permission check…</span></>}
          {status === 'disclosing' && <><ShieldCheck size={18}/><span>Ana is reading the fixed AI disclosure. The other-person microphone is still off.</span></>}
          {status === 'awaiting' && <><ShieldCheck size={18}/><span>Waiting for the other person’s answer. The task has not started.</span></>}
          {status === 'accepted' && <><Check size={18}/><span>Permission received. Starting the task.</span></>}
          {status === 'declined' && <><ShieldCheck size={18}/><span>They chose not to continue. Ana will not start the task.</span></>}
          {status === 'withdrawn' && <><ShieldCheck size={18}/><span>Permission was withdrawn. Ana stopped.</span></>}
          {status === 'error' && <><ShieldCheck size={18}/><span>{error || 'Permission could not be established.'}</span></>}
        </div>

        {heard && status === 'awaiting' && <div className="talk-permission-heard"><span>Ana heard</span><p>{heard}</p></div>}

        {status === 'awaiting' && <div className="talk-permission-counterparty">
          <span>The other person can answer aloud, or use these buttons directly:</span>
          <div><button className="permission-no" onClick={() => decline('declined')}>No thanks</button><button className="permission-yes" onClick={accept}>Continue</button></div>
        </div>}

        {(status === 'declined' || status === 'withdrawn' || status === 'error') && <button className="permission-close" onClick={cancel}>Close</button>}
        <small>Ana stores only a minimal local permission receipt: session ID, notice version, language, time and accepted/declined status. No consent audio is stored by Ana.</small>
      </section>
    </div>}
  </div>
}
