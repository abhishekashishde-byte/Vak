import fs from 'node:fs'
const p='src/MeetingMode.jsx'
let s=fs.readFileSync(p,'utf8')
const marker="  const togglePause = () => {"
const add=`  const saveMeetingRecord = record => {\n    const next = [record, ...readMeetingHistory().filter(item => item?.id !== record.id)].slice(0, 50)\n    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}\n    setMeetingHistory(next)\n  }\n\n`
if(!s.includes(marker)) throw new Error('toggle marker missing')
s=s.replace(marker,add+marker)
fs.writeFileSync(p,s)
