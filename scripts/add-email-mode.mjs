import fs from 'node:fs'

const path = 'src/App.jsx'
let src = fs.readFileSync(path, 'utf8')

function mustReplace(from, to, label) {
  if (!src.includes(from)) throw new Error(`Could not find ${label}`)
  src = src.replace(from, to)
}

mustReplace(
  "  const [outputMode, setOutputMode] = useState(() => loadDraft().outputMode === 'device' ? 'device' : 'online')\n  const [offlineNotice, setOfflineNotice] = useState('')",
  "  const [outputMode, setOutputMode] = useState(() => loadDraft().outputMode === 'device' ? 'device' : 'online')\n  const [writingMode, setWritingMode] = useState(() => loadDraft().writingMode === 'email' ? 'email' : 'translate')\n  const [offlineNotice, setOfflineNotice] = useState('')",
  'writing mode state'
)

mustReplace(
  "    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, output, target, outputMode, updatedAt: Date.now() })) } catch {}\n  }, [input, output, target, outputMode])",
  "    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, output, target, outputMode, writingMode, updatedAt: Date.now() })) } catch {}\n  }, [input, output, target, outputMode, writingMode])",
  'draft persistence'
)

const translateStart = src.indexOf('  const translate = async () => {')
const inspectStart = src.indexOf('  const inspectWord = async', translateStart)
if (translateStart < 0 || inspectStart < 0) throw new Error('Could not locate translate function')

const translateBlock = `  const translationInstructions = () => {\n    let instructions\n    if (writingMode === 'email') {\n      instructions = \`You are Ana Email, a bilingual email writing assistant. Detect the source language and produce a complete, natural email in \${target}. Return ONLY the finished email body with no explanation, labels or quotation marks. Preserve every factual detail, name, date, number, URL, request, commitment and intention from the user. Correct spelling, punctuation and grammar. Repair incomplete or fragmented sentences when the intended meaning is clear. Improve flow and politeness so the result reads like a naturally written email, not a literal translation. Ensure the email has an appropriate greeting and closing. If a greeting is missing, add a neutral greeting without inventing a recipient name. If a closing is missing, add an appropriate closing but never invent the sender name. Never invent business facts, people, dates, promises, decisions, requests or missing substantive information.\`\n      if (isGermanTarget(target)) {\n        instructions += \`\\n\${germanVariantRule(target)} \${registerRules()}\`\n        instructions += register === 'formal'\n          ? '\\nFor a missing German closing, normally use “Mit freundlichen Grüßen”. For a missing greeting with no recipient name, use a neutral professional greeting such as “Guten Tag,”.'\n          : '\\nFor a missing German closing, normally use “Viele Grüße”. For a missing greeting with no recipient name, use a natural friendly greeting such as “Hallo,”.'\n      }\n      if (target === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script.'\n    } else {\n      instructions = \`You are Ana, a premium translation engine. Detect the source language and translate into \${target}. Return ONLY the finished translation with no explanation, labels or quotation marks. Preserve paragraph breaks, line breaks, bullets, names, dates, numbers, URLs, greetings and signatures. Translate idiomatically and naturally, not word-for-word. Preserve the user's tone, intent and level of formality.\`\n      if (isGermanTarget(target)) instructions += \`\\n\${germanVariantRule(target)} \${registerRules()}\`\n      if (target === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script. Write the way a Hindi speaker would naturally say it. Keep names, brands, numbers and unavoidable English terms naturally. Do not translate into English.'\n    }\n    return instructions + glossaryInstructions()\n  }\n\n  const translate = async () => {\n    const text = input.trim(); if (!text || loading) return\n    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)\n    try {\n      const instructions = translationInstructions()\n      const result = writingMode === 'email'\n        ? await callLuna(text, instructions)\n        : await callLunaPreservingLineBreaks(text, instructions)\n      setOutput(result)\n      setOutputMode('online')\n    } catch (err) {\n      if (writingMode === 'email') {\n        const network = getNetworkState()\n        setError(network.online ? (err.message || 'Could not prepare the email') : 'You’re offline. Your draft is saved automatically. Reconnect to use Ana Email.')\n      } else {\n        const deviceResult = await tryOnDeviceTranslation(text, target)\n        if (deviceResult) {\n          setOutput(deviceResult)\n          setOutputMode('device')\n          setOfflineNotice('Basic on-device translation. Reconnect for Ana’s full context, glossary and tone handling.')\n        } else {\n          const network = getNetworkState()\n          setError(network.online ? (err.message || 'Could not translate') : 'You’re offline. Your text is saved automatically. Reconnect to use Ana’s full translation; on-device translation is not available for this language pair on this browser.')\n        }\n      }\n    } finally { setLoading(false) }\n  }\n\n`

src = src.slice(0, translateStart) + translateBlock + src.slice(inspectStart)

mustReplace(
  "        {isGermanTarget(target) && <div className=\"segmented\"><button className={register === 'formal' ? 'active' : ''} onClick={() => setRegister('formal')}>Sie</button><button className={register === 'informal' ? 'active' : ''} onClick={() => setRegister('informal')}>du</button></div>}\n        <div className=\"spacer\"/><button className=\"ghost icon-text\" onClick={clear}><RotateCcw size={15}/> Clear</button>",
  "        {isGermanTarget(target) && <div className=\"segmented\"><button className={register === 'formal' ? 'active' : ''} onClick={() => setRegister('formal')}>Sie</button><button className={register === 'informal' ? 'active' : ''} onClick={() => setRegister('informal')}>du</button></div>}\n        <div className=\"segmented mode-segmented\" aria-label=\"Writing mode\"><button className={writingMode === 'translate' ? 'active' : ''} onClick={() => { setWritingMode('translate'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Translate</button><button className={writingMode === 'email' ? 'active' : ''} onClick={() => { setWritingMode('email'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Email</button></div>\n        <div className=\"spacer\"/><button className=\"ghost icon-text\" onClick={clear}><RotateCcw size={15}/> Clear</button>",
  'mode toggle'
)

mustReplace(
  "<article className=\"pane input-pane\"><div className=\"pane-label pane-label-row\"><span>Original</span>",
  "<article className=\"pane input-pane\"><div className=\"pane-label pane-label-row\"><span>{writingMode === 'email' ? 'Email draft' : 'Original'}</span>",
  'input pane label'
)

mustReplace(
  'placeholder="Type, paste, or speak anything…"',
  "placeholder={writingMode === 'email' ? 'Write roughly what you want to say. Incomplete sentences are okay…' : 'Type, paste, or speak anything…'}",
  'input placeholder'
)

mustReplace(
  '<article className="pane output-pane"><div className="pane-label">{target}</div>',
  '<article className="pane output-pane"><div className="pane-label">{writingMode === \'email\' ? `${target} email` : target}</div>',
  'output pane label'
)

mustReplace(
  ": <div className=\"placeholder\">Your translation will appear here.</div>}",
  ": <div className=\"placeholder\">{writingMode === 'email' ? 'Your complete email will appear here.' : 'Your translation will appear here.'}</div>}",
  'output placeholder'
)

mustReplace(
  "<div className=\"pane-foot\"><span>{output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'}</span><button className=\"copy\"",
  "<div className=\"pane-foot\"><span>{writingMode === 'email' ? 'Grammar, flow, greeting and closing are completed without inventing facts' : output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'}</span><button className=\"copy\"",
  'output hint'
)

mustReplace(
  "<div className=\"action-row\"><button className=\"translate-btn\" disabled={!input.trim() || loading} onClick={translate}>{loading ? 'Translating…' : 'Translate'}</button></div>",
  "<div className=\"action-row\"><button className=\"translate-btn\" disabled={!input.trim() || loading} onClick={translate}>{loading ? (writingMode === 'email' ? 'Writing…' : 'Translating…') : writingMode === 'email' ? 'Prepare email' : 'Translate'}</button></div>",
  'main action button'
)

fs.writeFileSync(path, src)
console.log('Ana Email mode patch applied')
