import fs from 'node:fs'

const appPath = 'src/App.jsx'
const cssPath = 'src/styles.css'
let app = fs.readFileSync(appPath, 'utf8')
let css = fs.readFileSync(cssPath, 'utf8')

const replace = (from, to, label) => {
  if (!app.includes(from)) throw new Error(`Missing ${label}`)
  app = app.replace(from, to)
}

const helperAnchor = `function isWord(part = '') {\n  try { return /[\\p{L}\\p{N}]/u.test(part) } catch { return /[A-Za-z0-9À-ž]/.test(part) }\n}\n`
if (!app.includes(helperAnchor)) throw new Error('Missing helper anchor')
app = app.replace(helperAnchor, helperAnchor + `\nfunction normalizeClipboardText(text = '') {\n  return String(text)\n    .replace(/\\r\\n?/g, '\\n')\n    .replace(/\\u00a0/g, ' ')\n    .replace(/â†’|âžœ|âž¡|Ã¢â€ â€™|Ã¢â€ â€˜/g, '→')\n    // Outlook/legacy clipboard encodings can occasionally turn an arrow between\n    // short technical codes into “à” (for example TPàEQ). Repair only this\n    // uppercase-code pattern so genuine French “à” remains untouched.\n    .replace(/([A-ZÄÖÜ0-9]{1,12})\\s*à\\s*([A-ZÄÖÜ0-9]{1,12})/g, '$1 → $2')\n    .replace(/^[ \\t]*[•◦▪‣∙]\\s*/gm, '• ')\n    .replace(/[ \\t]+\\n/g, '\\n')\n    .replace(/\\n{3,}/g, '\\n\\n')\n}\n\nfunction clipboardHtmlToText(html = '', fallback = '') {\n  if (!html || typeof DOMParser === 'undefined') return normalizeClipboardText(fallback)\n  try {\n    const doc = new DOMParser().parseFromString(html, 'text/html')\n    const body = doc.body\n    body.querySelectorAll('li').forEach(li => {\n      const parent = li.parentElement\n      let prefix = '• '\n      if (parent?.tagName === 'OL') {\n        const siblings = [...parent.children].filter(el => el.tagName === 'LI')\n        prefix = String(Math.max(1, siblings.indexOf(li) + 1)) + '. '\n      }\n      li.insertBefore(doc.createTextNode(prefix), li.firstChild)\n      li.appendChild(doc.createElement('br'))\n    })\n    body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,tr').forEach(el => el.appendChild(doc.createElement('br')))\n    body.querySelectorAll('td,th').forEach(el => el.appendChild(doc.createTextNode('\\t')))\n    body.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\\n')))\n    const extracted = normalizeClipboardText(body.textContent || '')\n    return extracted.trim() ? extracted : normalizeClipboardText(fallback)\n  } catch {\n    return normalizeClipboardText(fallback)\n  }\n}\n\nfunction textRangesByLine(text = '') {\n  let cursor = 0\n  return String(text).split('\\n').map((value, index) => {\n    const start = cursor\n    const end = start + value.length\n    cursor = end + 1\n    return { index, start, end, text: value }\n  })\n}\n\nfunction textRangesBySentence(text = '') {\n  const source = String(text)\n  const ranges = []\n  const re = /[^.!?\\n]+(?:[.!?]+(?=\\s|$)|$)/g\n  let match\n  while ((match = re.exec(source))) {\n    const raw = match[0]\n    const lead = raw.length - raw.trimStart().length\n    const trimmed = raw.trim()\n    if (!trimmed) continue\n    const start = match.index + lead\n    ranges.push({ start, end: start + trimmed.length, text: trimmed })\n  }\n  return ranges\n}\n\nfunction buildTextAlignment(sourceText = '', targetText = '') {\n  const sourceLines = textRangesByLine(sourceText)\n  const targetLines = textRangesByLine(targetText)\n  if (sourceLines.length === targetLines.length && sourceLines.length > 1) {\n    return targetLines.map((targetLine, index) => ({\n      outputStart: targetLine.start,\n      outputEnd: targetLine.end,\n      sourceStart: sourceLines[index].start,\n      sourceEnd: sourceLines[index].end,\n      sourceText: sourceLines[index].text,\n    })).filter(item => item.sourceText.trim())\n  }\n\n  const sourceSentences = textRangesBySentence(sourceText)\n  const targetSentences = textRangesBySentence(targetText)\n  if (sourceSentences.length && targetSentences.length) {\n    return targetSentences.map((targetSentence, index) => {\n      const sourceIndex = targetSentences.length === 1\n        ? 0\n        : Math.min(sourceSentences.length - 1, Math.round(index * (sourceSentences.length - 1) / Math.max(1, targetSentences.length - 1)))\n      const sourceSentence = sourceSentences[sourceIndex]\n      return {\n        outputStart: targetSentence.start,\n        outputEnd: targetSentence.end,\n        sourceStart: sourceSentence.start,\n        sourceEnd: sourceSentence.end,\n        sourceText: sourceSentence.text,\n      }\n    })\n  }\n  return []\n}\n`)

replace(
  `The output array must contain exactly \${sourceLines.length} strings in the same order. If a source line is empty, the corresponding output string MUST be empty.`,
  `The output array must contain exactly \${sourceLines.length} strings in the same order. If a source line is empty, the corresponding output string MUST be empty. Preserve any leading list marker exactly — including •, -, *, →, and ordered markers such as 1. or 2. Never drop, translate or change the list marker.`,
  'layout preservation prompt',
)

replace(
  `  const [selected, setSelected] = useState(null)\n  const [suggestLoading, setSuggestLoading] = useState(false)`,
  `  const [selected, setSelected] = useState(null)\n  const [alignmentMap, setAlignmentMap] = useState([])\n  const [suggestLoading, setSuggestLoading] = useState(false)`,
  'alignment state',
)

const handlerAnchor = `  const handleDictation = () => {\n    if (dictationState === 'idle') {\n      dictationPositionRef.current = {\n        start: inputRef.current?.selectionStart ?? input.length,\n        end: inputRef.current?.selectionEnd ?? input.length,\n      }\n      setError('')\n    }\n    toggleDictation()\n  }\n`
if (!app.includes(handlerAnchor)) throw new Error('Missing dictation handler')
app = app.replace(handlerAnchor, handlerAnchor + `\n  const handlePaste = event => {\n    const clipboard = event.clipboardData\n    if (!clipboard) return\n    const plain = clipboard.getData('text/plain') || ''\n    const html = clipboard.getData('text/html') || ''\n    const pasted = html && /<(?:li|ol|ul|p|div|br|table|tr|td)\\b/i.test(html)\n      ? clipboardHtmlToText(html, plain)\n      : normalizeClipboardText(plain)\n    if (!pasted) return\n\n    event.preventDefault()\n    const field = event.currentTarget\n    const start = field.selectionStart ?? input.length\n    const end = field.selectionEnd ?? start\n    const next = input.slice(0, start) + pasted + input.slice(end)\n    const caret = start + pasted.length\n    setInput(next)\n    setAlignmentMap([])\n    setSelected(null)\n    if (smartLanguageNotice) setSmartLanguageNotice('')\n    queueMicrotask(() => {\n      inputRef.current?.focus()\n      inputRef.current?.setSelectionRange?.(caret, caret)\n    })\n  }\n\n  const alignedSourceForOutput = (start, end) => {\n    const direct = alignmentMap.find(item => start >= item.outputStart && start <= Math.max(item.outputEnd, item.outputStart + 1))\n    if (direct) return direct\n    if (!alignmentMap.length) return null\n    return alignmentMap.reduce((best, item) => {\n      const distance = Math.abs(item.outputStart - start)\n      return !best || distance < best.distance ? { ...item, distance } : best\n    }, null)\n  }\n\n  const revealAlignedSource = segment => {\n    if (!segment || !inputRef.current) return\n    requestAnimationFrame(() => {\n      const field = inputRef.current\n      try {\n        field.setSelectionRange(segment.sourceStart, segment.sourceEnd)\n        if (window.matchMedia?.('(pointer:fine)').matches) field.focus({ preventScroll: true })\n        const scrollable = Math.max(0, field.scrollHeight - field.clientHeight)\n        if (scrollable > 0) field.scrollTop = scrollable * (segment.sourceStart / Math.max(1, input.length))\n      } catch {}\n    })\n  }\n`)

replace(
  `  const translate = async () => {\n    const text = input.trim(); if (!text || loading) return\n    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)`,
  `  const translate = async () => {\n    const cleanedInput = normalizeClipboardText(input).trim()\n    const text = cleanedInput; if (!text || loading) return\n    if (cleanedInput !== input) setInput(cleanedInput)\n    setAlignmentMap([])\n    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)`,
  'translate start',
)

replace(
  `      setOutput(result)\n      setOutputMode('online')`,
  `      setOutput(result)\n      setAlignmentMap(writingMode === 'translate' ? buildTextAlignment(text, result) : [])\n      setOutputMode('online')`,
  'successful output alignment',
)

replace(
  `          setOutput(deviceResult)\n          setOutputMode('device')`,
  `          setOutput(deviceResult)\n          setAlignmentMap(buildTextAlignment(text, deviceResult))\n          setOutputMode('device')`,
  'device output alignment',
)

const inspectStart = app.indexOf('  const inspectWord = async (word, start, end) => {')
const replaceSelectedStart = app.indexOf('  const replaceSelected = term => {', inspectStart)
if (inspectStart < 0 || replaceSelectedStart < 0) throw new Error('Could not locate inspectWord')
const inspectBlock = `  const inspectWord = async (word, start, end) => {\n    if (!output || suggestLoading) return\n    const aligned = alignedSourceForOutput(start, end)\n    const immediateSourceContext = aligned?.sourceText?.trim() || ''\n    if (aligned) revealAlignedSource(aligned)\n\n    const cacheKey = [target, register, output, start, end].join('::')\n    const cached = refinementCacheRef.current.get(cacheKey)\n    if (cached) {\n      setSelected({ word, start, end, sourceContext: immediateSourceContext, ...cached })\n      return\n    }\n    setSelected({ word, start, end, sourceContext: immediateSourceContext, sourceTerm: '', partOfSpeech: '', meaning: '', alternatives: [] })\n    setSuggestLoading(true)\n    try {\n      const ratio = output.length ? start / output.length : 0\n      const sourcePos = Math.max(0, Math.min(input.length, Math.round(input.length * ratio)))\n      const sourceContext = immediateSourceContext || input.slice(Math.max(0, sourcePos - 1200), Math.min(input.length, sourcePos + 1200))\n      const targetContext = output.slice(Math.max(0, start - 450), Math.min(output.length, end + 450))\n      const prompt = \`SOURCE CONTEXT:\\n\${sourceContext}\\n\\nTARGET CONTEXT:\\n\${targetContext}\\n\\nSELECTED TARGET WORD:\\n\${word}\\n\\nIdentify the exact source word or shortest source phrase represented by this word. Suggest up to 4 fluent, context-correct drop-in alternatives. Keep notes very short. Return JSON only: {\\"sourceTerm\\":\\"...\\",\\"partOfSpeech\\":\\"...\\",\\"meaning\\":\\"short meaning\\",\\"alternatives\\":[{\\"term\\":\\"...\\",\\"note\\":\\"...\\"}]}\`\n      let instructions = \`You are a fast bilingual editor refining a translation into \${target}. Return valid JSON only. Do not explain reasoning.\`\n      if (isGermanTarget(target)) instructions += \` \${germanVariantRule(target)} \${registerRules()}\`\n      if (target === 'Hinglish') instructions += ' Hinglish must be natural Hindi written only in Roman/Latin letters, never Devanagari.'\n      const parsed = parseJson(await callLuna(prompt, instructions)) || {}\n      const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.filter(x => x?.term && String(x.term).toLowerCase() !== word.toLowerCase()).slice(0, 4) : []\n      const result = { sourceTerm: String(parsed.sourceTerm || '').trim(), partOfSpeech: String(parsed.partOfSpeech || '').trim(), meaning: String(parsed.meaning || '').trim(), alternatives }\n      refinementCacheRef.current.set(cacheKey, result)\n      if (refinementCacheRef.current.size > 60) refinementCacheRef.current.delete(refinementCacheRef.current.keys().next().value)\n      setSelected(prev => prev ? { ...prev, ...result } : prev)\n    } catch (err) { setSelected(prev => prev ? { ...prev, error: err.message || 'Could not load alternatives' } : prev) }\n    finally { setSuggestLoading(false) }\n  }\n\n`
app = app.slice(0, inspectStart) + inspectBlock + app.slice(replaceSelectedStart)

replace(
  `  const clear = () => { setInput(''); setOutput(''); setOutputMode('online'); setSmartLanguageNotice(''); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }`,
  `  const clear = () => { setInput(''); setOutput(''); setAlignmentMap([]); setOutputMode('online'); setSmartLanguageNotice(''); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }`,
  'clear alignment',
)

replace(
  `<article className="pane input-pane"><div className="pane-label pane-label-row">`,
  `<article className={\`pane input-pane \${input.length > 900 ? 'dense-text' : ''}\`}><div className="pane-label pane-label-row">`,
  'input dense class',
)
replace(
  `onChange={e => { setInput(e.target.value); if (smartLanguageNotice) setSmartLanguageNotice('') }} placeholder=`,
  `onChange={e => { setInput(e.target.value); setAlignmentMap([]); if (smartLanguageNotice) setSmartLanguageNotice('') }} onPaste={handlePaste} placeholder=`,
  'paste handler',
)
replace(
  `<article className="pane output-pane"><div className="pane-label">`,
  `<article className={\`pane output-pane \${output.length > 900 ? 'dense-text' : ''}\`}><div className="pane-label">`,
  'output dense class',
)
replace(
  `output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'`,
  `output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Click a word to see its matching source and alternatives') : 'Context-aware translation'`,
  'output hint',
)

const popoverNeedle = `<button onClick={() => setSelected(null)}><X size={18}/></button></div>{suggestLoading ?`
if (!app.includes(popoverNeedle)) throw new Error('Missing popover insertion point')
app = app.replace(popoverNeedle, `<button onClick={() => setSelected(null)}><X size={18}/></button></div>{selected.sourceContext && <div className="source-match"><span>Corresponding source</span><p>{selected.sourceContext}</p></div>}{suggestLoading ?`)

if (!css.includes('.source-match{')) {
  css += `\n/* Pasted email/document readability + source/translation alignment. */\n.pane.dense-text textarea,.pane.dense-text .translation-text{font-size:17px;line-height:1.5}.pane textarea,.translation-text{tab-size:4}.source-match{padding:12px 15px;background:#f3eee5;border-bottom:1px solid rgba(43,39,33,.10)}.source-match span{display:block;margin-bottom:5px;color:#8b8378;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.source-match p{margin:0;color:#302c27;font-size:13px;line-height:1.45;white-space:pre-wrap}.output-area{overflow-wrap:anywhere}.pane textarea{white-space:pre-wrap}\n@media(max-width:760px){.pane.dense-text textarea,.pane.dense-text .translation-text{font-size:15px;line-height:1.4}.source-match{padding:9px 11px}.source-match p{font-size:12px}}\n`
}

fs.writeFileSync(appPath, app)
fs.writeFileSync(cssPath, css)
console.log('Improved paste cleanup, formatting preservation, and source alignment')
