import fs from 'node:fs'
const p='src/MeetingMode.jsx'
let s=fs.readFileSync(p,'utf8')
const marker="  const togglePause = () => {"
const add=`  const endMeeting = async () => {\n    if (!activeRef.current) return\n    const finalOriginal = appendText(originalTextRef.current, originalBufferRef.current)\n    const finalTranslation = appendText(translatedTextRef.current, translatedBufferRef.current)\n    const start = startedAtRef.current || Date.now()\n    const end = Date.now()\n    setOriginalText(finalOriginal)\n    setTranslatedText(finalTranslation)\n    originalBufferRef.current = ''\n    translatedBufferRef.current = ''\n    setLiveOriginal('')\n    setLiveTranslation('')\n    stopMeeting(false)\n    setSessionState('ended')\n    if (finalOriginal.length >= 20) await generateMeetingNotes({ transcript: finalOriginal, translation: finalTranslation, start, end })\n    else {\n      setNotesStatus('error')\n      setNotesError('Not enough speech was captured to create meeting notes.')\n    }\n  }\n\n`
if(!s.includes(marker)) throw new Error('toggle marker missing')
s=s.replace(marker,add+marker)
const old="onClick={() => stopMeeting(true)}><Square size={16}/> End meeting</button>"
if(!s.includes(old)) throw new Error('end meeting button missing')
s=s.replace(old,"onClick={endMeeting}><Square size={16}/> End meeting</button>")
fs.writeFileSync(p,s)
