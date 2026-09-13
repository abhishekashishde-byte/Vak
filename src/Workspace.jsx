import { useState } from 'react'
import { Camera, Captions, Check, ChevronDown, FileText, Headphones, Languages, Mic, MessagesSquare, ShieldCheck, UsersRound, X } from 'lucide-react'
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

const MODE_GROUPS = [
  {
    label: 'Speak & translate',
    modes: [
      { id: 'translate', label: 'Translate', description: 'Type or dictate one message', icon: Languages },
      { id: 'live', label: 'Live interpreter', description: 'Continuous two-way conversation', icon: Mic },
      { id: 'talk', label: 'Talk for me', description: 'Ana handles the conversation for you', icon: MessagesSquare },
    ],
  },
  {
    label: 'Listen & understand',
    modes: [
      { id: 'meeting', label: 'Meeting Listen', description: 'Translate a meeting and save the transcript', icon: Headphones },
      { id: 'captions', label: 'Live captions', description: 'Instant subtitles while people speak', icon: Captions },
      { id: 'room', label: 'Conversation room', description: 'Several people, several languages', icon: UsersRound },
    ],
  },
  {
    label: 'Read & see',
    modes: [
      { id: 'scan', label: 'Documents', description: 'Translate PDFs and scanned documents', icon: FileText },
      { id: 'camera', label: 'Camera', description: 'Signs, menus, forms and images', icon: Camera },
    ],
  },
]

const ALL_MODES = MODE_GROUPS.flatMap(group => group.modes)

export default function Workspace() {
  const [mode, setMode] = useState('translate')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const current = ALL_MODES.find(item => item.id === mode) || ALL_MODES[0]
  const CurrentIcon = current.icon

  const chooseMode = next => {
    setMode(next)
    setPickerOpen(false)
  }

  return <div className="ana-workspace">
    <NetworkStatus/>

    <nav className="ana-modebar" aria-label="Ana mode selection">
      <button className="ana-mode-trigger" type="button" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-expanded={pickerOpen}>
        <span className="ana-mode-icon"><CurrentIcon size={15}/></span>
        <span><small>Mode</small><strong>{current.label}</strong></span>
        <ChevronDown size={16}/>
      </button>
      <button className="ana-privacy-quick" type="button" onClick={() => setSettingsOpen(true)} title="Privacy & memory" aria-label="Privacy and memory settings"><ShieldCheck size={17}/></button>
    </nav>

    <div className="ana-mode-content">
      {mode === 'translate' && <App/>}
      {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}
      {mode === 'live' && <main className="app-shell"><LiveMode/></main>}
      {mode === 'talk' && <main className="app-shell"><TalkPermissionBoundary><TalkForMe/></TalkPermissionBoundary></main>}
      {mode === 'room' && <main className="app-shell"><RoomMode/></main>}
      {mode === 'captions' && <main className="app-shell"><CaptionsMode/></main>}
      {mode === 'meeting' && <main className="app-shell"><MeetingMode/></main>}
      {mode === 'camera' && <main className="app-shell"><CameraMode/></main>}
    </div>

    {pickerOpen && <div className="ana-mode-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPickerOpen(false) }}>
      <section className="ana-mode-sheet" role="dialog" aria-modal="true" aria-label="Choose what Ana should do">
        <div className="ana-mode-sheet-head">
          <div><strong>What do you want Ana to do?</strong><span>Choose the job, not the technology.</span></div>
          <button type="button" onClick={() => setPickerOpen(false)} aria-label="Close mode picker"><X size={19}/></button>
        </div>
        {MODE_GROUPS.map(group => <div className="ana-mode-group" key={group.label}>
          <span>{group.label}</span>
          <div className="ana-mode-grid">
            {group.modes.map(item => {
              const Icon = item.icon
              const selected = item.id === mode
              return <button type="button" className={`ana-mode-option ${selected ? 'active' : ''}`} onClick={() => chooseMode(item.id)} key={item.id}>
                <span className="ana-mode-option-icon"><Icon size={17}/></span>
                <div><strong>{item.label}</strong><small>{item.description}</small></div>
                {selected && <span className="ana-mode-check"><Check size={14}/></span>}
              </button>
            })}
          </div>
        </div>)}
        <p className="ana-mode-help"><b>Not sure?</b> Use Translate for one message, Live for a back-and-forth conversation, Meeting Listen for long meetings, and Talk for me when you want Ana to represent you.</p>
      </section>
    </div>}

    <PrivacySettings open={settingsOpen} onClose={() => setSettingsOpen(false)}/>
  </div>
}
