import { useState } from 'react'
import { Camera, Captions, Languages, Mic, MessagesSquare, ScanText, ShieldCheck, UsersRound } from 'lucide-react'
import App from './App.jsx'
import LiveMode from './LiveMode.jsx'
import TalkForMe from './TalkForMeRealtime.jsx'
import RoomMode from './RoomMode.jsx'
import CaptionsMode from './CaptionsMode.jsx'
import CameraMode from './CameraMode.jsx'
import ScanMode from './ScanMode.jsx'
import PrivacySettings from './PrivacySettings.jsx'
import NetworkStatus from './NetworkStatus.jsx'
import './live.css'
import './talk.css'
import './room.css'
import './captions.css'
import './camera.css'
import './scan.css'
import './ana-identity.css'

export default function Workspace() {
  const [mode, setMode] = useState('translate')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return <>
    <NetworkStatus/>
    <nav className="mode-switch" aria-label="Ana modes">
      <button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}><Languages size={15}/> Translate</button>
      <button className={mode === 'scan' ? 'active' : ''} onClick={() => setMode('scan')}><ScanText size={15}/> Scan</button>
      <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}><Mic size={15}/> Live</button>
      <button className={mode === 'talk' ? 'active' : ''} onClick={() => setMode('talk')}><MessagesSquare size={15}/> Talk for me</button>
      <button className={mode === 'room' ? 'active' : ''} onClick={() => setMode('room')}><UsersRound size={15}/> Room</button>
      <button className={mode === 'captions' ? 'active' : ''} onClick={() => setMode('captions')}><Captions size={15}/> Captions</button>
      <button className={mode === 'camera' ? 'active' : ''} onClick={() => setMode('camera')}><Camera size={15}/> Camera</button>
      <button className="privacy-settings-trigger" onClick={() => setSettingsOpen(true)} title="Privacy & memory"><ShieldCheck size={15}/> Privacy</button>
    </nav>
    {mode === 'translate' && <App/>}
    {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}
    {mode === 'live' && <main className="app-shell"><LiveMode/></main>}
    {mode === 'talk' && <main className="app-shell"><TalkForMe/></main>}
    {mode === 'room' && <main className="app-shell"><RoomMode/></main>}
    {mode === 'captions' && <main className="app-shell"><CaptionsMode/></main>}
    {mode === 'camera' && <main className="app-shell"><CameraMode/></main>}
    <PrivacySettings open={settingsOpen} onClose={() => setSettingsOpen(false)}/>
  </>
}
