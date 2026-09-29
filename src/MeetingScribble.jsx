import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react'
import './meeting-scribble.css'

const STORAGE_KEY = 'ana-meeting-scribble-v1'

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}

function completeSentences(text = '') {
  const source = String(text)
  const matches = []
  const re = /[^.!?\n]+(?:[.!?]+|\n)/g
  let match
  while ((match = re.exec(source))) {
    const raw = match[0]
    const leading = raw.length - raw.trimStart().length
    const cleaned = raw.trim()
    if (!cleaned) continue
    const start = match.index + leading
    matches.push({ start, end: match.index + raw.length, text: cleaned })
  }
  return matches
}

export default function MeetingScribble() {
  const saved = readSaved()
  const [text, setText] = useState(String(saved.text || ''))
  const [layout, setLayout] = useState(saved.layout === 'sentence' ? 'sentence' : 'lined')
  const [autoFix, setAutoFix] = useState(Boolean(saved.autoFix))
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const textareaRef = useRef(null)
  const fixTimerRef = useRef(null)
  const processedRef = useRef(new Set())
  const requestRef = useRef(0)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, layout, autoFix })) } catch {}
  }, [text, layout, autoFix])

  useEffect(() => () => clearTimeout(fixTimerRef.current), [])

  const correctSentence = async candidate => {
    const requestId = ++requestRef.current
    setStatus('Correcting last sentence…')
    setError('')
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: candidate.text,
          instructions: 'You are correcting text produced by Apple Pencil Scribble. Fix only obvious handwriting-recognition mistakes, spelling, grammar, and missing or duplicated words when the intended sentence is clear. Preserve the user\'s meaning, language, tone, names, numbers, and technical terms. Do not translate. Do not add new information. If the sentence is already correct, return it unchanged. Return only the corrected sentence, with no quotes or explanation.',
        }),
      })
      const raw = await response.text()
      let data = {}
      try { data = raw ? JSON.parse(raw) : {} } catch {}
      if (!response.ok) throw new Error(data?.error || 'Ana could not correct that sentence.')
      const corrected = String(data?.content || '').trim()
      if (!corrected || requestId !== requestRef.current) return
      setText(current => {
        const currentSlice = current.slice(candidate.start, candidate.end).trim()
        if (currentSlice !== candidate.text) return current
        const originalChunk = current.slice(candidate.start, candidate.end)
        const hadNewline = /\n$/.test(originalChunk)
        const replacement = corrected + (hadNewline && !corrected.endsWith('\n') ? '\n' : '')
        return current.slice(0, candidate.start) + replacement + current.slice(candidate.end)
      })
      setStatus(corrected === candidate.text ? 'Sentence looks good.' : 'Sentence corrected.')
      setTimeout(() => setStatus(''), 1300)
    } catch (err) {
      setStatus('')
      setError(err?.message || 'Ana could not correct that sentence.')
    }
  }

  const scheduleCorrection = value => {
    if (!autoFix) return
    const candidates = completeSentences(value)
    const candidate = candidates.at(-1)
    if (!candidate) return
    const signature = `${candidate.start}:${candidate.end}:${candidate.text}`
    if (processedRef.current.has(signature)) return
    processedRef.current.add(signature)
    clearTimeout(fixTimerRef.current)
    fixTimerRef.current = setTimeout(() => void correctSentence(candidate), 220)
  }

  const handleChange = event => {
    const value = event.target.value
    setText(value)
    scheduleCorrection(value)
  }

  const correctLatestNow = () => {
    const candidates = completeSentences(text)
    const candidate = candidates.at(-1)
    if (!candidate) {
      setError('Finish the sentence with a full stop, question mark, exclamation mark, or Enter first.')
      return
    }
    void correctSentence(candidate)
  }

  return <section className="meeting-scribble">
    <div className="meeting-scribble-head">
      <div>
        <span className="meeting-scribble-kicker"><Pencil size={14}/> Scribble</span>
        <h2>Write with Apple Pencil. Let iPad turn it into text.</h2>
        <p>This uses the normal iPadOS Scribble text input instead of Ana’s old handwriting canvas.</p>
      </div>
      <div className="meeting-scribble-layout" aria-label="Scribble layout">
        <button type="button" className={layout === 'sentence' ? 'active' : ''} onClick={() => setLayout('sentence')}><FileText size={14}/> Sentence</button>
        <button type="button" className={layout === 'lined' ? 'active' : ''} onClick={() => setLayout('lined')}><Pencil size={14}/> Lined sheet</button>
      </div>
    </div>

    <div className="meeting-scribble-options">
      <label>
        <input type="checkbox" checked={autoFix} onChange={event => setAutoFix(event.target.checked)}/>
        <span><strong>Fix each finished sentence with Ana</strong><small>After a full stop, ?, !, or Enter, Ana fixes obvious Scribble or grammar mistakes without changing your meaning.</small></span>
      </label>
      <div className="meeting-scribble-actions">
        <button type="button" onClick={correctLatestNow} disabled={!text.trim()}><Sparkles size={14}/> Correct last sentence</button>
        <button type="button" onClick={() => { setText(''); processedRef.current.clear(); setError(''); setStatus('') }} disabled={!text}><Trash2 size={14}/> Clear</button>
      </div>
    </div>

    <div className={`meeting-scribble-pad ${layout === 'lined' ? 'lined' : 'sentence'}`}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        inputMode="text"
        enterKeyHint="enter"
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck={true}
        placeholder={layout === 'lined' ? 'Write here with Apple Pencil…' : 'Write one sentence with Apple Pencil…'}
        aria-label="Meeting Scribble writing area"
      />
    </div>

    <div className="meeting-scribble-foot">
      <span>{status ? <><Check size={13}/> {status}</> : 'Tip: iPad Settings → Apple Pencil → Scribble must be enabled.'}</span>
      <span>{text.length.toLocaleString()} characters</span>
    </div>
    {error && <div className="meeting-scribble-error">{error}</div>}
  </section>
}
