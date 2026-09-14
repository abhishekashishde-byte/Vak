import fs from 'node:fs'

const appPath = 'src/App.jsx'
const memoryPath = 'src/personalLanguageMemory.js'
const stylesPath = 'src/styles.css'

let app = fs.readFileSync(appPath, 'utf8')
let memory = fs.readFileSync(memoryPath, 'utf8')
let styles = fs.readFileSync(stylesPath, 'utf8')

function mustReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`)
  return source.replace(from, to)
}

app = mustReplace(
  app,
  "import { getNetworkState, tryOnDeviceTranslation } from './networkResilience.js'\n",
  "import { getNetworkState, tryOnDeviceTranslation } from './networkResilience.js'\nimport { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'\n",
  'personal language memory import'
)

const helperMarker = '\nexport default function App() {'
if (!app.includes(helperMarker)) throw new Error('Could not find App component marker')

const helpers = `
const SMART_TARGET_MIN_CHARS = 12
const SMART_TARGET_CONFIDENCE = 0.82

async function detectSourceLanguage(text) {
  const instructions = \`You are Ana's language detector. Detect ONLY the dominant language of the user's supplied text. Ignore personal preferences, target-language settings, remembered languages, and any request to translate. Return valid JSON only in this shape: {"language":"German","confidence":0.98}. The language value must be exactly one of: \${TARGETS.join(', ')}, Other. Use German for ordinary Standard German. Use a German dialect label only when the text itself is clearly written in that dialect. Confidence must be between 0 and 1.\`
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: String(text).slice(0, 4500), instructions, skipPersonalLanguageMemory: true }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Language detection failed')
  const parsed = parseJson(data.content) || {}
  const language = TARGETS.includes(parsed.language) ? parsed.language : ''
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
  return { language, confidence }
}

function preferredTargetForSource(source) {
  const memory = getPersonalLanguageMemory() || {}
  const sourceCounts = memory.translationTargets?.[source] || {}
  const learned = Object.entries(sourceCounts)
    .filter(([language]) => language !== source && TARGETS.includes(language))
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]
  if (learned?.[0]) return { target: learned[0], basis: 'usual' }

  const recent = Array.isArray(memory.translationRecentTargets) ? memory.translationRecentTargets : []
  const recentTarget = recent.find(language => language !== source && TARGETS.includes(language))
  if (recentTarget) return { target: recentTarget, basis: 'recent' }

  if (memory.ownerLanguage && memory.ownerLanguage !== source && TARGETS.includes(memory.ownerLanguage)) {
    return { target: memory.ownerLanguage, basis: 'preference' }
  }

  const liveTarget = Array.isArray(memory.lastLiveLanguages)
    ? memory.lastLiveLanguages.find(language => language !== source && TARGETS.includes(language))
    : ''
  if (liveTarget) return { target: liveTarget, basis: 'preference' }

  const globalTarget = Object.entries(memory.translationTargetCounts || {})
    .filter(([language]) => language !== source && TARGETS.includes(language))
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0]
  if (globalTarget) return { target: globalTarget, basis: 'recent' }

  if (source === 'German') return { target: 'English', basis: 'fallback' }
  if (source === 'English') return { target: 'German', basis: 'fallback' }
  return { target: source === 'German' ? 'English' : 'German', basis: 'fallback' }
}

function rememberTranslationTarget(source, target) {
  if (!source || !target || source === target || !TARGETS.includes(target)) return
  const memory = getPersonalLanguageMemory() || {}
  const translationTargets = { ...(memory.translationTargets || {}) }
  const sourceCounts = { ...(translationTargets[source] || {}) }
  sourceCounts[target] = Number(sourceCounts[target] || 0) + 1
  translationTargets[source] = sourceCounts

  const translationTargetCounts = { ...(memory.translationTargetCounts || {}) }
  translationTargetCounts[target] = Number(translationTargetCounts[target] || 0) + 1

  const previousRecent = Array.isArray(memory.translationRecentTargets) ? memory.translationRecentTargets : []
  const translationRecentTargets = [target, ...previousRecent.filter(language => language !== target)].slice(0, 6)

  rememberPersonalLanguagePreference({ translationTargets, translationTargetCounts, translationRecentTargets })
}

function smartTargetNotice(target, basis) {
  const suffix = basis === 'usual'
    ? ' based on your usual choice.'
    : basis === 'recent'
      ? ' based on your recent choices.'
      : basis === 'preference'
        ? ' based on your language preference.'
        : '.'
  return \`I thought you may have forgotten to change the target language, so I selected \${target}\${suffix}\`
}
`
app = app.replace(helperMarker, `${helpers}${helperMarker}`)

app = mustReplace(
  app,
  "  const [writingMode, setWritingMode] = useState(() => ['write', 'email'].includes(loadDraft().writingMode) ? 'write' : 'translate')\n  const [offlineNotice, setOfflineNotice] = useState('')",
  "  const [writingMode, setWritingMode] = useState(() => ['write', 'email'].includes(loadDraft().writingMode) ? 'write' : 'translate')\n  const [smartLanguageNotice, setSmartLanguageNotice] = useState('')\n  const [offlineNotice, setOfflineNotice] = useState('')",
  'smart language notice state'
)

const glossaryStart = app.indexOf('  const glossaryInstructions = () =>')
const translationStart = app.indexOf('  const translationInstructions = () =>', glossaryStart)
if (glossaryStart < 0 || translationStart < 0) throw new Error('Could not locate glossary instruction block')
const newGlossary = `  const glossaryInstructions = (selectedTarget = target) => {\n    const terms = glossary.filter(item => item.target === selectedTarget)\n    return terms.length\n      ? \`\\nPERSONAL GLOSSARY — explicit user preferences override ordinary word choice:\\n\${terms.map(item => \`- "\${item.source}" → "\${item.preferred}"\`).join('\\n')}\\nPreserve preferred wording unless grammar requires inflection.\`\n      : ''\n  }\n\n`
app = app.slice(0, glossaryStart) + newGlossary + app.slice(translationStart)

const blockStart = app.indexOf('  const translationInstructions = () => {')
const inspectStart = app.indexOf('  const inspectWord = async', blockStart)
if (blockStart < 0 || inspectStart < 0) throw new Error('Could not locate translation block')

const newTranslationBlock = `  const translationInstructions = (selectedTarget = target) => {\n    const outputTarget = selectedTarget\n    let instructions\n    if (writingMode === 'write') {\n      instructions = \`You are Ana Write for me, a multilingual writing assistant. The user will tell you what they need to communicate and may give rough notes, fragments, incomplete sentences, facts, context, tone or purpose in any language. Understand the intent and write the final ready-to-send text in \${outputTarget}. Return ONLY the finished text with no explanation, labels or quotation marks. Choose the appropriate format from the user's intent — for example an email, message, WhatsApp text, letter, reply, request, announcement or short note. Do not force email formatting unless the request is clearly an email or formal correspondence. Preserve every factual detail, name, date, number, URL, request, commitment and intention supplied by the user. Correct spelling, punctuation and grammar. Complete incomplete thoughts when the intended meaning is clear. Make the result natural, coherent and appropriately polite. If the format clearly needs a greeting or closing and the user omitted one, add a neutral suitable one without inventing names. Never invent facts, people, dates, promises, decisions, requests, relationships or other substantive information that the user did not provide.\`\n      if (isGermanTarget(outputTarget)) {\n        instructions += \`\\n\${germanVariantRule(outputTarget)} \${registerRules()}\`\n        instructions += register === 'formal'\n          ? '\\nWhen the requested format is clearly a German email or formal letter and a greeting or closing is missing, use an appropriate neutral professional greeting and closing such as “Guten Tag,” and “Mit freundlichen Grüßen”. Do not add email conventions to ordinary messages.'\n          : '\\nWhen the requested format is clearly a German email or letter and a greeting or closing is missing, use a natural friendly greeting and closing such as “Hallo,” and “Viele Grüße”. Do not add email conventions to ordinary messages.'\n      }\n      if (outputTarget === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script.'\n    } else {\n      instructions = \`You are Ana, a premium translation engine. Detect the source language and translate into \${outputTarget}. Return ONLY the finished translation with no explanation, labels or quotation marks. Preserve paragraph breaks, line breaks, bullets, names, dates, numbers, URLs, greetings and signatures. Translate idiomatically and naturally, not word-for-word. Preserve the user's tone, intent and level of formality.\`\n      if (isGermanTarget(outputTarget)) instructions += \`\\n\${germanVariantRule(outputTarget)} \${registerRules()}\`\n      if (outputTarget === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script. Write the way a Hindi speaker would naturally say it. Keep names, brands, numbers and unavoidable English terms naturally. Do not translate into English.'\n    }\n    return instructions + glossaryInstructions(outputTarget)\n  }\n\n  const translate = async () => {\n    const text = input.trim(); if (!text || loading) return\n    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)\n    let actualTarget = target\n    let detectedSource = ''\n    try {\n      if (writingMode === 'translate' && text.replace(/\\s/g, '').length >= SMART_TARGET_MIN_CHARS) {\n        try {\n          const detected = await detectSourceLanguage(text)\n          detectedSource = detected.language\n          if (detected.language && detected.confidence >= SMART_TARGET_CONFIDENCE && detected.language === target) {\n            const choice = preferredTargetForSource(detected.language)\n            if (choice?.target && choice.target !== target) {\n              actualTarget = choice.target\n              setTarget(actualTarget)\n              setSmartLanguageNotice(smartTargetNotice(actualTarget, choice.basis))\n            } else {\n              setSmartLanguageNotice('')\n            }\n          } else {\n            setSmartLanguageNotice('')\n          }\n        } catch {\n          setSmartLanguageNotice('')\n        }\n      } else {\n        setSmartLanguageNotice('')\n      }\n\n      const instructions = translationInstructions(actualTarget)\n      const result = writingMode === 'write'\n        ? await callLuna(text, instructions)\n        : await callLunaPreservingLineBreaks(text, instructions)\n      setOutput(result)\n      setOutputMode('online')\n      if (writingMode === 'translate' && detectedSource && detectedSource !== actualTarget) {\n        rememberTranslationTarget(detectedSource, actualTarget)\n      }\n    } catch (err) {\n      if (writingMode === 'write') {\n        const network = getNetworkState()\n        setError(network.online ? (err.message || 'Could not write this for you') : 'You’re offline. Your notes are saved automatically. Reconnect to use Write for me.')\n      } else {\n        const deviceResult = await tryOnDeviceTranslation(text, actualTarget)\n        if (deviceResult) {\n          setOutput(deviceResult)\n          setOutputMode('device')\n          setOfflineNotice('Basic on-device translation. Reconnect for Ana’s full context, glossary and tone handling.')\n        } else {\n          const network = getNetworkState()\n          setError(network.online ? (err.message || 'Could not translate') : 'You’re offline. Your text is saved automatically. Reconnect to use Ana’s full translation; on-device translation is not available for this language pair on this browser.')\n        }\n      }\n    } finally { setLoading(false) }\n  }\n\n`
app = app.slice(0, blockStart) + newTranslationBlock + app.slice(inspectStart)

app = mustReplace(
  app,
  "  const clear = () => { setInput(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }",
  "  const clear = () => { setInput(''); setOutput(''); setOutputMode('online'); setSmartLanguageNotice(''); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }",
  'clear function'
)

app = mustReplace(
  app,
  "<select value={target} onChange={e => { setTarget(e.target.value); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>",
  "<select value={target} onChange={e => { setTarget(e.target.value); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>",
  'target select'
)

app = app.replace(
  "setWritingMode('translate'); setOutput('');",
  "setWritingMode('translate'); setSmartLanguageNotice(''); setOutput('');"
)
app = app.replace(
  "setWritingMode('write'); setOutput('');",
  "setWritingMode('write'); setSmartLanguageNotice(''); setOutput('');"
)

app = mustReplace(
  app,
  "onChange={e => setInput(e.target.value)}",
  "onChange={e => { setInput(e.target.value); if (smartLanguageNotice) setSmartLanguageNotice('') }}",
  'input change handler'
)

app = mustReplace(
  app,
  "    {offlineNotice && <div className=\"ana-offline-note\">{offlineNotice}</div>}\n",
  "    {smartLanguageNotice && <div className=\"smart-language-note\">{smartLanguageNotice}</div>}\n    {offlineNotice && <div className=\"ana-offline-note\">{offlineNotice}</div>}\n",
  'notice render location'
)

memory = mustReplace(
  memory,
  "    const body = JSON.parse(init.body)\n    learnFromInstructions(body.instructions)",
  "    const body = JSON.parse(init.body)\n    if (body.skipPersonalLanguageMemory) return { input, init }\n    learnFromInstructions(body.instructions)",
  'language detection memory bypass'
)

if (!styles.includes('.smart-language-note{')) {
  styles += `\n.smart-language-note{margin:10px auto 0;width:fit-content;max-width:min(760px,100%);padding:8px 12px;border:1px solid rgba(44,40,34,.13);background:rgba(255,255,255,.58);color:#696258;border-radius:9px;font-size:11px;line-height:1.4;text-align:center}.smart-language-note:before{content:'✦';margin-right:6px;color:#8b8377}@media(max-width:760px){.smart-language-note{margin-top:6px;padding:6px 9px;font-size:9px;max-width:96%}}\n`
}

fs.writeFileSync(appPath, app)
fs.writeFileSync(memoryPath, memory)
fs.writeFileSync(stylesPath, styles)
console.log('Smart target-language recovery applied')
