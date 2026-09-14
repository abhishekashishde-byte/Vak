import fs from 'node:fs'

const p = 'src/Workspace.jsx'
let s = fs.readFileSync(p, 'utf8')

s = s.replace("import { Camera, Captions, Check, ChevronDown, CircleHelp, FileText, Headphones, Languages, Mic, MessagesSquare, ShieldCheck, UsersRound, X } from 'lucide-react'", "import { Captions, Check, ChevronDown, CircleHelp, Headphones, Languages, Mic, MessagesSquare, ShieldCheck, UsersRound, X } from 'lucide-react'")

s = s.replace(/const MODE_GROUPS = \[[\s\S]*?const ALL_MODES = MODE_GROUPS\.flatMap\(group => group\.modes\)/, `const MAIN_MODES = [
  { id: 'translate', label: 'Translate', description: 'Text, voice, camera, photos and documents', icon: Languages },
  { id: 'live', label: 'Live', description: 'Interpreter, subtitles or a multi-person room', icon: Mic },
  { id: 'meeting', label: 'Meeting', description: 'Listen, translate and keep the transcript', icon: Headphones },
  { id: 'talk', label: 'Talk for me', description: 'Ana handles the conversation for you', icon: MessagesSquare },
]
const MODE_PARENT = { translate:'translate', scan:'translate', camera:'translate', live:'live', captions:'live', room:'live', meeting:'meeting', talk:'talk' }
const modeParent = mode => MODE_PARENT[mode] || 'translate'`)

s = s.replace("  const current = ALL_MODES.find(item => item.id === mode) || ALL_MODES[0]\n  const CurrentIcon = current.icon", "  const parentMode = modeParent(mode)\n  const current = MAIN_MODES.find(item => item.id === parentMode) || MAIN_MODES[0]\n  const CurrentIcon = current.icon")

s = s.replace("{mode === 'translate' && <App/>}", "{mode === 'translate' && <App onOpenCamera={() => chooseMode('camera')} onOpenDocuments={() => chooseMode('scan')}/>} ")

s = s.replace(/\{mode === 'live'[\s\S]*?\{mode === 'camera' && <main className="app-shell"><CameraMode\/><\/main>\}/, `{mode === 'scan' && <main className="app-shell"><ScanMode/></main>}
      {mode === 'camera' && <main className="app-shell"><CameraMode/></main>}
      {['live','captions','room'].includes(mode) && <div className="ana-live-stack">
        <div className="ana-live-subnav"><button className={mode === 'live' ? 'active' : ''} onClick={() => chooseMode('live')}><Mic size={14}/>Interpreter</button><button className={mode === 'captions' ? 'active' : ''} onClick={() => chooseMode('captions')}><Captions size={14}/>Subtitles</button><button className={mode === 'room' ? 'active' : ''} onClick={() => chooseMode('room')}><UsersRound size={14}/>Room</button></div>
        {mode === 'live' && <main className="app-shell"><LiveMode/></main>}{mode === 'captions' && <main className="app-shell"><CaptionsMode/></main>}{mode === 'room' && <main className="app-shell"><RoomMode/></main>}
      </div>}
      {mode === 'talk' && <main className="app-shell"><TalkPermissionBoundary><TalkForMe/></TalkPermissionBoundary></main>}
      {mode === 'meeting' && <main className="app-shell"><MeetingMode/></main>}`)

s = s.replace(/\{MODE_GROUPS\.map\(group => <div className="ana-mode-group"[\s\S]*?<\/div>\)\}/, `<div className="ana-mode-group ana-mode-group-main"><div className="ana-mode-grid">{MAIN_MODES.map(item => { const Icon = item.icon; const selected = item.id === parentMode; return <button type="button" className={\`ana-mode-option \${selected ? 'active' : ''}\`} onClick={() => chooseMode(item.id)} key={item.id}><span className="ana-mode-option-icon"><Icon size={17}/></span><div><strong>{item.label}</strong><small>{item.description}</small></div>{selected && <span className="ana-mode-check"><Check size={14}/></span>}</button> })}</div></div>`)

s = s.replace('Choose the job you have — Ana handles the technology.', 'Choose the job — Ana figures out the input method.')
s = s.replace('Tell Ana what you are trying to do and see a 3-step guide for every mode.', 'Tell Ana what you are trying to do.')

if (s.includes('MODE_GROUPS') || s.includes('ALL_MODES')) throw new Error('Old mode list still present')
fs.writeFileSync(p, s)
