import fs from 'node:fs'

const path = 'src/MeetingMode.jsx'
let src = fs.readFileSync(path, 'utf8')

function mustReplace(from, to, label) {
  if (!src.includes(from)) throw new Error(`Missing ${label}`)
  src = src.replace(from, to)
}

const oldBuilderStart = src.indexOf('function buildReadableBlocks(entries = []) {')
const oldBuilderEnd = src.indexOf('\n\nfunction preferredMimeType()', oldBuilderStart)
if (oldBuilderStart < 0 || oldBuilderEnd < 0) throw new Error('Could not locate readable-block builder')

const newBuilder = `function buildReadableBlocks(entries = []) {\n  const blocks = []\n  let current = null\n\n  const flush = () => {\n    if (!current) return\n    current.translated = clean(current.translated)\n    current.original = clean(current.original)\n    blocks.push(current)\n    current = null\n  }\n\n  entries.forEach(item => {\n    if (!current) {\n      current = {\n        id: item.id,\n        at: item.at,\n        endAt: item.at,\n        translated: clean(item.translated),\n        original: clean(item.original),\n        count: 1,\n      }\n    } else {\n      current.endAt = item.at\n      current.translated = [current.translated, clean(item.translated)].filter(Boolean).join(' ')\n      current.original = [current.original, clean(item.original)].filter(Boolean).join(' ')\n      current.count += 1\n    }\n\n    // Raw audio chunks are an implementation detail. The user should see\n    // paragraph-sized thoughts, not one card for every recorder interval.\n    const completeThought = endsReadableThought(item.translated)\n    const paragraphSized = current.translated.length >= 260\n    if ((current.count >= 3 && paragraphSized && completeThought) || current.count >= 5 || current.translated.length >= 760) flush()\n  })\n\n  // Keep the current in-progress thought visible as one growing passage.\n  flush()\n  return blocks\n}`

src = src.slice(0, oldBuilderStart) + newBuilder + src.slice(oldBuilderEnd)

mustReplace(
  "  const transcriptText = () => transcriptView === 'readable'\n    ? readableBlocks.map(item => '[' + formatTime(item.at) + '] ' + item.translated).join('\\n\\n')\n    : entries.map(item => '[' + formatTime(item.at) + ']\\nOriginal: ' + item.original + '\\n' + item.target + ': ' + item.translated).join('\\n\\n')",
  "  const transcriptText = () => readableBlocks.map(item => '[' + formatTime(item.at) + '] ' + item.translated).join('\\n\\n')",
  'copy/download transcript logic',
)

mustReplace(
  "  const latest = entries[entries.length - 1]",
  "  const latest = readableBlocks[readableBlocks.length - 1] || entries[entries.length - 1]",
  'latest readable passage',
)

const sectionStart = src.indexOf('    <section className="meeting-transcript">')
const footnoteStart = src.indexOf('    <p className="meeting-footnote">', sectionStart)
if (sectionStart < 0 || footnoteStart < 0) throw new Error('Could not locate transcript UI section')

const section = `    <section className="meeting-transcript">\n      <div className="meeting-transcript-head">\n        <div><strong>Meeting transcript</strong><span>{entries.length ? (readableBlocks.length + ' readable passage' + (readableBlocks.length === 1 ? '' : 's') + ' · saved on this device') : 'Nothing saved yet'}</span></div>\n        <div className="meeting-transcript-actions">\n          <button onClick={copyTranscript} disabled={!entries.length}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy'}</button>\n          <button onClick={downloadTranscript} disabled={!entries.length}><Download size={15}/> Download</button>\n          <button onClick={clearTranscript} disabled={active || !entries.length}><Trash2 size={15}/> Clear</button>\n        </div>\n      </div>\n      <div className="meeting-lines">\n        {entries.length ? readableBlocks.map(item => <article key={item.id} className="meeting-readable-line">\n          <time>{formatTime(item.at)}{item.endAt > item.at ? ('–' + formatTime(item.endAt + SEGMENT_MS)) : ''}</time>\n          <div>\n            <strong>{item.translated}</strong>\n            {item.original && <details className="meeting-original"><summary>Show original</summary><p>{item.original}</p></details>}\n          </div>\n        </article>) : <div className="meeting-empty">Ana will turn the meeting into readable passages here as people speak.</div>}\n      </div>\n    </section>\n`

src = src.slice(0, sectionStart) + section + src.slice(footnoteStart)

// The old toggle state is no longer user-facing; remove it so there is only one clear experience.
src = src.replace("  const [transcriptView, setTranscriptView] = useState('readable')\n", '')

if (src.includes('>Detailed</button>') || src.includes('meeting-view-toggle')) throw new Error('Raw/detailed transcript toggle still exposed')

fs.writeFileSync(path, src)
console.log('Meeting frontend now shows only coherent readable passages')
