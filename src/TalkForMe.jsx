import { useEffect, useRef, useState } from 'react'
import { Check, Languages, Mic, Send, Sparkles, Square, Volume2, X } from 'lucide-react'

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
  if (!res.ok) throw new Error(data.error || 'Ana could not prepare a reply')
  return String(data.content || '').trim()
}

export default function TalkForMe() {
  const [goal, setGoal] = useState('')
  const [homeLanguage, setHomeLanguage] = useState('English')
  const [otherLanguage, setOtherLanguage] = useState('German')
  const [started, setStarted] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [heard, setHeard] = useState('')
  const [manualHeard, setManualHeard] = useState('')
  const [history, setHistory] = useState([])
  const [suggestion, setSuggestion] = useState(null)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef(null)
  const listeningRef = useRef(false)

  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => {
    listeningRef.current = false
    try { recognitionRef.current?.stop() } catch {}
    try { window.speechSynthesis?.cancel() } catch {}
  }, [])

  const stopListening = () => {
    listeningRef.current = false
    setListening(false)
    setInterim('')
    try { recognitionRef.current?.stop() } catch {}
  }

  const conversationForPrompt = history.map((turn, i) =>
    `${i + 1}. OTHER (${otherLanguage}): ${turn.other}\nANA (${otherLanguage}): ${turn.anaSpoken}`
  ).join('\n')

  const prepareReply = async rawHeard => {
    const text = String(rawHeard || '').trim()
    if (!text || thinking) return
    setThinking(true)
    setError('')
    setSuggestion(null)
    setHeard(text)
    try {
      const prompt = `USER GOAL:\n${goal}\n\nUSER'S PREFERRED LANGUAGE: ${homeLanguage}\nOTHER PERSON'S LANGUAGE: ${otherLanguage}\n\nCONVERSATION SO FAR:\n${conversationForPrompt || '(none yet)'}\n\nTHE OTHER PERSON JUST SAID:\n${text}\n\nPrepare Ana's next response. Return JSON only with this exact shape:\n{"meaning":"plain explanation in ${homeLanguage} of what the other person just said","replyForUser":"what Ana proposes to say, written naturally in ${homeLanguage}","spokenReply":"the exact reply Ana should speak in ${otherLanguage}","why":"one short sentence in ${homeLanguage} explaining why this reply moves the user's goal forward","sensitive":true|false,"sensitiveReason":"short reason or empty string"}`
      const instructions = `You are Ana, an assisted interpreter acting for a user during a real conversation. Keep the user's stated goal and conversation history in mind. Never invent facts, preferences, dates, prices, availability, identities or permissions. Never make a binding decision for the user. Mark sensitive=true if the proposed reply would confirm or choose an appointment/date/time, agree to a price/payment/purchase, accept terms, provide sensitive personal information, make a promise/commitment, or make any material choice. Even when sensitive=false, the user must still approve before Ana speaks. Be concise, natural and polite. Return valid JSON only.`
      const parsed = parseJson(await askAna(prompt, instructions))
      if (!parsed?.spokenReply) throw new Error('Ana returned an incomplete reply. Please try again.')
      setSuggestion({
        meaning: String(parsed.meaning || ''),
        replyForUser: String(parsed.replyForUser || ''),
        spokenReply: String(parsed.spokenReply || ''),
        why: String(parsed.why || ''),
        sensitive: Boolean(parsed.sensitive),
        sensitiveReason: String(parsed.sensitiveReason || ''),
      })
    } catch (err) {
      setError(err.message || 'Could not prepare a reply.')
    } finally {
      setThinking(false)
    }
  }

  const startListening = () => {
    setError('')
    setSuggestion(null)
    setHeard('')
    if (!supported) {
      setError('Microphone speech recognition is not supported in this browser. Type what the other person said below instead.')
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = LANGS.find(x => x.name === otherLanguage)?.code || 'en-US'
    recognition.onresult = event => {
      let live = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript?.trim() || ''
        if (event.results[i].isFinal) finalText += `${text} `
        else live += `${text} `
      }
      setInterim(live.trim())
      if (finalText.trim()) {
        stopListening()
        prepareReply(finalText.trim())
      }
    }
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setError('Microphone access is blocked. Allow microphone permission, or type what they said below.')
      else if (event.error !== 'no-speech' && event.error !== 'aborted') setError(`Microphone error: ${event.error}`)
      stopListening()
    }
    recognition.onend = () => {
      listeningRef.current = false
      setListening(false)
    }
    recognitionRef.current = recognition
    listeningRef.current = true
    setListening(true)
    try { recognition.start() } catch (err) {
      setError(err.message || 'Could not start microphone.')
      stopListening()
    }
  }

  const speak = text => {
    if (!('speechSynthesis' in window)) {
      setError('Spoken playback is not supported in this browser.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = LANGS.find(x => x.name === otherLanguage)?.code || 'en-US'
    utterance.rate = 0.96
    window.speechSynthesis.speak(utterance)
  }

  const approve = () => {
    if (!suggestion || !heard) return
    speak(suggestion.spokenReply)
    setHistory(prev => [...prev, {
      id: crypto.randomUUID(),
      other: heard,
      meaning: suggestion.meaning,
      anaHome: suggestion.replyForUser,
      anaSpoken: suggestion.spokenReply,
    }])
    setSuggestion(null)
    setHeard('')
    setManualHeard('')
  }

  const reset = () => {
    stopListening()
    try { window.speechSynthesis?.cancel() } catch {}
    setStarted(false)
    setHistory([])
    setSuggestion(null)
    setHeard('')
    setManualHeard('')
    setGoal('')
    setError('')
  }

  if (!started) return <section className="talk-wrap">
    <div className="talk-intro">
      <div className="eyebrow"><Sparkles size={14}/> Assisted interpreter</div>
      <h1>Tell Ana what you need.</h1>
      <p>Ana will listen, understand the conversation and prepare each reply. Nothing is spoken until you approve it.</p>
    </div>
    <div className="talk-setup-card">
      <label className="talk-goal-label">What do you want to achieve?</label>
      <textarea value={goal} onChange={e => setGoal(e.target.value)} placeholder="For example: I want to move my doctor appointment to next Tuesday afternoon." />
      <div className="talk-language-row">
        <label><span>I understand</span><select value={homeLanguage} onChange={e => setHomeLanguage(e.target.value)}>{LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
        <label><span>They speak</span><select value={otherLanguage} onChange={e => setOtherLanguage(e.target.value)}>{LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></label>
      </div>
      <button className="talk-start" disabled={!goal.trim()} onClick={() => setStarted(true)}>Start conversation <Send size={16}/></button>
      <p className="talk-safety-note">Ana suggests. You decide. Appointments, payments, commitments and other important choices always stay with you.</p>
    </div>
  </section>

  return <section className="talk-wrap conversation">
    <div className="talk-session-head">
      <div><span className="talk-kicker">Your goal</span><h2>{goal}</h2></div>
      <button className="ghost" onClick={reset}>End conversation</button>
    </div>

    <div className="talk-conversation-card">
      <div className="talk-session-toolbar"><Languages size={15}/><span>{homeLanguage}</span><span className="muted">↔</span><span>{otherLanguage}</span><div className="spacer"/><span className="talk-approval-status"><Check size={13}/> Approval required before every reply</span></div>

      <div className="talk-feed">
        {!history.length && !suggestion && !thinking && <div className="talk-empty"><strong>Ready.</strong><span>Tap “Listen to them” when the other person starts speaking.</span></div>}
        {history.map(turn => <article className="talk-turn" key={turn.id}>
          <div className="talk-other"><span>They said</span><p>{turn.other}</p>{turn.meaning && <small>{turn.meaning}</small>}</div>
          <div className="talk-ana"><span>Ana said</span><p>{turn.anaSpoken}</p><small>{turn.anaHome}</small><button onClick={() => speak(turn.anaSpoken)}><Volume2 size={14}/> Play again</button></div>
        </article>)}
        {(listening || interim) && <div className="talk-listening"><div className="talk-pulse"/><div><strong>Listening…</strong><p>{interim || 'Waiting for speech'}</p></div></div>}
        {thinking && <div className="talk-thinking"><span/><span/><span/> Ana is working out what to say next…</div>}
        {suggestion && <article className="talk-suggestion">
          <div className="talk-understood"><span>What they mean</span><p>{suggestion.meaning}</p></div>
          <div className="talk-proposal"><span>Ana proposes</span><p>{suggestion.replyForUser}</p><div className="talk-spoken"><Volume2 size={15}/><strong>{otherLanguage}</strong><p>{suggestion.spokenReply}</p></div>{suggestion.why && <small>{suggestion.why}</small>}</div>
          {suggestion.sensitive && <div className="talk-warning"><strong>Your decision is needed.</strong><span>{suggestion.sensitiveReason || 'This reply includes an important choice or commitment.'}</span></div>}
          <div className="talk-approve-row"><button className="talk-reject" onClick={() => { setSuggestion(null); setHeard('') }}><X size={16}/> Don’t say this</button><button className="talk-preview" onClick={() => speak(suggestion.spokenReply)}><Volume2 size={16}/> Preview</button><button className="talk-approve" onClick={approve}><Check size={16}/> Approve & speak</button></div>
        </article>}
      </div>

      {error && <div className="error talk-error">{error}</div>}

      <div className="talk-input-bar">
        <button className={`talk-listen${listening ? ' active' : ''}`} onClick={listening ? stopListening : startListening} disabled={thinking || Boolean(suggestion)}>{listening ? <Square size={18}/> : <Mic size={19}/>} {listening ? 'Stop' : 'Listen to them'}</button>
        <div className="talk-or">or</div>
        <input value={manualHeard} onChange={e => setManualHeard(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') prepareReply(manualHeard) }} placeholder="Type what they said…" disabled={thinking || Boolean(suggestion)}/>
        <button className="talk-send" disabled={!manualHeard.trim() || thinking || Boolean(suggestion)} onClick={() => prepareReply(manualHeard)}><Send size={17}/></button>
      </div>
    </div>
  </section>
}
