import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './AuthGate.jsx'
import { installAccountPreferenceSync } from './accountPreferences.js'
import { installAnaNaturalVoice } from './naturalVoice.js'
import { installContextualIntelligence } from './contextualIntelligence.js'
import { installConversationPrivacyGate } from './conversationPrivacyGate.js'
import { installCounterpartyView } from './counterpartyView.js'
import { installPersonalLanguageMemory } from './personalLanguageMemory.js'
import { installPushToTalkFallback } from './pushToTalk.js'
import { installRealtimeTonePolicy } from './realtimeTone.js'
import './styles.css'
import './briefVoice.css'
import './criticalFacts.css'
import './counterpartyView.css'
import './pushToTalk.css'
import './privacySettings.css'
import './briefVoice.js'

installAccountPreferenceSync()
installPersonalLanguageMemory()
installContextualIntelligence()
installRealtimeTonePolicy()
installCounterpartyView()
installPushToTalkFallback()
installConversationPrivacyGate()
installAnaNaturalVoice()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><AuthGate /></React.StrictMode>
)
