import fs from 'node:fs'
const path='src/MeetingMode.jsx'
let s=fs.readFileSync(path,'utf8')
const marker="function readSavedMeeting() {"
const helper="function readMeetingHistory() {\n  try {\n    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')\n    return Array.isArray(value) ? value : []\n  } catch { return [] }\n}\n\nfunction formatMeetingDate(value) {\n  if (!value) return ''\n  try { return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }\n}\n\n"
if(!s.includes(marker)) throw new Error('marker missing')
s=s.replace(marker,helper+marker)
s=s.replace("  const [copied, setCopied] = useState(false)","  const [copied, setCopied] = useState(false)\n  const [notesStatus, setNotesStatus] = useState('idle')\n  const [meetingNotes, setMeetingNotes] = useState(null)\n  const [notesError, setNotesError] = useState('')\n  const [meetingHistory, setMeetingHistory] = useState(readMeetingHistory)")
s=s.replace("  const targetRef = useRef(target)\n  const originalBufferRef = useRef('')","  const targetRef = useRef(target)\n  const startedAtRef = useRef(Number(saved.startedAt) || 0)\n  const originalTextRef = useRef(clean(saved.originalText))\n  const translatedTextRef = useRef(clean(saved.translatedText))\n  const originalBufferRef = useRef('')")
fs.writeFileSync(path,s)
