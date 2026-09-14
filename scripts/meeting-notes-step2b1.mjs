import fs from 'node:fs'
const p='src/MeetingMode.jsx'
let s=fs.readFileSync(p,'utf8')
const a="    if (original) setOriginalText(current => appendText(current, original))\n    if (translated) setTranslatedText(current => appendText(current, translated))"
const b="    if (original) { const value=appendText(originalTextRef.current, original); originalTextRef.current=value; setOriginalText(value) }\n    if (translated) { const value=appendText(translatedTextRef.current, translated); translatedTextRef.current=value; setTranslatedText(value) }"
if(!s.includes(a)) throw new Error('marker missing')
s=s.replace(a,b)
fs.writeFileSync(p,s)
