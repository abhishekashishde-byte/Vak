import fs from 'node:fs'
const p='src/MeetingMode.jsx'
let s=fs.readFileSync(p,'utf8')
const marker="  useEffect(() => {\n    const node = translationPaneRef.current"
const add="  useEffect(() => { originalTextRef.current = originalText }, [originalText])\n  useEffect(() => { translatedTextRef.current = translatedText }, [translatedText])\n  useEffect(() => { startedAtRef.current = startedAt || 0 }, [startedAt])\n\n"
if(!s.includes(marker)) throw new Error('effect marker missing')
s=s.replace(marker,add+marker)
fs.writeFileSync(p,s)
