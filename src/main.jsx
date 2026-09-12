import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './AuthGate.jsx'
import { installAnaNaturalVoice } from './naturalVoice.js'
import { installContextualIntelligence } from './contextualIntelligence.js'
import { installCounterpartyView } from './counterpartyView.js'
import { installPersonalLanguageMemory } from './personalLanguageMemory.js'
import { installRealtimeTonePolicy } from './realtimeTone.js'
import './styles.css'
import './briefVoice.css'
import './criticalFacts.css'
import './counterpartyView.css'
import './briefVoice.js'

installPersonalLanguageMemory()
installContextualIntelligence()
installRealtimeTonePolicy()
installCounterpartyView()
installAnaNaturalVoice()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><AuthGate /></React.StrictMode>
)
