import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './AuthGate.jsx'
import { installAnaNaturalVoice } from './naturalVoice.js'
import { installContextualIntelligence } from './contextualIntelligence.js'
import { installPersonalLanguageMemory } from './personalLanguageMemory.js'
import { installRealtimeTonePolicy } from './realtimeTone.js'
import './styles.css'
import './briefVoice.css'
import './briefVoice.js'

installPersonalLanguageMemory()
installContextualIntelligence()
installRealtimeTonePolicy()
installAnaNaturalVoice()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><AuthGate /></React.StrictMode>
)
