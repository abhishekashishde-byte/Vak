import fs from 'node:fs'

const path = 'src/App.jsx'
let src = fs.readFileSync(path, 'utf8')

function mustReplace(from, to, label) {
  if (!src.includes(from)) throw new Error(`Could not find ${label}`)
  src = src.replace(from, to)
}

mustReplace(
  "  const [writingMode, setWritingMode] = useState(() => loadDraft().writingMode === 'email' ? 'email' : 'translate')",
  "  const [writingMode, setWritingMode] = useState(() => ['write', 'email'].includes(loadDraft().writingMode) ? 'write' : 'translate')",
  'writing mode state'
)

mustReplace(
  "    if (writingMode === 'email') {\n      instructions = `You are Ana Email, a bilingual email writing assistant. Detect the source language and produce a complete, natural email in ${target}. Return ONLY the finished email body with no explanation, labels or quotation marks. Preserve every factual detail, name, date, number, URL, request, commitment and intention from the user. Correct spelling, punctuation and grammar. Repair incomplete or fragmented sentences when the intended meaning is clear. Improve flow and politeness so the result reads like a naturally written email, not a literal translation. Ensure the email has an appropriate greeting and closing. If a greeting is missing, add a neutral greeting without inventing a recipient name. If a closing is missing, add an appropriate closing but never invent the sender name. Never invent business facts, people, dates, promises, decisions, requests or missing substantive information.`\n      if (isGermanTarget(target)) {\n        instructions += `\\n${germanVariantRule(target)} ${registerRules()}`\n        instructions += register === 'formal'\n          ? '\\nFor a missing German closing, normally use “Mit freundlichen Grüßen”. For a missing greeting with no recipient name, use a neutral professional greeting such as “Guten Tag,”.'\n          : '\\nFor a missing German closing, normally use “Viele Grüße”. For a missing greeting with no recipient name, use a natural friendly greeting such as “Hallo,”.'\n      }\n      if (target === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script.'",
  "    if (writingMode === 'write') {\n      instructions = `You are Ana Write for me, a multilingual writing assistant. The user will tell you what they need to communicate and may give rough notes, fragments, incomplete sentences, facts, context, tone or purpose in any language. Understand the intent and write the final ready-to-send text in ${target}. Return ONLY the finished text with no explanation, labels or quotation marks. Choose the appropriate format from the user's intent — for example an email, message, WhatsApp text, letter, reply, request, announcement or short note. Do not force email formatting unless the request is clearly an email or formal correspondence. Preserve every factual detail, name, date, number, URL, request, commitment and intention supplied by the user. Correct spelling, punctuation and grammar. Complete incomplete thoughts when the intended meaning is clear. Make the result natural, coherent and appropriately polite. If the format clearly needs a greeting or closing and the user omitted one, add a neutral suitable one without inventing names. Never invent facts, people, dates, promises, decisions, requests, relationships or other substantive information that the user did not provide.`\n      if (isGermanTarget(target)) {\n        instructions += `\\n${germanVariantRule(target)} ${registerRules()}`\n        instructions += register === 'formal'\n          ? '\\nWhen the requested format is clearly a German email or formal letter and a greeting or closing is missing, use an appropriate neutral professional greeting and closing such as “Guten Tag,” and “Mit freundlichen Grüßen”. Do not add email conventions to ordinary messages.'\n          : '\\nWhen the requested format is clearly a German email or letter and a greeting or closing is missing, use a natural friendly greeting and closing such as “Hallo,” and “Viele Grüße”. Do not add email conventions to ordinary messages.'\n      }\n      if (target === 'Hinglish') instructions += '\\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script.'",
  'write-for-me instructions'
)

mustReplace(
  "      const result = writingMode === 'email'\n        ? await callLuna(text, instructions)",
  "      const result = writingMode === 'write'\n        ? await callLuna(text, instructions)",
  'write execution'
)

mustReplace(
  "      if (writingMode === 'email') {\n        const network = getNetworkState()\n        setError(network.online ? (err.message || 'Could not prepare the email') : 'You’re offline. Your draft is saved automatically. Reconnect to use Ana Email.')",
  "      if (writingMode === 'write') {\n        const network = getNetworkState()\n        setError(network.online ? (err.message || 'Could not write this for you') : 'You’re offline. Your notes are saved automatically. Reconnect to use Write for me.')",
  'write-mode error handling'
)

mustReplace(
  "<div className=\"segmented mode-segmented\" aria-label=\"Writing mode\"><button className={writingMode === 'translate' ? 'active' : ''} onClick={() => { setWritingMode('translate'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Translate</button><button className={writingMode === 'email' ? 'active' : ''} onClick={() => { setWritingMode('email'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Email</button></div>",
  "<div className=\"segmented mode-segmented\" aria-label=\"Writing mode\"><button className={writingMode === 'translate' ? 'active' : ''} onClick={() => { setWritingMode('translate'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Translate</button><button className={writingMode === 'write' ? 'active' : ''} onClick={() => { setWritingMode('write'); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Write for me</button></div>",
  'mode toggle'
)

mustReplace(
  "<article className=\"pane input-pane\"><div className=\"pane-label pane-label-row\"><span>{writingMode === 'email' ? 'Email draft' : 'Original'}</span>",
  "<article className=\"pane input-pane\"><div className=\"pane-label pane-label-row\"><span>{writingMode === 'write' ? 'What do you want to say?' : 'Original'}</span>",
  'input pane label'
)

mustReplace(
  "placeholder={writingMode === 'email' ? 'Write roughly what you want to say. Incomplete sentences are okay…' : 'Type, paste, or speak anything…'}",
  "placeholder={writingMode === 'write' ? 'Tell Ana what you need to write. Rough notes or incomplete sentences are fine…' : 'Type, paste, or speak anything…'}",
  'input placeholder'
)

mustReplace(
  "<article className=\"pane output-pane\"><div className=\"pane-label\">{writingMode === 'email' ? `${target} email` : target}</div>",
  "<article className=\"pane output-pane\"><div className=\"pane-label\">{writingMode === 'write' ? `${target} — written for you` : target}</div>",
  'output pane label'
)

mustReplace(
  "{writingMode === 'email' ? 'Your complete email will appear here.' : 'Your translation will appear here.'}",
  "{writingMode === 'write' ? 'Ana will write the finished text for you here.' : 'Your translation will appear here.'}",
  'output placeholder'
)

mustReplace(
  "{writingMode === 'email' ? 'Grammar, flow, greeting and closing are completed without inventing facts' : output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'}",
  "{writingMode === 'write' ? 'Tell Ana the intent and key facts — she turns them into a ready-to-send text' : output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'}",
  'output hint'
)

mustReplace(
  "{loading ? (writingMode === 'email' ? 'Writing…' : 'Translating…') : writingMode === 'email' ? 'Prepare email' : 'Translate'}",
  "{loading ? (writingMode === 'write' ? 'Writing…' : 'Translating…') : writingMode === 'write' ? 'Write for me' : 'Translate'}",
  'main action button'
)

fs.writeFileSync(path, src)
console.log('Ana Write for me mode patch applied')
