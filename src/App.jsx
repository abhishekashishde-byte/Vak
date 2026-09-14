import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Camera, Check, Clipboard, FileText, Languages, LoaderCircle, LogOut, Mic, Plus, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useTranslateDictation } from './useTranslateDictation.js'
import { supabase } from './lib/supabase'
import { markAccountPreferencesChanged } from './accountPreferences.js'
import { getNetworkState, tryOnDeviceTranslation } from './networkResilience.js'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'
import AnaMark from './AnaMark.jsx'

const TARGETS = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const GLOSSARY_KEY = 'ana-glossary-v1'
const REGISTER_KEY = 'ana-german-register'
const DRAFT_KEY = 'ana-translate-draft-v1'
const GERMAN_TARGETS = new Set(['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)'])
const isGermanTarget = value => GERMAN_TARGETS.has(value)
const germanVariantRule = value => value === 'Swabian German (Schwäbisch)'
  ? 'Use natural Swabian German (Schwäbisch) as spoken in Baden-Württemberg. Keep it authentic but readable and avoid caricature.'
  : value === 'Bavarian German (Bairisch)'
    ? 'Use natural Bavarian German (Bairisch) as spoken in Bavaria. Keep it authentic but readable and avoid caricature.'
    : value === 'Low German (Plattdeutsch)'
      ? 'Use natural Low German (Plattdeutsch), not Standard German. Keep it understandable and avoid invented dialect spellings.'
      : 'Use flawless Standard German (Hochdeutsch) as written in Germany.'

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}
function splitTranslation(text = '') { return String(text).split(/(\s+|[.,!?;:()[\]{}\"“”]+)/g).filter(Boolean) }
function isWord(part = '') {
  try { return /[\p{L}\p{N}]/u.test(part) } catch { return /[A-Za-z0-9À-ž]/.test(part) }
}

function normalizeClipboardText(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/â†’|âžœ|âž¡|Ã¢â€ â€™|Ã¢â€ â€˜/g, '→')
    // Outlook/legacy clipboard encodings can occasionally turn an arrow between
    // short technical codes into “à” (for example TPàEQ). Repair only this
    // uppercase-code pattern so genuine French “à” remains untouched.
    .replace(/([A-ZÄÖÜ0-9]{1,12})\s*à\s*([A-ZÄÖÜ0-9]{1,12})/g, '$1 → $2')
    .replace(/^[ \t]*[•◦▪‣∙]\s*/gm, '• ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function clipboardHtmlToText(html = '', fallback = '') {
  if (!html || typeof DOMParser === 'undefined') return normalizeClipboardText(fallback)
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const body = doc.body
    body.querySelectorAll('li').forEach(li => {
      const parent = li.parentElement
      let prefix = '• '
      if (parent?.tagName === 'OL') {
        const siblings = [...parent.children].filter(el => el.tagName === 'LI')
        prefix = String(Math.max(1, siblings.indexOf(li) + 1)) + '. '
      }
      li.insertBefore(doc.createTextNode(prefix), li.firstChild)
      li.appendChild(doc.createElement('br'))
    })
    body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,tr').forEach(el => el.appendChild(doc.createElement('br')))
    body.querySelectorAll('td,th').forEach(el => el.appendChild(doc.createTextNode('\t')))
    body.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\n')))
    const extracted = normalizeClipboardText(body.textContent || '')
    return extracted.trim() ? extracted : normalizeClipboardText(fallback)
  } catch {
    return normalizeClipboardText(fallback)
  }
}

function textRangesByLine(text = '') {
  let cursor = 0
  return String(text).split('\n').map((value, index) => {
    const start = cursor
    const end = start + value.length
    cursor = end + 1
    return { index, start, end, text: value }
  })
}

function textRangesBySentence(text = '') {
  const source = String(text)
  const ranges = []
  const re = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g
  let match
  while ((match = re.exec(source))) {
    const raw = match[0]
    const lead = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed) continue
    const start = match.index + lead
    ranges.push({ start, end: start + trimmed.length, text: trimmed })
  }
  return ranges
}

function buildTextAlignment(sourceText = '', targetText = '') {
  const sourceLines = textRangesByLine(sourceText)
  const targetLines = textRangesByLine(targetText)
  if (sourceLines.length === targetLines.length && sourceLines.length > 1) {
    return targetLines.map((targetLine, index) => ({
      outputStart: targetLine.start,
      outputEnd: targetLine.end,
      sourceStart: sourceLines[index].start,
      sourceEnd: sourceLines[index].end,
      sourceText: sourceLines[index].text,
    })).filter(item => item.sourceText.trim())
  }

  const sourceSentences = textRangesBySentence(sourceText)
  const targetSentences = textRangesBySentence(targetText)
  if (sourceSentences.length && targetSentences.length) {
    return targetSentences.map((targetSentence, index) => {
      const sourceIndex = targetSentences.length === 1
        ? 0
        : Math.min(sourceSentences.length - 1, Math.round(index * (sourceSentences.length - 1) / Math.max(1, targetSentences.length - 1)))
      const sourceSentence = sourceSentences[sourceIndex]
      return {
        outputStart: targetSentence.start,
        outputEnd: targetSentence.end,
        sourceStart: sourceSentence.start,
        sourceEnd: sourceSentence.end,
        sourceText: sourceSentence.text,
      }
    })
  }
  return []
}
function loadGlossary() {
  try { return JSON.parse(localStorage.getItem(GLOSSARY_KEY) || '[]') } catch { return [] }
}
function loadDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}
function TranslationText({ text, onWord }) {
  const parts = useMemo(() => splitTranslation(text), [text])
  let cursor = 0
  return <div className="translation-text">{parts.map((part, index) => {
    const start = cursor, end = start + part.length; cursor = end
    if (!isWord(part)) return <span key={`${index}-${start}`}>{part}</span>
    return <button key={`${index}-${start}`} className="word" onClick={() => onWord(part, start, end)}>{part}</button>
  })}</div>
}
async function callLuna(text, instructions) {
  const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, instructions }) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Translation failed')
  return String(data.content || '').trim()
}
async function callLunaPreservingLineBreaks(text, instructions) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n')
  if (!normalized.includes('\n')) return callLuna(normalized, instructions)

  const sourceLines = normalized.split('\n')
  const structuredInstructions = `${instructions}\n\nLAYOUT IS BINDING. The source will be supplied as a JSON array where every array element is exactly one user-entered line. Translate the document with full context, but NEVER merge, split, remove, reorder or invent lines. Return ONLY valid JSON in this exact shape: {"lines":["..."]}. The output array must contain exactly ${sourceLines.length} strings in the same order. If a source line is empty, the corresponding output string MUST be empty. Preserve any leading list marker exactly — including •, -, *, →, and ordered markers such as 1. or 2. Never drop, translate or change the list marker.`
  const structuredPrompt = `SOURCE LINES JSON:\n${JSON.stringify(sourceLines)}`
  const structuredResult = parseJson(await callLuna(structuredPrompt, structuredInstructions))

  if (Array.isArray(structuredResult?.lines) && structuredResult.lines.length === sourceLines.length) {
    return structuredResult.lines.map((line, index) => sourceLines[index] === '' ? '' : String(line ?? '')).join('\n')
  }

  // Rare safety fallback: translate each visible line independently so the user's
  // Enter presses are still preserved exactly even if structured output is malformed.
  const translatedLines = await Promise.all(sourceLines.map(line => line.trim() ? callLuna(line, instructions) : Promise.resolve('')))
  return translatedLines.join('\n')
}

const SMART_TARGET_MIN_CHARS = 12
const SMART_TARGET_CONFIDENCE = 0.82

async function detectSourceLanguage(text) {
  const instructions = `You are Ana's language detector. Detect ONLY the dominant language of the user's supplied text. Ignore personal preferences, target-language settings, remembered languages, and any request to translate. Return valid JSON only in this shape: {"language":"German","confidence":0.98}. The language value must be exactly one of: ${TARGETS.join(', ')}, Other. Use German for ordinary Standard German. Use a German dialect label only when the text itself is clearly written in that dialect. Confidence must be between 0 and 1.`
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
  return `I thought you may have forgotten to change the target language, so I selected ${target}${suffix}`
}

export default function App({ onOpenCamera, onOpenDocuments }) {
  const [input, setInput] = useState(() => String(loadDraft().input || ''))
  const [output, setOutput] = useState(() => String(loadDraft().output || ''))
  const [target, setTarget] = useState(() => TARGETS.includes(loadDraft().target) ? loadDraft().target : 'German')
  const [outputMode, setOutputMode] = useState(() => loadDraft().outputMode === 'device' ? 'device' : 'online')
  const [writingMode, setWritingMode] = useState(() => ['write', 'email'].includes(loadDraft().writingMode) ? 'write' : 'translate')
  const [smartLanguageNotice, setSmartLanguageNotice] = useState('')
  const [offlineNotice, setOfflineNotice] = useState('')
  const [register, setRegister] = useState(() => { try { return localStorage.getItem(REGISTER_KEY) || 'formal' } catch { return 'formal' } })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState(null)
  const [alignmentMap, setAlignmentMap] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [glossary, setGlossary] = useState(loadGlossary)
  const [newSource, setNewSource] = useState('')
  const [newPreferred, setNewPreferred] = useState('')
  const inputRef = useRef(null)
  const refinementCacheRef = useRef(new Map())
  const dictationPositionRef = useRef(null)
  const insertDictation = text => {
    const position = dictationPositionRef.current
    setInput(previous => {
      const start = Math.min(position?.start ?? previous.length, previous.length)
      const end = Math.min(position?.end ?? start, previous.length)
      const before = previous.slice(0, start)
      const after = previous.slice(end)
      const needsSpaceBefore = before && !/\s$/.test(before)
      const needsSpaceAfter = after && !/^\s|^[.,!?;:]/.test(after)
      const inserted = `${needsSpaceBefore ? ' ' : ''}${text}${needsSpaceAfter ? ' ' : ''}`
      const next = before + inserted + after
      const caret = before.length + inserted.length
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange?.(caret, caret)
      })
      return next
    })
    dictationPositionRef.current = null
  }
  const { state: dictationState, toggle: toggleDictation, supported: dictationSupported } = useTranslateDictation({
    onTranscript: insertDictation,
    onError: message => setError(message),
  })
  const handleDictation = () => {
    if (dictationState === 'idle') {
      dictationPositionRef.current = {
        start: inputRef.current?.selectionStart ?? input.length,
        end: inputRef.current?.selectionEnd ?? input.length,
      }
      setError('')
    }
    toggleDictation()
  }

  const handlePaste = event => {
    const clipboard = event.clipboardData
    if (!clipboard) return
    const plain = clipboard.getData('text/plain') || ''
    const html = clipboard.getData('text/html') || ''
    const pasted = html && /<(?:li|ol|ul|p|div|br|table|tr|td)\b/i.test(html)
      ? clipboardHtmlToText(html, plain)
      : normalizeClipboardText(plain)
    if (!pasted) return

    event.preventDefault()
    const field = event.currentTarget
    const start = field.selectionStart ?? input.length
    const end = field.selectionEnd ?? start
    const next = input.slice(0, start) + pasted + input.slice(end)
    const caret = start + pasted.length
    setInput(next)
    setAlignmentMap([])
    setSelected(null)
    if (smartLanguageNotice) setSmartLanguageNotice('')
    queueMicrotask(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange?.(caret, caret)
    })
  }

  const alignedSourceForOutput = (start, end) => {
    const direct = alignmentMap.find(item => start >= item.outputStart && start <= Math.max(item.outputEnd, item.outputStart + 1))
    if (direct) return direct
    if (!alignmentMap.length) return null
    return alignmentMap.reduce((best, item) => {
      const distance = Math.abs(item.outputStart - start)
      return !best || distance < best.distance ? { ...item, distance } : best
    }, null)
  }

  const revealAlignedSource = segment => {
    if (!segment || !inputRef.current) return
    requestAnimationFrame(() => {
      const field = inputRef.current
      try {
        field.setSelectionRange(segment.sourceStart, segment.sourceEnd)
        if (window.matchMedia?.('(pointer:fine)').matches) field.focus({ preventScroll: true })
        const scrollable = Math.max(0, field.scrollHeight - field.clientHeight)
        if (scrollable > 0) field.scrollTop = scrollable * (segment.sourceStart / Math.max(1, input.length))
      } catch {}
    })
  }

  useEffect(() => { try { localStorage.setItem(REGISTER_KEY, register); markAccountPreferencesChanged() } catch {} }, [register])
  useEffect(() => { try { localStorage.setItem(GLOSSARY_KEY, JSON.stringify(glossary)); markAccountPreferencesChanged() } catch {} }, [glossary])
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, output, target, outputMode, writingMode, updatedAt: Date.now() })) } catch {}
  }, [input, output, target, outputMode, writingMode])
  useEffect(() => {
    const hydrate = () => {
      try {
        setRegister(localStorage.getItem(REGISTER_KEY) || 'formal')
        setGlossary(loadGlossary())
      } catch {}
    }
    window.addEventListener('ana-account-preferences-hydrated', hydrate)
    return () => window.removeEventListener('ana-account-preferences-hydrated', hydrate)
  }, [])
  useEffect(() => { inputRef.current?.focus() }, [])

  const activeGlossary = glossary.filter(item => item.target === target)
  const registerRules = () => register === 'formal'
    ? 'For German, use formal Sie/Ihnen/Ihr consistently. Never switch to du.'
    : 'For German, use informal du/dich/dir/dein consistently. Never switch to Sie.'
  const glossaryInstructions = (selectedTarget = target) => {
    const terms = glossary.filter(item => item.target === selectedTarget)
    return terms.length
      ? `\nPERSONAL GLOSSARY — explicit user preferences override ordinary word choice:\n${terms.map(item => `- "${item.source}" → "${item.preferred}"`).join('\n')}\nPreserve preferred wording unless grammar requires inflection.`
      : ''
  }

  const translationInstructions = (selectedTarget = target) => {
    const outputTarget = selectedTarget
    let instructions
    if (writingMode === 'write') {
      instructions = `You are Ana Write for me, a multilingual writing assistant. The user will tell you what they need to communicate and may give rough notes, fragments, incomplete sentences, facts, context, tone or purpose in any language. Understand the intent and write the final ready-to-send text in ${outputTarget}. Return ONLY the finished text with no explanation, labels or quotation marks. Choose the appropriate format from the user's intent — for example an email, message, WhatsApp text, letter, reply, request, announcement or short note. Do not force email formatting unless the request is clearly an email or formal correspondence. Preserve every factual detail, name, date, number, URL, request, commitment and intention supplied by the user. Correct spelling, punctuation and grammar. Complete incomplete thoughts when the intended meaning is clear. Make the result natural, coherent and appropriately polite. If the format clearly needs a greeting or closing and the user omitted one, add a neutral suitable one without inventing names. Never invent facts, people, dates, promises, decisions, requests, relationships or other substantive information that the user did not provide.`
      if (isGermanTarget(outputTarget)) {
        instructions += `\n${germanVariantRule(outputTarget)} ${registerRules()}`
        instructions += register === 'formal'
          ? '\nWhen the requested format is clearly a German email or formal letter and a greeting or closing is missing, use an appropriate neutral professional greeting and closing such as “Guten Tag,” and “Mit freundlichen Grüßen”. Do not add email conventions to ordinary messages.'
          : '\nWhen the requested format is clearly a German email or letter and a greeting or closing is missing, use a natural friendly greeting and closing such as “Hallo,” and “Viele Grüße”. Do not add email conventions to ordinary messages.'
      }
      if (outputTarget === 'Hinglish') instructions += '\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script.'
    } else {
      instructions = `You are Ana, a premium translation engine. Translation quality is the primary goal. Detect the source language and translate into ${outputTarget}. Return ONLY the finished translation with no explanation, labels or quotation marks. Preserve paragraph breaks, line breaks, bullets, names, dates, numbers, URLs, greetings and signatures. First understand the complete meaning, intent, clause relationships, idioms, implied meaning, domain terminology and level of formality. Then write the message the way a fluent native speaker of ${outputTarget} would naturally express the SAME meaning. Do not mirror source-language word order, syntax or collocations when they sound unnatural. Prefer natural target-language phrasing over literal word substitution. Preserve every factual claim, request, condition, degree of certainty and emotional tone. Do not add or remove meaning. If the source is awkward or non-native, translate the intended meaning rather than reproducing awkward grammar. If meaning is ambiguous, preserve the ambiguity instead of guessing. Keep terminology consistent throughout. Before returning, silently check semantic fidelity, naturalness, grammar, idiomatic phrasing and terminology consistency, then output only the polished translation.`
      if (isGermanTarget(outputTarget)) instructions += `\n${germanVariantRule(outputTarget)} ${registerRules()}`
      if (outputTarget === 'Hinglish') instructions += '\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script. Write the way a Hindi speaker would naturally say it. Keep names, brands, numbers and unavoidable English terms naturally. Do not translate into English.'
    }
    return instructions + glossaryInstructions(outputTarget)
  }

  const translate = async () => {
    const cleanedInput = normalizeClipboardText(input).trim()
    const text = cleanedInput; if (!text || loading) return
    if (cleanedInput !== input) setInput(cleanedInput)
    setAlignmentMap([])
    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)
    let actualTarget = target
    let detectedSource = ''
    try {
      if (writingMode === 'translate' && text.replace(/\s/g, '').length >= SMART_TARGET_MIN_CHARS) {
        try {
          const detected = await detectSourceLanguage(text)
          detectedSource = detected.language
          if (detected.language && detected.confidence >= SMART_TARGET_CONFIDENCE && detected.language === target) {
            const choice = preferredTargetForSource(detected.language)
            if (choice?.target && choice.target !== target) {
              actualTarget = choice.target
              setTarget(actualTarget)
              setSmartLanguageNotice(smartTargetNotice(actualTarget, choice.basis))
            } else {
              setSmartLanguageNotice('')
            }
          } else {
            setSmartLanguageNotice('')
          }
        } catch {
          setSmartLanguageNotice('')
        }
      } else {
        setSmartLanguageNotice('')
      }

      const instructions = translationInstructions(actualTarget)
      const result = writingMode === 'write'
        ? await callLuna(text, instructions)
        : await callLunaPreservingLineBreaks(text, instructions)
      setOutput(result)
      setAlignmentMap(writingMode === 'translate' ? buildTextAlignment(text, result) : [])
      setOutputMode('online')
      if (writingMode === 'translate' && detectedSource && detectedSource !== actualTarget) {
        rememberTranslationTarget(detectedSource, actualTarget)
      }
    } catch (err) {
      if (writingMode === 'write') {
        const network = getNetworkState()
        setError(network.online ? (err.message || 'Could not write this for you') : 'You’re offline. Your notes are saved automatically. Reconnect to use Write for me.')
      } else {
        const deviceResult = await tryOnDeviceTranslation(text, actualTarget)
        if (deviceResult) {
          setOutput(deviceResult)
          setAlignmentMap(buildTextAlignment(text, deviceResult))
          setOutputMode('device')
          setOfflineNotice('Basic on-device translation. Reconnect for Ana’s full context, glossary and tone handling.')
        } else {
          const network = getNetworkState()
          setError(network.online ? (err.message || 'Could not translate') : 'You’re offline. Your text is saved automatically. Reconnect to use Ana’s full translation; on-device translation is not available for this language pair on this browser.')
        }
      }
    } finally { setLoading(false) }
  }

  const inspectWord = async (word, start, end) => {
    if (!output || suggestLoading) return
    const aligned = alignedSourceForOutput(start, end)
    const immediateSourceContext = aligned?.sourceText?.trim() || ''
    if (aligned) revealAlignedSource(aligned)

    const cacheKey = [target, register, output, start, end].join('::')
    const cached = refinementCacheRef.current.get(cacheKey)
    if (cached) {
      setSelected({ word, start, end, sourceContext: immediateSourceContext, ...cached })
      return
    }
    setSelected({ word, start, end, sourceContext: immediateSourceContext, sourceTerm: '', partOfSpeech: '', meaning: '', alternatives: [] })
    setSuggestLoading(true)
    try {
      const ratio = output.length ? start / output.length : 0
      const sourcePos = Math.max(0, Math.min(input.length, Math.round(input.length * ratio)))
      const sourceContext = immediateSourceContext || input.slice(Math.max(0, sourcePos - 1200), Math.min(input.length, sourcePos + 1200))
      const targetContext = output.slice(Math.max(0, start - 450), Math.min(output.length, end + 450))
      const prompt = `SOURCE CONTEXT:\n${sourceContext}\n\nTARGET CONTEXT:\n${targetContext}\n\nSELECTED TARGET WORD:\n${word}\n\nIdentify the exact source word or shortest source phrase represented by this word. Suggest up to 4 fluent, context-correct drop-in alternatives. Keep notes very short. Return JSON only: {\"sourceTerm\":\"...\",\"partOfSpeech\":\"...\",\"meaning\":\"short meaning\",\"alternatives\":[{\"term\":\"...\",\"note\":\"...\"}]}`
      let instructions = `You are a fast bilingual editor refining a translation into ${target}. Return valid JSON only. Do not explain reasoning.`
      if (isGermanTarget(target)) instructions += ` ${germanVariantRule(target)} ${registerRules()}`
      if (target === 'Hinglish') instructions += ' Hinglish must be natural Hindi written only in Roman/Latin letters, never Devanagari.'
      const parsed = parseJson(await callLuna(prompt, instructions)) || {}
      const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.filter(x => x?.term && String(x.term).toLowerCase() !== word.toLowerCase()).slice(0, 4) : []
      const result = { sourceTerm: String(parsed.sourceTerm || '').trim(), partOfSpeech: String(parsed.partOfSpeech || '').trim(), meaning: String(parsed.meaning || '').trim(), alternatives }
      refinementCacheRef.current.set(cacheKey, result)
      if (refinementCacheRef.current.size > 60) refinementCacheRef.current.delete(refinementCacheRef.current.keys().next().value)
      setSelected(prev => prev ? { ...prev, ...result } : prev)
    } catch (err) { setSelected(prev => prev ? { ...prev, error: err.message || 'Could not load alternatives' } : prev) }
    finally { setSuggestLoading(false) }
  }

  const replaceSelected = term => {
    if (!selected || !term) return
    setOutput(output.slice(0, selected.start) + term + output.slice(selected.end)); setSelected(null)
  }
  const useAlways = term => {
    if (!selected?.sourceTerm || !term) return
    setGlossary(prev => [...prev.filter(item => !(item.target === target && item.source.toLowerCase() === selected.sourceTerm.toLowerCase())), { id: crypto.randomUUID(), target, source: selected.sourceTerm, preferred: term }])
    replaceSelected(term)
  }
  const addGlossary = () => {
    const source = newSource.trim(), preferred = newPreferred.trim(); if (!source || !preferred) return
    setGlossary(prev => [...prev.filter(item => !(item.target === target && item.source.toLowerCase() === source.toLowerCase())), { id: crypto.randomUUID(), target, source, preferred }])
    setNewSource(''); setNewPreferred('')
  }
  const copyOutput = async () => { if (!output) return; await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1400) }
  const clear = () => { setInput(''); setOutput(''); setAlignmentMap([]); setOutputMode('online'); setSmartLanguageNotice(''); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><AnaMark className="ana-brand-mark"/><div><strong>Ana</strong></div></div>
      <div className="header-actions"><button className="ghost" onClick={() => setGlossaryOpen(true)}>Glossary <span className="badge">{glossary.length}</span></button><button className="ghost icon-only" title="Sign out" onClick={() => supabase?.auth.signOut()}><LogOut size={16}/></button></div>
    </header>

    <section className="translator-card">
      <div className="toolbar">
        <div className="language-pill"><Languages size={16}/><span>Auto-detect</span></div><ArrowLeftRight size={16} className="muted"/>
        <select value={target} onChange={e => { setTarget(e.target.value); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>{TARGETS.map(lang => <option key={lang}>{lang}</option>)}</select>
        {isGermanTarget(target) && <div className="segmented"><button className={register === 'formal' ? 'active' : ''} onClick={() => setRegister('formal')}>Sie</button><button className={register === 'informal' ? 'active' : ''} onClick={() => setRegister('informal')}>du</button></div>}
        <div className="segmented mode-segmented" aria-label="Writing mode"><button className={writingMode === 'translate' ? 'active' : ''} onClick={() => { setWritingMode('translate'); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Translate</button><button className={writingMode === 'write' ? 'active' : ''} onClick={() => { setWritingMode('write'); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Write for me</button></div>
        <div className="spacer"/><button className="ghost icon-text" onClick={clear}><RotateCcw size={15}/> Clear</button>
      </div>
      <section className="workspace">
        <article className={`pane input-pane ${input.length > 900 ? 'dense-text' : ''}`}><div className="pane-label pane-label-row"><span>{writingMode === 'write' ? 'What do you want to say?' : 'Original'}</span><div className="translate-input-actions">{dictationSupported && <button type="button" className={`dictate-btn ${dictationState}`} onClick={handleDictation} disabled={dictationState === 'transcribing'} title={dictationState === 'recording' ? 'Stop voice typing' : 'Voice type instead of typing'}>{dictationState === 'recording' ? <><Square size={12}/> Stop</> : dictationState === 'transcribing' ? <><LoaderCircle size={14} className="dictate-spin"/> Writing…</> : <><Mic size={14}/> Speak</>}</button>}<button type="button" className="dictate-btn" onClick={onOpenCamera}><Camera size={14}/>Camera</button><button type="button" className="dictate-btn" onClick={onOpenDocuments}><FileText size={14}/>Document</button></div></div><textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setAlignmentMap([]); if (smartLanguageNotice) setSmartLanguageNotice('') }} onPaste={handlePaste} placeholder={writingMode === 'write' ? 'Tell Ana what you need to write. Rough notes or incomplete sentences are fine…' : 'Type, paste, or speak anything…'} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') translate() }}/><div className="pane-foot"><span>{input.length.toLocaleString()} characters</span><span>{dictationState === 'recording' ? 'Listening… tap Stop when finished' : dictationState === 'transcribing' ? 'Writing what you said…' : '⌘/Ctrl + Enter'}</span></div></article>
        <article className={`pane output-pane ${output.length > 900 ? 'dense-text' : ''}`}><div className="pane-label">{writingMode === 'write' ? `${target} — written for you` : target}</div><div className="output-area">{loading ? <div className="thinking"><span></span><span></span><span></span> Translating</div> : output ? <TranslationText text={output} onWord={inspectWord}/> : <div className="placeholder">{writingMode === 'write' ? 'Ana will write the finished text for you here.' : 'Your translation will appear here.'}</div>}</div><div className="pane-foot"><span>{writingMode === 'write' ? 'Tell Ana the intent and key facts — she turns them into a ready-to-send text' : output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Click a word to see its matching source and alternatives') : 'Context-aware translation'}</span><button className="copy" disabled={!output} onClick={copyOutput}>{copied ? <><Check size={15}/> Copied</> : <><Clipboard size={15}/> Copy</>}</button></div></article>
      </section>
    </section>

    {smartLanguageNotice && <div className="smart-language-note">{smartLanguageNotice}</div>}
    {offlineNotice && <div className="ana-offline-note">{offlineNotice}</div>}
    {error && <div className="error">{error}</div>}
    <div className="action-row"><button className="translate-btn" disabled={!input.trim() || loading} onClick={translate}>{loading ? (writingMode === 'write' ? 'Writing…' : 'Translating…') : writingMode === 'write' ? 'Write for me' : 'Translate'}</button></div>

    {selected && <div className="popover-backdrop" onMouseDown={() => setSelected(null)}><div className="popover" onMouseDown={e => e.stopPropagation()}><div className="popover-head"><div><strong>{selected.word}</strong>{selected.partOfSpeech && <span>{selected.partOfSpeech}</span>}</div><button onClick={() => setSelected(null)}><X size={18}/></button></div>{selected.sourceContext && <div className="source-match"><span>Corresponding source</span><p>{selected.sourceContext}</p></div>}{suggestLoading ? <div className="popover-loading">Finding the best alternatives…</div> : <>{selected.meaning && <div className="meaning">{selected.meaning}{selected.sourceTerm && <small>From: <b>{selected.sourceTerm}</b></small>}</div>}<div className="alternative-list">{selected.alternatives?.length ? selected.alternatives.map(item => <div className="alternative" key={item.term}><button onClick={() => replaceSelected(item.term)}><strong>{item.term}</strong><span>{item.note}</span></button><button className="always" onClick={() => useAlways(item.term)}>Always</button></div>) : <div className="empty-mini">No clean drop-in alternatives found.</div>}</div></>}</div></div>}

    {glossaryOpen && <div className="drawer-backdrop" onMouseDown={() => setGlossaryOpen(false)}><aside className="drawer" onMouseDown={e => e.stopPropagation()}><div className="drawer-head"><div><h2>Personal glossary</h2><p>{glossary.length} saved in total · showing {target} terminology.</p></div><button onClick={() => setGlossaryOpen(false)}><X size={20}/></button></div><div className="add-rule"><input value={newSource} onChange={e => setNewSource(e.target.value)} placeholder="Source term"/><span>→</span><input value={newPreferred} onChange={e => setNewPreferred(e.target.value)} placeholder={`Preferred ${target}`}/><button onClick={addGlossary}><Plus size={17}/></button></div><div className="rules">{activeGlossary.length ? activeGlossary.map(item => <div className="rule" key={item.id}><div><strong>{item.source}</strong><span>→</span><b>{item.preferred}</b></div><button onClick={() => setGlossary(prev => prev.filter(x => x.id !== item.id))}><Trash2 size={16}/></button></div>) : <div className="empty-rules">No saved terms for {target} yet.</div>}</div></aside></div>}
  </main>
}
