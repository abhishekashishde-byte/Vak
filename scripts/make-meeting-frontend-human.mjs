import fs from 'node:fs'

const path = 'src/MeetingMode.jsx'
let src = fs.readFileSync(path, 'utf8')

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`Missing ${label}`)
  src = src.replace(from, to)
}

replaceOnce(
  "      const raw = String(data?.content || '').replaceAll('\\`\\`\\`json', '').replaceAll('\\`\\`\\`', '').trim()\n      const notes = JSON.parse(raw)",
  "      const raw = String(data?.content || '').replace(/```json|```/g, '').trim()\n      const jsonStart = raw.indexOf('{')\n      const jsonEnd = raw.lastIndexOf('}')\n      const notes = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw)",
  'meeting notes JSON parsing',
)

replaceOnce(
  "      const now = Date.now()\n      setStartedAt(now)",
  "      const now = Date.now()\n      startedAtRef.current = now\n      setStartedAt(now)",
  'meeting start time ref',
)

replaceOnce(
  "    setSessionState(startedAt ? 'ended' : 'idle')",
  "    setSessionState(startedAtRef.current ? 'ended' : 'idle')",
  'meeting stop state',
)

replaceOnce(
  "    setLiveOriginal('')\n    setLiveTranslation('')\n    setOriginalText('')\n    setTranslatedText('')",
  "    setLiveOriginal('')\n    setLiveTranslation('')\n    originalTextRef.current = ''\n    translatedTextRef.current = ''\n    setOriginalText('')\n    setTranslatedText('')",
  'new meeting transcript reset',
)

replaceOnce(
  "    setOriginalText('')\n    setTranslatedText('')\n    setStartedAt(null)\n    setElapsed(0)\n    setSessionState('idle')",
  "    originalTextRef.current = ''\n    translatedTextRef.current = ''\n    startedAtRef.current = 0\n    setOriginalText('')\n    setTranslatedText('')\n    setMeetingNotes(null)\n    setNotesStatus('idle')\n    setNotesError('')\n    setStartedAt(null)\n    setElapsed(0)\n    setSessionState('idle')",
  'clear meeting state',
)

const oldHistory = `{record.notes?.summary&&<div><h4>Summary</h4><p>{record.notes.summary}</p></div>}<div className="meeting-history-transcripts">`
const newHistory = `{record.notes?.summary&&<div><h4>Summary</h4><p>{record.notes.summary}</p></div>}{!!record.notes?.keyPoints?.length&&<div><h4>Key points</h4><ul>{record.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.decisions?.length&&<div><h4>Decisions</h4><ul>{record.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.actions?.length&&<div><h4>To-do / actions</h4><ul>{record.notes.actions.map((item,index)=><li key={index}>{typeof item==='string'?item:[item?.task,item?.owner?'Owner: '+item.owner:'',item?.deadline?'Deadline: '+item.deadline:''].filter(Boolean).join(' · ')}</li>)}</ul></div>}{!!record.notes?.openQuestions?.length&&<div><h4>Open questions</h4><ul>{record.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}<div className="meeting-history-transcripts">`
replaceOnce(oldHistory, newHistory, 'full meeting history notes')

src = src.replace(
  'Ana transcribes and translates through the realtime audio connection. The text grows continuously in this single screen; audio itself is not saved here.',
  'During the meeting Ana only listens, transcribes and translates. When you press End meeting, Ana uses the original transcript once to create the meeting title, summary, key points, decisions, actions and open questions, then saves the complete record in Meeting History on this device.',
)

fs.writeFileSync(path, src)
console.log('Meeting notes history hardened')
