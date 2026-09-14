import { useState } from 'react'
import { Captions, Check, ChevronDown, CircleHelp, Headphones, Languages, Mic, MessagesSquare, ShieldCheck, UsersRound, X } from 'lucide-react'
import App from './App.jsx'
import LiveMode from './LiveMode.jsx'
import TalkForMe from './TalkForMeRealtime.jsx'
import TalkPermissionBoundary from './TalkPermissionBoundary.jsx'
import RoomMode from './RoomMode.jsx'
import CaptionsMode from './CaptionsMode.jsx'
import MeetingMode from './MeetingMode.jsx'
import CameraMode from './CameraMode.jsx'
import ScanMode from './ScanMode.jsx'
import PrivacySettings from './PrivacySettings.jsx'
import NetworkStatus from './NetworkStatus.jsx'
import LearnCenter from './LearnCenter.jsx'
import './live.css'
import './talk.css'
import './talk-consent.css'
import './room.css'
import './captions.css'
import './meeting.css'
import './camera.css'
import './scan.css'
import './ana-identity.css'
import './workspace.css'
import './learn.css'

const MAIN_MODES = [
  { id: 'translate', label: 'Translate', description: 'Text, voice, camera, photos and documents', icon: Languages },
  { id: 'live', label: 'Live', description: 'Interpreter, subtitles or a multi-person room', icon: Mic },
  { id: 'meeting', label: 'Meeting', description: 'Listen, translate and keep the transcript', icon: Headphones },
  { id: 'talk', label: 'Talk for me', description: 'Ana handles the conversation for you', icon: MessagesSquare },
]
const MODE_PARENT = { translate:'translate', scan:'translate', camera:'translate', live:'live', captions:'live', room:'live', meeting:'meeting', talk:'talk' }
const modeParent = mode => MODE_PARENT[mode] || 'translate'

function isFirstVisit() {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem('ana-onboarding-v2') !== 'seen' } catch { return false }
}

export default function Workspace() {
  const firstVisit = isFirstVisit()
  const [mode, setMode] = useState('translate')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [learnOpen, setLearnOpen] = useState(firstVisit)
  const [learnWelcome, setLearnWelcome] = useState(firstVisit)
  const parentMode = modeParent(mode)
  const current = MAIN_MODES.find(item => item.id === parentMode) || MAIN_MODES[0]
  const CurrentIcon = current.icon

  const chooseMode = next => {
    setMode(next)
    setPickerOpen(false)
  }

  const openLearn = () => {
    setLearnWelcome(false)
    setLearnOpen(true)
  }

  return <div className="ana-workspace">
    <NetworkStatus/>

    <nav className="ana-modebar" aria-label="Ana mode selection">
      <button className="ana-mode-trigger" type="button" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-expanded={pickerOpen}>
        <span className="ana-mode-icon"><CurrentIcon size={15}/></span>
        <span><small>What Ana is doing</small><strong>{current.label}</strong></span>
        <ChevronDown size={16}/>
      </button>
      <div className="ana-mode-actions">
        <button className="ana-help-quick" type="button" onClick={openLearn} title="Learn how to use Ana" aria-label="Learn how to use Ana"><CircleHelp size={17}/><span>Learn</span></button>
        <button className="ana-privacy-quick" type="button" onClick={() => setSettingsOpen(true)} title="Privacy & memory" aria-label="Privacy and memory settings"><ShieldCheck size={17}/></button>
      </div>
    </nav>

    <div className="ana-mode-content">
      {mode === 'translate' && <App onOpenCamera={() => chooseMode('camera')} onOpenDocuments={() => chooseMode('scan')}/>} 
      {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}
      {mode === 'camera' && <main className="app-shell"><CameraMode/></main>}
      {['live','captions','room'].includes(mode) && <div className="ana-live-stack">
        <div className="ana-live-subnav"><button className={mode === 'live' ? 'active' : ''} onClick={() => chooseMode('live')}><Mic size={14}/>Interpreter</button><button className={mode === 'captions' ? 'active' : ''} onClick={() => chooseMode('captions')}><Captions size={14}/>Subtitles</button><button className={mode === 'room' ? 'active' : ''} onClick={() => chooseMode('room')}><UsersRound size={14}/>Room</button></div>
        {mode === 'live' && <main className="app-shell"><LiveMode/></main>}{mode === 'captions' && <main className="app-shell"><CaptionsMode/></main>}{mode === 'room' && <main className="app-shell"><RoomMode/></main>}
      </div>}
      {mode === 'talk' && <main className="app-shell"><TalkPermissionBoundary><TalkForMe/></TalkPermissionBoundary></main>}
      {mode === 'meeting' && <main className="app-shell"><MeetingMode/></main>}
    </div>

    {pickerOpen && <div className="ana-mode-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPickerOpen(false) }}>
      <section className="ana-mode-sheet" role="dialog" aria-modal="true" aria-label="Choose what Ana should do">
        <div className="ana-mode-sheet-head">
          <div><strong>What do you want Ana to do?</strong><span>Choose the job — Ana figures out the input method.</span></div>
          <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close mode picker"><X size={19}/></button>
        </div>
        <div className="ana-mode-group ana-mode-group-main"><div className="ana-mode-grid">{MAIN_MODES.map(item => { const Icon = item.icon; const selected = item.id === parentMode; return <button type="button" className={`ana-mode-option ${selected ? 'active' : ''}`} onClick={() => chooseMode(item.id)} key={item.id}><span className="ana-mode-option-icon"><Icon size={17}/></span><div><strong>{item.label}</strong><small>{item.description}</small></div>{selected && <span className="ana-mode-check"><Check size={14}/></span>}</button> })}</div></div>
        <button className="ana-mode-help" type="button" onClick={() => { setPickerOpen(false); openLearn() }}><CircleHelp size={15}/><span><b>Not sure which one?</b> Tell Ana what you are trying to do.</span><ArrowRightFallback/></button>
      </section>
    </div>}

    <LearnCenter open={learnOpen} welcome={learnWelcome} onClose={() => { setLearnOpen(false); setLearnWelcome(false) }} onChooseMode={chooseMode}/>
    <PrivacySettings open={settingsOpen} onClose={() => setSettingsOpen(false)}/>
  </div>
}

function ArrowRightFallback() {
  return <span aria-hidden="true">→</span>
}
