import fs from 'node:fs'
const p='src/App.jsx'
let s=fs.readFileSync(p,'utf8')

if (!s.includes('translate-input-actions')) {
  s=s.replace("import { ArrowLeftRight, Check, Clipboard, Languages, LoaderCircle, LogOut, Mic, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react'", "import { ArrowLeftRight, Camera, Check, Clipboard, FileText, Languages, LoaderCircle, LogOut, Mic, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react'")
  s=s.replace('export default function App() {','export default function App({ onOpenCamera, onOpenDocuments }) {')

  const old=`<article className="pane input-pane"><div className="pane-label pane-label-row"><span>{writingMode === 'write' ? 'What do you want to say?' : 'Original'}</span>{dictationSupported && <button type="button" className={\`dictate-btn \${dictationState}\`} onClick={handleDictation} disabled={dictationState === 'transcribing'} title={dictationState === 'recording' ? 'Stop voice typing' : 'Voice type instead of typing'}>{dictationState === 'recording' ? <><Square size={12}/> Stop</> : dictationState === 'transcribing' ? <><LoaderCircle size={14} className="dictate-spin"/> Writing…</> : <><Mic size={14}/> Speak</>}</button>}</div>`
  const next=`<article className="pane input-pane"><div className="pane-label pane-label-row"><span>{writingMode === 'write' ? 'What do you want to say?' : 'Original'}</span><div className="translate-input-actions">{dictationSupported && <button type="button" className={\`dictate-btn \${dictationState}\`} onClick={handleDictation} disabled={dictationState === 'transcribing'} title={dictationState === 'recording' ? 'Stop voice typing' : 'Voice type instead of typing'}>{dictationState === 'recording' ? <><Square size={12}/> Stop</> : dictationState === 'transcribing' ? <><LoaderCircle size={14} className="dictate-spin"/> Writing…</> : <><Mic size={14}/> Speak</>}</button>}<button type="button" className="dictate-btn" onClick={onOpenCamera}><Camera size={14}/>Camera</button><button type="button" className="dictate-btn" onClick={onOpenDocuments}><FileText size={14}/>Document</button></div></div>`
  if(!s.includes(old)) throw new Error('Input header not found')
  s=s.replace(old,next)
  fs.writeFileSync(p,s)
}