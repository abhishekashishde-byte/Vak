import fs from 'node:fs'

const meetingPath = 'src/MeetingMode.jsx'
const cssPath = 'src/meeting.css'
const apiPath = 'api/meeting-segment.js'

let meeting = fs.readFileSync(meetingPath, 'utf8')
let css = fs.readFileSync(cssPath, 'utf8')
let api = fs.readFileSync(apiPath, 'utf8')

const replace = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing ${label}`)
  return source.replace(from, to)
}

meeting = replace(meeting, 'const SEGMENT_MS = 4000', 'const SEGMENT_MS = 8000', 'meeting segment duration')
meeting = replace(meeting, 'async function sendSegment(blob, target) {', 'async function sendSegment(blob, target, previousContext = \'\') {', 'sendSegment signature')
meeting = replace(
  meeting,
  "    body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm', target }),",
  "    body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm', target, previousContext }),",
  'meeting segment request body',
)

const helperMarker = 'function preferredMimeType() {'
if (!meeting.includes(helperMarker)) throw new Error('Missing preferredMimeType marker')
meeting = meeting.replace(helperMarker, `function endsReadableThought(text = '') {\n  const value = clean(text)\n  return /[.!?][\\"'”’)]*$/.test(value) && !/\\.\\.\\.[\\"'”’)]*$/.test(value)\n}\n\nfunction buildReadableBlocks(entries = []) {\n  const blocks = []\n  let current = null\n\n  const flush = () => {\n    if (!current) return\n    current.translated = clean(current.translated)\n    current.original = clean(current.original)\n    blocks.push(current)\n    current = null\n  }\n\n  entries.forEach(item => {\n    if (!current) {\n      current = {\n        id: item.id,\n        at: item.at,\n        endAt: item.at,\n        translated: clean(item.translated),\n        original: clean(item.original),\n        count: 1,\n      }\n    } else {\n      current.endAt = item.at\n      current.translated = [current.translated, clean(item.translated)].filter(Boolean).join(' ')\n      current.original = [current.original, clean(item.original)].filter(Boolean).join(' ')\n      current.count += 1\n    }\n\n    const enoughContent = current.translated.length >= 150\n    const sentenceFeelsComplete = endsReadableThought(item.translated)\n    if ((current.count >= 2 && enoughContent && sentenceFeelsComplete) || current.count >= 3 || current.translated.length >= 430) flush()\n  })\n\n  flush()\n  return blocks\n}\n\n${helperMarker}`)

meeting = replace(
  meeting,
  "  const [copied, setCopied] = useState(false)\n",
  "  const [copied, setCopied] = useState(false)\n  const [transcriptView, setTranscriptView] = useState('readable')\n",
  'transcript view state',
)

meeting = replace(
  meeting,
  "  const segmentLoopRef = useRef(null)\n",
  "  const segmentLoopRef = useRef(null)\n  const recentTranscriptRef = useRef([])\n",
  'recent transcript ref',
)

meeting = replace(
  meeting,
  "          const result = await sendSegment(item.blob, item.target)\n",
  "          const previousContext = recentTranscriptRef.current.slice(-3).join(' ')\n          const result = await sendSegment(item.blob, item.target, previousContext)\n          if (result.transcript) recentTranscriptRef.current = [...recentTranscriptRef.current, result.transcript].slice(-4)\n",
  'context-aware segment processing',
)

meeting = replace(
  meeting,
  "    queueRef.current = []\n    try { localStorage.removeItem(STORAGE_KEY) } catch {}\n",
  "    queueRef.current = []\n    recentTranscriptRef.current = []\n    try { localStorage.removeItem(STORAGE_KEY) } catch {}\n",
  'start reset context',
)

meeting = replace(
  meeting,
  "    setStatus('idle')\n    try { localStorage.removeItem(STORAGE_KEY) } catch {}\n",
  "    setStatus('idle')\n    recentTranscriptRef.current = []\n    try { localStorage.removeItem(STORAGE_KEY) } catch {}\n",
  'clear reset context',
)

meeting = replace(
  meeting,
  "  const transcriptText = () => entries.map(item => `[${formatTime(item.at)}]\\nOriginal: ${item.original}\\n${item.target}: ${item.translated}`).join('\\n\\n')\n",
  "  const readableBlocks = useMemo(() => buildReadableBlocks(entries), [entries])\n\n  const transcriptText = () => transcriptView === 'readable'\n    ? readableBlocks.map(item => '[' + formatTime(item.at) + '] ' + item.translated).join('\\n\\n')\n    : entries.map(item => '[' + formatTime(item.at) + ']\\nOriginal: ' + item.original + '\\n' + item.target + ': ' + item.translated).join('\\n\\n')\n",
  'readable transcript text',
)

meeting = meeting.replace('Cost-optimized near-live translation', 'Near-live translation')

meeting = replace(
  meeting,
  "          {latest?.original && <p>{latest.original}</p>}\n",
  "          {latest?.original && <details className=\"meeting-original\"><summary>Show original</summary><p>{latest.original}</p></details>}\n",
  'latest original details',
)

const transcriptStart = meeting.indexOf('    <section className="meeting-transcript">')
const footnoteStart = meeting.indexOf('    <p className="meeting-footnote">', transcriptStart)
if (transcriptStart < 0 || footnoteStart < 0) throw new Error('Could not locate transcript section')

const transcriptSection = [
  '    <section className="meeting-transcript">',
  '      <div className="meeting-transcript-head">',
  '        <div><strong>Meeting transcript</strong><span>{entries.length ? (transcriptView === \'readable\' ? (readableBlocks.length + \' readable passage\' + (readableBlocks.length === 1 ? \'\' : \'s\') + \' · \' + entries.length + \' captured segments\') : (entries.length + \' captured segment\' + (entries.length === 1 ? \'\' : \'s\'))) : \'Nothing saved yet\'}</span></div>',
  '        <div className="meeting-transcript-actions">',
  '          <div className="meeting-view-toggle" aria-label="Transcript view">',
  '            <button className={transcriptView === \'readable\' ? \'active\' : \'\'} onClick={() => setTranscriptView(\'readable\')}>Readable</button>',
  '            <button className={transcriptView === \'detailed\' ? \'active\' : \'\'} onClick={() => setTranscriptView(\'detailed\')}>Detailed</button>',
  '          </div>',
  '          <button onClick={copyTranscript} disabled={!entries.length}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? \'Copied\' : \'Copy\'}</button>',
  '          <button onClick={downloadTranscript} disabled={!entries.length}><Download size={15}/> Download</button>',
  '          <button onClick={clearTranscript} disabled={active || !entries.length}><Trash2 size={15}/> Clear</button>',
  '        </div>',
  '      </div>',
  '      <div className="meeting-lines">',
  '        {entries.length ? (transcriptView === \'readable\' ? readableBlocks.map(item => <article key={item.id} className="meeting-readable-line">',
  '          <time>{formatTime(item.at)}{item.endAt > item.at ? (\'–\' + formatTime(item.endAt + SEGMENT_MS)) : \'\'}</time>',
  '          <div>',
  '            <strong>{item.translated}</strong>',
  '            {item.original && <details className="meeting-original"><summary>Original</summary><p>{item.original}</p></details>}',
  '          </div>',
  '        </article>) : entries.map(item => <article key={item.id}>',
  '          <time>{formatTime(item.at)}</time>',
  '          <div><strong>{item.translated}</strong><p>{item.original}</p></div>',
  '        </article>)) : <div className="meeting-empty">Ana will turn the meeting into readable passages here as people speak.</div>}',
  '      </div>',
  '    </section>',
  '',
].join('\n')

meeting = meeting.slice(0, transcriptStart) + transcriptSection + meeting.slice(footnoteStart)

api = replace(
  api,
  "  const { audio, mimeType = 'audio/webm', target = 'English' } = req.body || {}",
  "  const { audio, mimeType = 'audio/webm', target = 'English', previousContext = '' } = req.body || {}",
  'API request destructuring',
)

api = replace(
  api,
  "    form.append('prompt', 'Transcribe exactly what is spoken in this meeting segment. Preserve names, numbers, technical terms, multilingual speech and code-switching. Do not translate, summarize or add commentary.')",
  "    const context = String(previousContext || '').trim().slice(-1400)\n    const transcriptionPrompt = context\n      ? `Transcribe exactly what is spoken in this meeting segment. Preserve names, numbers, technical terms, multilingual speech and code-switching. Do not translate, summarize or add commentary. Previous meeting context for names and continuity only; do NOT repeat it: ${context}`\n      : 'Transcribe exactly what is spoken in this meeting segment. Preserve names, numbers, technical terms, multilingual speech and code-switching. Do not translate, summarize or add commentary.'\n    form.append('prompt', transcriptionPrompt)",
  'context-aware transcription prompt',
)

api = replace(
  api,
  "    let instructions = `You are Ana translating a live meeting transcript. Translate ONLY the supplied speech into natural ${target}. Preserve the speaker's perspective, names, numbers, dates, uncertainty, technical terminology and factual meaning. Do not answer questions, summarize, explain, censor or add commentary. If the text is already in ${target}, return it naturally without changing meaning. Return only the translated meeting text.`",
  "    let instructions = `You are Ana translating the CURRENT speech from a live meeting into natural ${target}. Previous meeting context may be supplied only to resolve names, terminology, pronouns and sentence continuity. Translate ONLY CURRENT SPEECH; never repeat previous context. Preserve the speaker's perspective, names, numbers, dates, uncertainty, technical terminology and factual meaning. If the current speech starts or ends mid-thought because of live chunking, translate it as a natural continuation rather than pretending it is a complete standalone sentence. Do not answer questions, summarize, explain, censor or add commentary. If the current speech is already in ${target}, return it naturally without changing meaning. Return only the translated CURRENT speech.`",
  'context-aware translation instructions',
)

api = replace(
  api,
  "        input: transcript,",
  "        input: context ? `PREVIOUS CONTEXT (do not translate or repeat):\\n${context}\\n\\nCURRENT SPEECH (translate only this):\\n${transcript}` : transcript,",
  'context-aware translation input',
)

if (!css.includes('.meeting-view-toggle')) {
  css += `\n/* Readable meeting transcript: default to coherent passages; raw segments stay available under Detailed. */\n.meeting-original{margin-top:10px;color:#776f65;font-size:12px}.meeting-original summary{cursor:pointer;color:#6c655c;font-weight:600;list-style:none}.meeting-original summary::-webkit-details-marker{display:none}.meeting-original summary:before{content:'›';display:inline-block;margin-right:6px;transition:transform .16s ease}.meeting-original[open] summary:before{transform:rotate(90deg)}.meeting-original p{margin:7px 0 0!important;color:#81796f!important;font-size:12px!important;line-height:1.5!important}.meeting-transcript-actions{display:flex!important;gap:6px;flex-wrap:wrap;align-items:center}.meeting-view-toggle{display:flex;border:1px solid rgba(43,39,33,.12);background:#eee9e0;border-radius:999px;padding:2px}.meeting-view-toggle button{border:0!important;background:transparent!important;padding:5px 9px!important;color:#756e65!important}.meeting-view-toggle button.active{background:#171717!important;color:#fff!important}.meeting-readable-line{padding-top:18px!important;padding-bottom:18px!important}.meeting-readable-line strong{font-size:17px!important;line-height:1.55!important;font-weight:620!important}.meeting-readable-line time{white-space:nowrap}.meeting-now .meeting-original{margin-top:14px}.meeting-now .meeting-original p{font-size:13px!important}\n@media(max-width:760px){.meeting-transcript-actions{width:100%}.meeting-view-toggle{width:100%;order:-1}.meeting-view-toggle button{flex:1}.meeting-readable-line{grid-template-columns:58px 1fr!important;padding:15px 12px!important}.meeting-readable-line strong{font-size:15px!important;line-height:1.52!important}.meeting-now>p{display:none}}\n`
}

fs.writeFileSync(meetingPath, meeting)
fs.writeFileSync(cssPath, css)
fs.writeFileSync(apiPath, api)
console.log('Meeting readability improved')
