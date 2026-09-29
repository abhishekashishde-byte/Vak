import { useEffect, useRef, useState } from 'react'
import { Check, CheckSquare, CornerDownLeft, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react'
import './meeting-scribble.css'

const STORAGE_KEY = 'ana-meeting-scribble-v1'

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}

function latestWritableSegment(text = '') {
  const source = String(text)
  if (!source.trim()) return null
  const lines = source.split('\n')
  let offset = 0
  const ranges = lines.map(line => {
    const start = offset
    const end = start + line.length
    offset = end + 1
    return { start, end, text: line }
  })
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const item = ranges[index]
    const trimmed = item.text.trim()
    if (!trimmed) continue
    const leading = item.text.length - item.text.trimStart().length
    return { start: item.start + leading, end: item.end, text: trimmed }
  }
  return null
}

export default function MeetingScribble() {
  const saved = readSaved()
  const [text, setText] = useState(String(saved.text || ''))
  const [layout, setLayout] = useState(['sentence','lined','todo'].includes(saved.layout) ? saved.layout : 'lined')
  const [autoFix, setAutoFix] = useState(saved.autoFix !== false)
  const [meetingStartedAt, setMeetingStartedAt] = useState(Number(saved.meetingStartedAt) || 0)
  const [meetingActive, setMeetingActive] = useState(Boolean(saved.meetingActive))
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const textareaRef = useRef(null)
  const fixTimerRef = useRef(null)
  const processedRef = useRef(new Set())
  const requestRef = useRef(0)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, layout, autoFix, meetingStartedAt, meetingActive })) } catch {}
  }, [text, layout, autoFix, meetingStartedAt, meetingActive])

  useEffect(() => {
    const onMeetingStarted = event => {
      const startedAt = Number(event?.detail?.startedAt) || Date.now()
      clearTimeout(fixTimerRef.current)
      requestRef.current += 1
      processedRef.current.clear()
      setText('')
      setMeetingStartedAt(startedAt)
      setMeetingActive(true)
      setError('')
      setStatus('Fresh meeting pad started.')
      setTimeout(() => setStatus(''), 1400)
    }
    const onMeetingEnded = () => {
      clearTimeout(fixTimerRef.current)
      setMeetingActive(false)
      setStatus('Meeting pad saved with this meeting.')
      setTimeout(() => setStatus(''), 1600)
    }
    window.addEventListener('ana:meeting-started', onMeetingStarted)
    window.addEventListener('ana:meeting-ended', onMeetingEnded)
    return () => {
      clearTimeout(fixTimerRef.current)
      window.removeEventListener('ana:meeting-started', onMeetingStarted)
      window.removeEventListener('ana:meeting-ended', onMeetingEnded)
    }
  }, [])

  const correctSegment = async candidate => {
    if (!candidate?.text) return
    const requestId = ++requestRef.current
    setStatus('Auto-correcting…')
    setError('')
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: candidate.text,
          instructions: 'You are correcting text produced by Apple Pencil Scribble during a meeting. Fix only obvious handwriting-recognition mistakes, spelling, grammar, duplicated words, or missing words when the intended meaning is clear. Preserve the user\'s meaning, language, tone, names, numbers, SAP/technical terms, abbreviations, and shorthand. Do not translate. Do not expand the note into a longer sentence. If the text is already correct, return it unchanged. Return only the corrected text, with no quotes or explanation.',
        }),
      })
      const raw = await response.text()
      let data = {}
      try { data = raw ? JSON.parse(raw) : {} } catch {}
      if (!response.ok) throw new Error(data?.error || 'Ana could not correct this note.')
      const corrected = String(data?.content || '').trim()
      if (!corrected || requestId !== requestRef.current) return
      setText(current => {
        const currentSlice = current.slice(candidate.start, candidate.end).trim()
        if (currentSlice !== candidate.text) return current
        return current.slice(0, candidate.start) + corrected + current.slice(candidate.end)
      })
      setStatus(corrected === candidate.text ? 'Looks good.' : 'Auto-corrected.')
      setTimeout(() => setStatus(''), 1100)
    } catch (err) {
      if (requestId !== requestRef.current) return
      setStatus('')
      setError(err?.message || 'Ana could not correct this note.')
    }
  }

  const scheduleCorrection = (value, delay = 950) => {
    clearTimeout(fixTimerRef.current)
    if (!autoFix) return
    const candidate = latestWritableSegment(value)
    if (!candidate || candidate.text.length < 2) return
    const signature = `${candidate.start}:${candidate.end}:${candidate.text}`
    if (processedRef.current.has(signature)) return
    fixTimerRef.current = setTimeout(() => {
      processedRef.current.add(signature)
      void correctSegment(candidate)
    }, delay)
  }

  const handleChange = event => {
    const value = event.target.value
    setText(value)
    setError('')
    scheduleCorrection(value)
  }

  const insertNewLine = () => {
    const node = textareaRef.current
    const start = Number.isFinite(node?.selectionStart) ? node.selectionStart : text.length
    const end = Number.isFinite(node?.selectionEnd) ? node.selectionEnd : start
    const next = text.slice(0, start) + '\n' + text.slice(end)
    setText(next)
    setError('')
    scheduleCorrection(next, 80)
    requestAnimationFrame(() => {
      if (!node) return
      node.focus({ preventScroll: true })
      node.selectionStart = node.selectionEnd = start + 1
    })
  }

  const correctLatestNow = () => {
    clearTimeout(fixTimerRef.current)
    const candidate = latestWritableSegment(text)
    if (!candidate) {
      setError('Write something first.')
      return
    }
    void correctSegment(candidate)
  }

  const clearPad = () => {
    clearTimeout(fixTimerRef.current)
    requestRef.current += 1
    processedRef.current.clear()
    setText('')
    setError('')
    setStatus('')
    textareaRef.current?.focus?.({ preventScroll: true })
  }

  const placeholder = layout === 'todo'
    ? 'Write the first action or point with Apple Pencil…'
    : layout === 'lined'
      ? 'Write here with Apple Pencil…'
      : 'Write a sentence with Apple Pencil…'

  return <section className={`meeting-scribble ${meetingActive ? 'active-meeting' : ''}`}>
    <div className="meeting-scribble-head">
      <div>
        <span className="meeting-scribble-kicker"><Pencil size={14}/> Meeting Scribble {meetingActive ? '· active' : ''}</span>
        <h2>Write normally. iPad turns your Pencil into text.</h2>
        <p>Ana can clean up recognition mistakes automatically after you pause. No full stop is required.</p>
      </div>
      <div className="meeting-scribble-layout" aria-label="Scribble layout">
        <button type="button" className={layout === 'sentence' ? 'active' : ''} onClick={() => setLayout('sentence')}><FileText size={14}/> Sentence</button>
        <button type="button" className={layout === 'lined' ? 'active' : ''} onClick={() => setLayout('lined')}><Pencil size={14}/> Lined</button>
        <button type="button" className={layout === 'todo' ? 'active' : ''} onClick={() => setLayout('todo')}><CheckSquare size={14}/> To-do</button>
      </div>
    </div>

    <div className="meeting-scribble-options">
      <label>
        <input type="checkbox" checked={autoFix} onChange={event => { setAutoFix(event.target.checked); if (event.target.checked) scheduleCorrection(text, 250) }}/>
        <span><strong>Auto-correct Scribble</strong><small>On by default. Ana fixes the latest line after you pause briefly, without changing the meaning.</small></span>
      </label>
      <div className="meeting-scribble-actions">
        <button type="button" className="meeting-scribble-enter" onClick={insertNewLine}><CornerDownLeft size={14}/> {layout === 'todo' ? 'Next item' : 'Enter / new line'}</button>
        <button type="button" onClick={correctLatestNow} disabled={!text.trim()}><Sparkles size={14}/> Correct now</button>
        <button type="button" onClick={clearPad} disabled={!text}><Trash2 size={14}/> Clear</button>
      </div>
    </div>

    <div className={`meeting-scribble-pad ${layout}`}>
      {layout === 'todo' && <div className="meeting-scribble-todo-gutter" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <span key={index}/>)}</div>}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        inputMode="text"
        enterKeyHint="enter"
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck={true}
        placeholder={placeholder}
        aria-label="Meeting Scribble writing area"
      />
    </div>

    <div className="meeting-scribble-foot">
      <span>{status ? <><Check size={13}/> {status}</> : meetingActive ? 'This pad belongs to the meeting in progress.' : 'It will reset automatically when you start the next meeting.'}</span>
      <span>{text.length.toLocaleString()} characters</span>
    </div>
    {error && <div className="meeting-scribble-error">{error}</div>}
  </section>
}
