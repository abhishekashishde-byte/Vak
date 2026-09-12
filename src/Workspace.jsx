import { useState } from 'react'
import { Languages, Mic, MessagesSquare, ScanText } from 'lucide-react'
import App from './App.jsx'
import LiveMode from './LiveMode.jsx'
import TalkForMe from './TalkForMe.jsx'
import ScanMode from './ScanMode.jsx'
import './live.css'
import './talk.css'
import './scan.css'
import './ana-identity.css'

export default function Workspace() {
  const [mode, setMode] = useState('translate')

  return <>
    <nav className="mode-switch" aria-label="Ana modes">
      <button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}><Languages size={15}/> Translate</button>
      <button className={mode === 'scan' ? 'active' : ''} onClick={() => setMode('scan')}><ScanText size={15}/> Scan</button>
      <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}><Mic size={15}/> Live</button>
      <button className={mode === 'talk' ? 'active' : ''} onClick={() => setMode('talk')}><MessagesSquare size={15}/> Talk for me</button>
    </nav>
    {mode === 'translate' && <App/>}
    {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}
    {mode === 'live' && <main className="app-shell"><LiveMode/></main>}
    {mode === 'talk' && <main className="app-shell"><TalkForMe/></main>}
  </>
}
