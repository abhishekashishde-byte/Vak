import fs from 'node:fs'
const path='src/MeetingMode.jsx'
let s=fs.readFileSync(path,'utf8')
s=s.replace("import { Check, Clipboard, Download, Headphones, Mic, MonitorUp, Pause, Play, Square, Trash2 } from 'lucide-react'","import { Check, Clipboard, Download, Headphones, History, Mic, MonitorUp, Pause, Play, Sparkles, Square, Trash2 } from 'lucide-react'")
s=s.replace("import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'","import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'\nimport './meeting-notes.css'")
s=s.replace("const STORAGE_KEY = 'ana-meeting-transcript-v2'","const STORAGE_KEY = 'ana-meeting-transcript-v2'\nconst HISTORY_KEY = 'ana-meeting-history-v1'")
fs.writeFileSync(path,s)
