import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './AuthGate.jsx'
import './styles.css'
import './briefVoice.css'
import './briefVoice.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><AuthGate /></React.StrictMode>
)
