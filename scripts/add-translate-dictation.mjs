import fs from 'node:fs'

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from)
  if (first < 0) throw new Error(`Missing anchor: ${label}`)
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`Anchor is not unique: ${label}`)
  return text.slice(0, first) + to + text.slice(first + from.length)
}

const appPath = 'src/App.jsx'
let app = fs.readFileSync(appPath, 'utf8')

app = replaceOnce(
  app,
  "import { ArrowLeftRight, Check, Clipboard, Languages, LogOut, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'",
  "import { ArrowLeftRight, Check, Clipboard, Languages, LoaderCircle, LogOut, Mic, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react'\nimport { useTranslateDictation } from './useTranslateDictation.js'",
  'dictation imports',
)

app = replaceOnce(
  app,
  "  const inputRef = useRef(null)\n",
  "  const inputRef = useRef(null)\n  const dictationPositionRef = useRef(null)\n  const insertDictation = text => {\n    const position = dictationPositionRef.current\n    setInput(previous => {\n      const start = Math.min(position?.start ?? previous.length, previous.length)\n      const end = Math.min(position?.end ?? start, previous.length)\n      const before = previous.slice(0, start)\n      const after = previous.slice(end)\n      const needsSpaceBefore = before && !/\\s$/.test(before)\n      const needsSpaceAfter = after && !/^\\s|^[.,!?;:]/.test(after)\n      const inserted = `${needsSpaceBefore ? ' ' : ''}${text}${needsSpaceAfter ? ' ' : ''}`\n      const next = before + inserted + after\n      const caret = before.length + inserted.length\n      queueMicrotask(() => {\n        inputRef.current?.focus()\n        inputRef.current?.setSelectionRange?.(caret, caret)\n      })\n      return next\n    })\n    dictationPositionRef.current = null\n  }\n  const { state: dictationState, toggle: toggleDictation, supported: dictationSupported } = useTranslateDictation({\n    onTranscript: insertDictation,\n    onError: message => setError(message),\n  })\n  const handleDictation = () => {\n    if (dictationState === 'idle') {\n      dictationPositionRef.current = {\n        start: inputRef.current?.selectionStart ?? input.length,\n        end: inputRef.current?.selectionEnd ?? input.length,\n      }\n      setError('')\n    }\n    toggleDictation()\n  }\n",
  'dictation state and insertion',
)

app = replaceOnce(
  app,
  "        <article className=\"pane input-pane\"><div className=\"pane-label\">Original</div><textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder=\"Type or paste anything…\" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') translate() }}/><div className=\"pane-foot\"><span>{input.length.toLocaleString()} characters</span><span>⌘/Ctrl + Enter</span></div></article>",
  "        <article className=\"pane input-pane\"><div className=\"pane-label pane-label-row\"><span>Original</span>{dictationSupported && <button type=\"button\" className={`dictate-btn ${dictationState}`} onClick={handleDictation} disabled={dictationState === 'transcribing'} title={dictationState === 'recording' ? 'Stop voice typing' : 'Voice type instead of typing'}>{dictationState === 'recording' ? <><Square size={12}/> Stop</> : dictationState === 'transcribing' ? <><LoaderCircle size={14} className=\"dictate-spin\"/> Writing…</> : <><Mic size={14}/> Speak</>}</button>}</div><textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder=\"Type, paste, or speak anything…\" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') translate() }}/><div className=\"pane-foot\"><span>{input.length.toLocaleString()} characters</span><span>{dictationState === 'recording' ? 'Listening… tap Stop when finished' : dictationState === 'transcribing' ? 'Writing what you said…' : '⌘/Ctrl + Enter'}</span></div></article>",
  'input pane dictation UI',
)

fs.writeFileSync(appPath, app)

const stylesPath = 'src/styles.css'
let styles = fs.readFileSync(stylesPath, 'utf8')
if (!styles.includes('.dictate-btn{')) {
  styles += `\n.pane-label-row{display:flex;align-items:center;justify-content:space-between;padding-right:14px}.dictate-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(44,40,34,.14);background:rgba(255,255,255,.62);color:#4a453e;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;transition:.18s ease}.dictate-btn:hover{background:#fff;color:#171717}.dictate-btn.recording{background:#171717;color:#fff;border-color:#171717;box-shadow:0 0 0 4px rgba(23,23,23,.08)}.dictate-btn.transcribing{cursor:wait;opacity:.72}.dictate-spin{animation:dictate-spin .9s linear infinite}@keyframes dictate-spin{to{transform:rotate(360deg)}}\n@media(max-width:760px){.pane-label-row{padding-right:9px}.dictate-btn{padding:4px 8px;font-size:10px;gap:4px}.dictate-btn svg{width:12px;height:12px}.pane-foot span:last-child{max-width:55%;text-align:right}}\n`
}
fs.writeFileSync(stylesPath, styles)
