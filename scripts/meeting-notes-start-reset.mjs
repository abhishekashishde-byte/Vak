import fs from 'node:fs'
const p='src/MeetingMode.jsx'
let s=fs.readFileSync(p,'utf8')
const a="    setError('')\n    setSessionState('connecting')"
const b="    setError('')\n    setNotesError('')\n    setMeetingNotes(null)\n    setNotesStatus('idle')\n    setSessionState('connecting')"
if(!s.includes(a)) throw new Error('start marker missing')
s=s.replace(a,b)
fs.writeFileSync(p,s)
