import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Languages, Mic, Square, Trash2 } from 'lucide-react'

const LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]

async function translateText(text, target) {
  const instructions = `You are Ana, a live interpreter. Translate the spoken text into ${target}. Return ONLY the translation. Keep it natural, concise and faithful to the speaker's meaning and tone. Do not explain.`
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Live translation failed')
  return String(data.content || '').trim()
}

export default function LiveMode() {
  const [source, setSource] = useState('German')
  const [target, setTarget] = useState('English')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [turns, setTurns] = useState([])
  const [error, setError] = useState('')
  const recognitionRef = useRef(null)
  const listeningRef = useRef(false)

  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => () => {
    listeningRef.current = false
    try { recognitionRef.current?.stop() } catch {}
  }, [])

  const stop = () => {
    listeningRef.current = false
    setListening(false)
    setInterim('')
    try { recognitionRef.current?.stop() } catch {}
  }

  const start = () => {
    setError('')
    if (!supported) {
      setError('Live listening is not supported in this browser yet. Try Chrome on Android or desktop.')
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = LANGS.find(x => x.name === source)?.code || 'en-US'

    recognition.onresult = event => {
      let live = ''
      const finalParts = []
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript?.trim()
        if (!text) continue
        if (event.results[i].isFinal) finalParts.push(text)
        else live += `${text} `
      }
      setInterim(live.trim())
      finalParts.forEach(async text => {
        const id = crypto.randomUUID()
        setTurns(prev => [...prev, { id, original: text, translated: '', loading: true }])
        try {
          const translated = await translateText(text, target)
          setTurns(prev => prev.map(t => t.id === id ? { ...t, translated, loading: false } : t))
        } catch (err) {
          setTurns(prev => prev.map(t => t.id === id ? { ...t, translated: 'Could not translate this part.', loading: false, failed: true } : t))
        }
      })
    }

    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access is blocked. Allow microphone permission for Ana and try again.')
        stop()
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`Microphone error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      if (listeningRef.current) {
        try { recognition.start() } catch {}
      }
    }

    recognitionRef.current = recognition
    listeningRef.current = true
    setListening(true)
    try { recognition.start() } catch (err) {
      setError(err.message || 'Could not start microphone.')
      stop()
    }
  }

  return <section className="live-wrap">
    <div className="live-head">
      <div>
        <div className="eyebrow"><Mic size={14}/> Live interpretation</div>
        <h1>Speak. Ana translates.</h1>
        <p>Keep talking naturally. Ana turns each finished phrase into the other language.</p>
      </div>
    </div>

    <div className="live-card">
      <div className="live-toolbar">
        <div className="live-lang"><Languages size={16}/><select value={source} onChange={e => setSource(e.target.value)} disabled={listening}>{LANGS.map(x => <option key={x.name}>{x.name}</option>)}</select></div>
        <ArrowLeftRight size={16} className="muted"/>
        <div className="live-lang"><select value={target} onChange={e => setTarget(e.target.value)} disabled={listening}>{LANGS.filter(x => x.name !== source).map(x => <option key={x.name}>{x.name}</option>)}</select></div>
        <div className="spacer"/>
        <button className="ghost icon-text" onClick={() => { setTurns([]); setInterim(''); setError('') }}><Trash2 size={15}/> Clear</button>
      </div>

      <div className="live-feed">
        {!turns.length && !interim && <div className="live-empty">Tap the microphone and start speaking.</div>}
        {turns.map(turn => <article className="live-turn" key={turn.id}>
          <div className="live-original"><span>{source}</span><p>{turn.original}</p></div>
          <div className={`live-translation${turn.failed ? ' failed' : ''}`}><span>{target}</span><p>{turn.loading ? 'Translating…' : turn.translated}</p></div>
        </article>)}
        {interim && <article className="live-turn interim"><div className="live-original"><span>Listening…</span><p>{interim}</p></div></article>}
      </div>

      {error && <div className="error live-error">{error}</div>}

      <div className="live-controls">
        <button className={`live-mic${listening ? ' active' : ''}`} onClick={listening ? stop : start}>
          {listening ? <Square size={20}/> : <Mic size={22}/>}<span>{listening ? 'Stop listening' : 'Start listening'}</span>
        </button>
        <div className={`live-status${listening ? ' on' : ''}`}>{listening ? 'Listening now' : 'Microphone off'}</div>
      </div>
    </div>
  </section>
}
