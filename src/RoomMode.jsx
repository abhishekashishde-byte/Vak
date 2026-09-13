import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, Mic, Plus, Square, Trash2, UsersRound, Volume2, X } from 'lucide-react'
import { getPersonalLanguageMemory } from './personalLanguageMemory.js'

const LANGUAGES = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const MAX_PARTICIPANTS = 4

const speechLocale = language => ({
  English: 'en-US',
  German: 'de-DE',
  'Swabian German (Schwäbisch)': 'de-DE',
  'Bavarian German (Bairisch)': 'de-DE',
  'Low German (Plattdeutsch)': 'de-DE',
  Hindi: 'hi-IN',
  Hinglish: 'hi-IN',
  Bengali: 'bn-IN',
  Tamil: 'ta-IN',
  Telugu: 'te-IN',
  Marathi: 'mr-IN',
  Gujarati: 'gu-IN',
  Punjabi: 'pa-IN',
  Malayalam: 'ml-IN',
  Kannada: 'kn-IN',
  Urdu: 'ur-IN',
  French: 'fr-FR',
  Spanish: 'es-ES',
  Italian: 'it-IT',
}[language] || 'en-US')

const clean = value => String(value || '').trim()

function parseJson(text = '') {
  const value = String(text || '').replace(/```json|```/g, '').trim()
  try { return JSON.parse(value) } catch {}
  const start = value.indexOf('[')
  const end = value.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try { return JSON.parse(value.slice(start, end + 1)) } catch {}
  }
  return null
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('Could not read the recording.'))
    reader.readAsDataURL(blob)
  })
}

async function transcribe(blob) {
  const audio = await toBase64(blob)
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm' }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not hear that clearly.')
  const text = clean(data.text)
  if (!text) throw new Error('Ana did not hear enough speech to translate.')
  return text
}

async function translateTurn(speaker, recipients, transcript) {
  const translated = recipients.filter(person => person.language !== speaker.language)
  const sameLanguage = recipients.filter(person => person.language === speaker.language)
  const results = sameLanguage.map(person => ({ participantId: person.id, language: person.language, text: transcript, translated: false }))
  if (!translated.length) return results

  const payload = translated.map(person => ({ participantId: person.id, name: person.name, language: person.language }))
  let instructions = `You are Ana inside a multi-person Conversation Room. ${speaker.name} has just spoken in ${speaker.language}. Translate that completed speech turn separately for each listed recipient. Preserve first-person perspective, intent, politeness, tone, names, numbers, dates and factual meaning. Do not answer the speaker, explain the message, summarize it, add advice or continue the conversation. If the source mixes languages, translate the intended meaning naturally. Return ONLY valid JSON in this shape: [{"participantId":"same-id","text":"translation"}]. Keep every participantId exactly unchanged.`
  if (translated.some(person => person.language === 'Hinglish')) instructions += ' For any Hinglish recipient, write natural conversational Hindi entirely in Roman/Latin letters; never use Devanagari.'

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: JSON.stringify({ speaker: { name: speaker.name, language: speaker.language }, transcript, recipients: payload }),
      instructions,
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not translate this turn.')
  const parsed = parseJson(data.content)
  if (!Array.isArray(parsed)) throw new Error('Ana could not keep the room translations aligned.')

  const byId = new Map(parsed.filter(item => item?.participantId).map(item => [String(item.participantId), clean(item.text)]))
  for (const person of translated) {
    const text = byId.get(person.id)
    if (!text) throw new Error(`Ana could not prepare ${person.name}'s translation.`)
    results.push({ participantId: person.id, language: person.language, text, translated: true })
  }
  return results
}

function defaultParticipants() {
  const memory = getPersonalLanguageMemory?.() || {}
  const owner = LANGUAGES.includes(memory.ownerLanguage) ? memory.ownerLanguage : 'English'
  const other = LANGUAGES.includes(memory.lastOtherLanguage) && memory.lastOtherLanguage !== owner ? memory.lastOtherLanguage : 'German'
  return [
    { id: 'room-p1', name: 'You', language: owner },
    { id: 'room-p2', name: 'Person 2', language: other },
  ]
}

export default function RoomMode() {
  const [stage, setStage] = useState('setup')
  const [participants, setParticipants] = useState(defaultParticipants)
  const [activeSpeaker, setActiveSpeaker] = useState(null)
  const [state, setState] = useState('idle')
  const [latestTurn, setLatestTurn] = useState(null)
  const [turns, setTurns] = useState([])
  const [error, setError] = useState('')

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const speakerRef = useRef(null)

  const processing = state === 'processing'
  const recording = state === 'recording'
  const canOpen = participants.length >= 2 && participants.every(person => clean(person.name) && LANGUAGES.includes(person.language))

  useEffect(() => () => stopRecording(true), [])

  const stopTracks = () => {
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
  }

  const updateParticipant = (id, patch) => {
    setParticipants(current => current.map(person => person.id === id ? { ...person, ...patch } : person))
  }

  const addParticipant = () => {
    if (participants.length >= MAX_PARTICIPANTS) return
    const index = participants.length + 1
    const fallback = ['French', 'Spanish', 'Italian'][Math.max(0, index - 3)] || 'English'
    setParticipants(current => [...current, { id: `room-p${Date.now()}`, name: `Person ${index}`, language: fallback }])
  }

  const removeParticipant = id => {
    if (participants.length <= 2) return
    setParticipants(current => current.filter(person => person.id !== id))
  }

  const openRoom = () => {
    if (!canOpen) return
    setError('')
    setTurns([])
    setLatestTurn(null)
    setStage('room')
  }

  const closeRoom = () => {
    stopRecording(true)
    try { window.speechSynthesis?.cancel?.() } catch {}
    setTurns([])
    setLatestTurn(null)
    setError('')
    setState('idle')
    setActiveSpeaker(null)
    setStage('setup')
  }

  const speakText = (text, language) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) return
    try { window.speechSynthesis.cancel() } catch {}
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = speechLocale(language)
    utterance.rate = 1
    window.speechSynthesis.speak(utterance)
  }

  const maybeAutoSpeak = (speaker, translations) => {
    const otherLanguages = [...new Set(translations.filter(item => item.language !== speaker.language).map(item => item.language))]
    if (otherLanguages.length !== 1) return
    const item = translations.find(value => value.language === otherLanguages[0])
    if (item?.text) setTimeout(() => speakText(item.text, item.language), 120)
  }

  const handleRecording = async (speakerId, blob) => {
    const speaker = participants.find(person => person.id === speakerId)
    if (!speaker) return
    setState('processing')
    setError('')
    try {
      const transcript = await transcribe(blob)
      const recipients = participants.filter(person => person.id !== speaker.id)
      const translations = await translateTurn(speaker, recipients, transcript)
      const turn = {
        id: `${Date.now()}-${Math.random()}`,
        speakerId: speaker.id,
        speakerName: speaker.name,
        speakerLanguage: speaker.language,
        transcript,
        translations,
      }
      setTurns(current => [...current, turn])
      setLatestTurn(turn)
      maybeAutoSpeak(speaker, translations)
    } catch (err) {
      setError(err.message || 'Ana could not translate that turn.')
    } finally {
      setState('idle')
      setActiveSpeaker(null)
      speakerRef.current = null
      chunksRef.current = []
      recorderRef.current = null
      stopTracks()
    }
  }

  const startSpeaking = async speakerId => {
    if (recording || processing) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser.')
      return
    }

    try {
      try { window.speechSynthesis?.cancel?.() } catch {}
      setError('')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported?.(type))
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      speakerRef.current = speakerId
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data?.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => {
        setError('The microphone stopped unexpectedly. Please try again.')
        setState('idle')
        setActiveSpeaker(null)
        recorderRef.current = null
        speakerRef.current = null
        chunksRef.current = []
        stopTracks()
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || preferred || 'audio/webm' })
        handleRecording(speakerId, blob)
      }
      recorder.start(250)
      setActiveSpeaker(speakerId)
      setState('recording')
    } catch {
      setError('Microphone permission is required to use Conversation Rooms.')
      setState('idle')
      setActiveSpeaker(null)
      stopTracks()
    }
  }

  function stopRecording(silent = false) {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      if (silent) {
        recorder.onstop = null
        recorder.onerror = null
      }
      try { recorder.stop() } catch {}
    }
    if (silent) {
      recorderRef.current = null
      speakerRef.current = null
      chunksRef.current = []
      stopTracks()
      setState('idle')
      setActiveSpeaker(null)
    }
  }

  const toggleSpeaker = id => {
    if (processing) return
    if (recording) {
      if (activeSpeaker === id) stopRecording(false)
      return
    }
    startSpeaking(id)
  }

  const participantById = useMemo(() => new Map(participants.map(person => [person.id, person])), [participants])

  if (stage === 'setup') return <section className="room-wrap room-setup">
    <header className="room-head">
      <div className="eyebrow"><UsersRound size={14}/> Conversation Room</div>
      <h1>One table. Different languages.</h1>
      <p>Add the people in the conversation and what each person understands. Ana translates every completed turn for the rest of the room.</p>
    </header>

    <div className="room-setup-card">
      <div className="room-setup-title"><div><strong>People in this room</strong><span>2–4 participants · one shared device</span></div><span className="room-count">{participants.length}/{MAX_PARTICIPANTS}</span></div>
      <div className="room-person-list">
        {participants.map((person, index) => <div className="room-person-row" key={person.id}>
          <span className="room-person-number">{index + 1}</span>
          <input aria-label={`Participant ${index + 1} name`} value={person.name} onChange={e => updateParticipant(person.id, { name: e.target.value })} maxLength={28}/>
          <select aria-label={`${person.name} language`} value={person.language} onChange={e => updateParticipant(person.id, { language: e.target.value })}>
            {LANGUAGES.map(language => <option key={language}>{language}</option>)}
          </select>
          <button className="room-remove" onClick={() => removeParticipant(person.id)} disabled={participants.length <= 2} title="Remove participant"><Trash2 size={15}/></button>
        </div>)}
      </div>
      {participants.length < MAX_PARTICIPANTS && <button className="room-add" onClick={addParticipant}><Plus size={16}/> Add person</button>}

      <div className="room-explainer">
        <Check size={16}/><p><strong>Why people tap their own card:</strong> one phone cannot reliably distinguish two nearby people who speak the same language. A quick tap keeps speaker identity accurate.</p>
      </div>
      <div className="room-explainer quiet"><Check size={16}/><p>With two people, Ana automatically speaks the translation aloud. With several target languages, everyone gets their own translation card instead of Ana talking through multiple languages in sequence.</p></div>

      <button className="room-start" onClick={openRoom} disabled={!canOpen}><UsersRound size={18}/> Open room</button>
      <div className="room-privacy-note">Conversation text stays in this room session and is not added to personal language memory.</div>
    </div>
  </section>

  return <section className="room-wrap room-active">
    <div className="room-topbar">
      <div><span className="room-kicker"><UsersRound size={14}/> Conversation Room</span><strong>{participants.length} people</strong></div>
      <button onClick={closeRoom}><X size={16}/> End room</button>
    </div>

    <div className="room-participants">
      {participants.map(person => {
        const isRecording = recording && activeSpeaker === person.id
        const blocked = processing || (recording && activeSpeaker !== person.id)
        return <button key={person.id} className={`room-speaker-card${isRecording ? ' recording' : ''}`} onClick={() => toggleSpeaker(person.id)} disabled={blocked}>
          <span className="room-speaker-avatar">{clean(person.name).charAt(0).toUpperCase() || '?'}</span>
          <span className="room-speaker-copy"><strong>{person.name}</strong><small>{person.language}</small></span>
          <span className="room-speaker-action">{isRecording ? <><Square size={17}/> Tap to finish</> : processing && activeSpeaker === person.id ? <><LoaderCircle className="spin" size={17}/> Translating</> : <><Mic size={17}/> Tap to speak</>}</span>
        </button>
      })}
    </div>

    <div className={`room-stage-card ${state}`}>
      {recording ? <div className="room-status recording"><span className="room-live-dot"/><div><strong>Listening to {participantById.get(activeSpeaker)?.name || 'speaker'}</strong><span>Speak naturally, then tap the same card when finished.</span></div></div>
        : processing ? <div className="room-status"><LoaderCircle className="spin" size={22}/><div><strong>Ana is translating this turn</strong><span>Each person gets the message in their own language.</span></div></div>
          : !latestTurn ? <div className="room-empty"><UsersRound size={30}/><strong>Ready for the first speaker</strong><span>Tap your own card, speak, then tap again when you are done.</span></div>
            : <div className="room-latest">
              <div className="room-original"><span>{latestTurn.speakerName} · {latestTurn.speakerLanguage}</span><p>{latestTurn.transcript}</p></div>
              <div className="room-translations">
                {latestTurn.translations.map(item => {
                  const recipient = participantById.get(item.participantId)
                  if (!recipient) return null
                  return <article key={item.participantId}>
                    <div><span>For {recipient.name}</span><small>{recipient.language}</small></div>
                    <p>{item.text}</p>
                    {item.translated && <button onClick={() => speakText(item.text, recipient.language)} title={`Play for ${recipient.name}`}><Volume2 size={16}/> Hear it</button>}
                  </article>
                })}
              </div>
            </div>}
    </div>

    {error && <div className="room-error">{error}</div>}

    {turns.length > 0 && <details className="room-history">
      <summary>Room transcript · {turns.length} turn{turns.length === 1 ? '' : 's'}</summary>
      <div>{turns.map(turn => <article key={turn.id}>
        <div className="room-history-source"><span>{turn.speakerName} · {turn.speakerLanguage}</span><p>{turn.transcript}</p></div>
        {turn.translations.filter(item => item.translated).map(item => {
          const recipient = participantById.get(item.participantId)
          return recipient ? <div key={item.participantId}><span>→ {recipient.name} · {recipient.language}</span><p>{item.text}</p></div> : null
        })}
      </article>)}</div>
    </details>}
  </section>
}
