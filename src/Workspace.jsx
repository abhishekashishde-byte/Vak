import { useState } from 'react'
import { Languages, Mic } from 'lucide-react'
import App from './App.jsx'
import LiveMode from './LiveMode.jsx'

export default function Workspace() {
  const [mode, setMode] = useState('translate')

  return <>
    <nav className="mode-switch" aria-label="Ana modes">
      <button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}><Languages size={15}/> Translate</button>
      <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}><Mic size={15}/> Live</button>
      <button disabled title="Coming next">Talk for me</button>
    </nav>
    {mode === 'translate' ? <App/> : <main className="app-shell"><LiveMode/></main>}
  </>
}
