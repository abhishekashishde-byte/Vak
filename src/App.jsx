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
const GLOSSARY_CONTEXT_KEY = 'ana-glossary-active-project-v1'
const REGISTER_KEY = 'ana-german-register'
const DRAFT_KEY = 'ana-translate-draft-v1'
const GERMAN_TARGETS = new Set(['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)'])
const EXTENSION_ACTION_LABELS = {
  rewrite: 'Rewrite',
  correct: 'Correct',
  shorter: 'Make shorter',
  friendly: 'Make friendly',
  formal: 'Make formal',
  du: 'Use du',
  sie: 'Use Sie',
  explain: 'Explain',
  reply: 'Write reply',
}
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
    // Outlook can encode Wingdings arrows as the Latin character “à”.
    // The most reliable plain-text fallback is a line-leading à glued to a word.
    // Legitimate French/Italian “à” is normally followed by whitespace, so leave that untouched.
    .replace(/(^|\n)([ \t]*)à(?=[\p{L}\p{N}])/gu, '$1$2→ ')
    // Also repair arrows accidentally flattened between short technical identifiers.
    .replace(/([A-ZÄÖÜ0-9]{1,16})\s*à\s*([A-ZÄÖÜ0-9]{1,16})/g, '$1 → $2')
    .replace(/^[ \t]*[•◦▪‣∙]\s*/gm, '• ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function formatReadableLists(text = '') {
  const rawLines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const normalised = rawLines.map(line => {
    const bullet = line.match(/^([ \t]*)([•◦▪‣∙])\s*(.*)$/u)
    if (bullet) return `${bullet[1]}•  ${bullet[3]}`.replace(/[ \t]+$/, '')

    const numbered = line.match(/^([ \t]*)(\d+[.)])\s*(.*)$/u)
    if (numbered) return `${numbered[1]}${numbered[2]}  ${numbered[3]}`.replace(/[ \t]+$/, '')

    const dash = line.match(/^([ \t]*)([-*])\s+(.*)$/u)
    if (dash) return `${dash[1]}${dash[2]}  ${dash[3]}`.replace(/[ \t]+$/, '')

    const arrow = line.match(/^([ \t]*)(→)\s*(.*)$/u)
    if (arrow) return `${arrow[1]}${arrow[2]}  ${arrow[3]}`.replace(/[ \t]+$/, '')
    return line.replace(/[ \t]+$/, '')
  })

  const isListLine = line => /^[ \t]*(?:[•]|[-*]|→|\d+[.)])\s+/u.test(line)
  const out = []

  for (const line of normalised) {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }

    const currentIsList = isListLine(line)
    const previous = out.length ? out[out.length - 1] : ''
    const previousNonBlank = [...out].reverse().find(item => item.trim()) || ''
    const previousWasList = isListLine(previousNonBlank)

    // Give lists room to breathe in the plain-text editor: one visual blank line
    // before the first item, between items and after the final item.
    if (currentIsList && out.length && previous !== '') out.push('')
    if (!currentIsList && previousWasList && previous !== '') out.push('')

    out.push(line)
  }

  while (out[0] === '') out.shift()
  while (out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

function clipboardHtmlToText(html = '', fallback = '') {
  if (!html || typeof DOMParser === 'undefined') return normalizeClipboardText(fallback)
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const body = doc.body

    // Outlook/Word frequently stores arrows as the character “à” rendered with
    // Wingdings/Webdings/Symbol. Convert those font-specific glyphs before
    // extracting text, otherwise the browser correctly returns the literal “à”.
    body.querySelectorAll('*').forEach(el => {
      const face = String(el.getAttribute?.('face') || '')
      const style = String(el.getAttribute?.('style') || '')
      const font = `${face} ${style}`.toLowerCase()
      if (!/(wingdings|webdings|symbol)/.test(font)) return
      ;[...el.childNodes].forEach(node => {
        if (node.nodeType !== 3 || !node.nodeValue) return
        node.nodeValue = node.nodeValue
          .replace(/à/g, '→')
          .replace(/è/g, '➜')
      })
    })

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

function selectedTargetMayMatchSource(text = '', target = '') {
  const sample = String(text).toLowerCase()
  if (target === 'German') {
    const common = sample.match(/\b(der|die|das|den|dem|des|und|ich|wir|sie|ist|sind|nicht|mit|für|auf|von|bitte|danke|habe|wurde|werden)\b/g)?.length || 0
    const germanChars = sample.match(/[äöüß]/g)?.length || 0
    return common >= 2 || germanChars >= 2
  }
  if (target === 'English') {
    const common = sample.match(/\b(the|and|is|are|was|were|have|has|with|for|from|this|that|please|check|checked|will|not|you|your|we|our)\b/g)?.length || 0
    return common >= 3
  }
  // Keep the full detector for all other languages until we have equally reliable
  // local signals for them.
  return true
}

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
  const [extensionAction, setExtensionAction] = useState(() => String(loadDraft().extensionAction || ''))
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
  const [newGlossaryScope, setNewGlossaryScope] = useState('personal')
  const [newGlossaryRule, setNewGlossaryRule] = useState('preferred')
  const [newGlossaryContext, setNewGlossaryContext] = useState('')
  const [glossaryScopeFilter, setGlossaryScopeFilter] = useState('personal')
  const [glossaryContext, setGlossaryContext] = useState(() => {
    try { return String(loadDraft().glossaryContext || localStorage.getItem(GLOSSARY_CONTEXT_KEY) || '') } catch { return '' }
  })
  const extensionActionLabel = EXTENSION_ACTION_LABELS[extensionAction] || ''
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
    const pastedRaw = html && /<(?:li|ol|ul|p|div|br|table|tr|td)\b/i.test(html)
      ? clipboardHtmlToText(html, plain)
      : normalizeClipboardText(plain)
    const pasted = formatReadableLists(pastedRaw)
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
  useEffect(() => { try { localStorage.setItem(GLOSSARY_CONTEXT_KEY, glossaryContext) } catch {} }, [glossaryContext])
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, output, target, outputMode, writingMode, extensionAction, glossaryContext, updatedAt: Date.now() })) } catch {}
  }, [input, output, target, outputMode, writingMode, extensionAction, glossaryContext])
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

  const normaliseGlossary = item => ({
    ...item,
    scope: ['personal', 'project', 'company'].includes(item?.scope) ? item.scope : 'personal',
    context: String(item?.context || '').trim(),
    rule: ['preferred', 'locked'].includes(item?.rule) ? item.rule : 'preferred',
  })
  const glossaryForTarget = selectedTarget => glossary.map(normaliseGlossary).filter(item => {
    if (item.target !== selectedTarget) return false
    if (item.scope === 'project') return glossaryContext && item.context.toLocaleLowerCase() === glossaryContext.toLocaleLowerCase()
    return true
  })
  const activeGlossary = glossary.map(normaliseGlossary).filter(item => item.target === target && item.scope === glossaryScopeFilter)
  const registerRules = () => register === 'formal'
    ? 'For German, use formal Sie/Ihnen/Ihr consistently. Never switch to du.'
    : 'For German, use informal du/dich/dir/dein consistently. Never switch to Sie.'
  const glossaryInstructions = (selectedTarget = target) => {
    const terms = glossaryForTarget(selectedTarget)
    if (!terms.length) return ''
    const locked = terms.filter(item => item.rule === 'locked')
    const preferred = terms.filter(item => item.rule !== 'locked')
    const blocks = ['\nANA TERMINOLOGY RULES — these user-defined rules override ordinary word choice.']
    if (preferred.length) blocks.push(`Preferred wording:\n${preferred.map(item => `- "${item.source}" → "${item.preferred}" [${item.scope}${item.context ? `: ${item.context}` : ''}]`).join('\n')}`)
    if (locked.length) blocks.push(`Locked terms — copy these EXACTLY. Never translate, correct, respell or expand them:\n${locked.map(item => `- "${item.source}" [${item.scope}${item.context ? `: ${item.context}` : ''}]`).join('\n')}`)
    blocks.push('Apply project rules only for the active project context shown above; company and personal rules apply globally.')
    return blocks.join('\n')
  }

  const translationInstructions = (selectedTarget = target) => {
    const outputTarget = selectedTarget
    let instructions
    const extensionRules = {
      rewrite: 'Rewrite the supplied text in the SAME language so it sounds natural and polished. Preserve every fact, request, number, name and commitment. Do not translate. Return ONLY the finished replacement text.',
      correct: 'Correct the supplied text in the SAME language. Fix spelling, grammar and punctuation without changing meaning, tone, facts or terminology. Do not translate. Return ONLY the corrected text.',
      shorter: 'Rewrite the supplied text more concisely in the SAME language. Preserve every fact, request, condition and commitment. Do not translate. Return ONLY the shorter text.',
      friendly: 'Rewrite the supplied text in a friendly, natural tone in the SAME language. Preserve every fact and intention. Do not translate. Return ONLY the finished text.',
      formal: 'Rewrite the supplied text in a polished professional/formal tone in the SAME language. Preserve every fact and intention. Do not translate. Return ONLY the finished text.',
      du: 'Rewrite the supplied text in natural German using informal du/dich/dir/dein consistently. If the source is not German, translate it into natural German using du. Preserve every fact and intention. Return ONLY the finished text.',
      sie: 'Rewrite the supplied text in natural German using formal Sie/Ihnen/Ihr consistently. If the source is not German, translate it into natural German using Sie. Preserve every fact and intention. Return ONLY the finished text.',
      explain: `Explain the supplied text clearly and simply in ${outputTarget}. Preserve important facts, numbers and terminology. Return ONLY the explanation.`,
      reply: `Write a suitable reply in ${outputTarget} to the supplied message. Keep it natural and context-appropriate. Do not invent facts, promises or commitments. Return ONLY the reply.`,
    }
    if (extensionAction && extensionRules[extensionAction]) {
      instructions = extensionRules[extensionAction]
      return instructions + glossaryInstructions(extensionAction === 'du' || extensionAction === 'sie' ? 'German' : outputTarget)
    }
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
    const cleanedInput = formatReadableLists(normalizeClipboardText(input)).trim()
    const text = cleanedInput; if (!text || loading) return
    if (cleanedInput !== input) setInput(cleanedInput)
    setAlignmentMap([])
    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)
    let actualTarget = target
    let detectedSource = ''
    try {
      if (writingMode === 'translate' && text.replace(/\s/g, '').length >= SMART_TARGET_MIN_CHARS && selectedTargetMayMatchSource(text, target)) {
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
    const source = selected.sourceTerm.trim()
    setGlossary(prev => [
      ...prev.filter(item => {
        const normalized = normaliseGlossary(item)
        return !(normalized.scope === 'personal' && item.target === target && item.source.toLowerCase() === source.toLowerCase())
      }),
      { id: crypto.randomUUID(), target, source, preferred: term, scope: 'personal', context: '', rule: 'preferred' },
    ])
    replaceSelected(term)
  }
  const addGlossary = () => {
    const source = newSource.trim()
    const context = newGlossaryScope === 'personal' ? '' : newGlossaryContext.trim()
    const preferred = newGlossaryRule === 'locked' ? source : newPreferred.trim()
    if (!source || !preferred) return
    if (newGlossaryScope !== 'personal' && !context) {
      setError(`Enter the ${newGlossaryScope === 'project' ? 'project' : 'company'} name for this terminology rule.`)
      return
    }
    setGlossary(prev => [
      ...prev.filter(item => {
        const normalized = normaliseGlossary(item)
        return !(normalized.scope === newGlossaryScope
          && normalized.context.toLocaleLowerCase() === context.toLocaleLowerCase()
          && item.target === target
          && item.source.toLowerCase() === source.toLowerCase())
      }),
      { id: crypto.randomUUID(), target, source, preferred, scope: newGlossaryScope, context, rule: newGlossaryRule },
    ])
    if (newGlossaryScope === 'project' && context) setGlossaryContext(context)
    setNewSource(''); setNewPreferred(''); setError('')
  }
  const copyOutput = async () => { if (!output) return; await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1400) }
  const clear = () => { setInput(''); setOutput(''); setAlignmentMap([]); setOutputMode('online'); setExtensionAction(''); setSmartLanguageNotice(''); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><AnaMark className="ana-brand-mark"/></div>
      <div className="header-actions"><button className="ghost" onClick={() => setGlossaryOpen(true)}>Glossary <span className="badge">{glossary.length}</span></button><button className="ghost icon-only" title="Sign out" onClick={() => supabase?.auth.signOut()}><LogOut size={16}/></button></div>
    </header>

    <section className="translator-card">
      <div className="toolbar">
        <div className="language-pill"><Languages size={16}/><span>Auto-detect</span></div><ArrowLeftRight size={16} className="muted"/>
        <select value={target} onChange={e => { setTarget(e.target.value); setExtensionAction(''); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>{TARGETS.map(lang => <option key={lang}>{lang}</option>)}</select>
        {isGermanTarget(target) && <div className="segmented"><button className={register === 'formal' ? 'active' : ''} onClick={() => setRegister('formal')}>Sie</button><button className={register === 'informal' ? 'active' : ''} onClick={() => setRegister('informal')}>du</button></div>}
        <div className="segmented mode-segmented" aria-label="Writing mode"><button className={writingMode === 'translate' && !extensionAction ? 'active' : ''} onClick={() => { setWritingMode('translate'); setExtensionAction(''); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Translate</button><button className={writingMode === 'write' && !extensionAction ? 'active' : ''} onClick={() => { setWritingMode('write'); setExtensionAction(''); setSmartLanguageNotice(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>Write for me</button></div>
        <div className="spacer"/><button className="ghost icon-text" onClick={clear}><RotateCcw size={15}/> Clear</button>
      </div>
      <section className="workspace">
        <article className={`pane input-pane ${input.length > 900 ? 'dense-text' : ''}`}><div className="pane-label pane-label-row"><span>{writingMode === 'write' ? 'What do you want to say?' : 'Original'}</span><div className="translate-input-actions">{dictationSupported && <button type="button" className={`dictate-btn ${dictationState}`} onClick={handleDictation} disabled={dictationState === 'transcribing'} title={dictationState === 'recording' ? 'Stop voice typing' : 'Voice type instead of typing'}>{dictationState === 'recording' ? <><Square size={12}/> Stop</> : dictationState === 'transcribing' ? <><LoaderCircle size={14} className="dictate-spin"/> Writing…</> : <><Mic size={14}/> Speak</>}</button>}<button type="button" className="dictate-btn" onClick={onOpenCamera}><Camera size={14}/>Camera</button><button type="button" className="dictate-btn" onClick={onOpenDocuments}><FileText size={14}/>Document</button></div></div><textarea ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setAlignmentMap([]); if (smartLanguageNotice) setSmartLanguageNotice('') }} onPaste={handlePaste} placeholder={writingMode === 'write' ? 'Tell Ana what you need to write. Rough notes or incomplete sentences are fine…' : 'Type, paste, or speak anything…'} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') translate() }}/><div className="pane-foot"><span>{input.length.toLocaleString()} characters</span><span>{dictationState === 'recording' ? 'Listening… tap Stop when finished' : dictationState === 'transcribing' ? 'Writing what you said…' : '⌘/Ctrl + Enter'}</span></div></article>
        <article className={`pane output-pane ${output.length > 900 ? 'dense-text' : ''}`}><div className="pane-label">{extensionActionLabel ? `Ana — ${extensionActionLabel}` : writingMode === 'write' ? `${target} — written for you` : target}</div><div className="output-area">{loading ? <div className="thinking"><span></span><span></span><span></span> {extensionActionLabel ? `${extensionActionLabel}…` : writingMode === 'write' ? 'Writing…' : 'Translating…'}</div> : output ? <TranslationText text={output} onWord={inspectWord}/> : <div className="placeholder">{extensionActionLabel ? `Ana will ${extensionActionLabel.toLowerCase()} the selected text here.` : writingMode === 'write' ? 'Ana will write the finished text for you here.' : 'Your translation will appear here.'}</div>}</div><div className="pane-foot"><span>{writingMode === 'write' ? 'Tell Ana the intent and key facts — she turns them into a ready-to-send text' : output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Click a word to see its matching source and alternatives') : 'Context-aware translation'}</span><button className="copy" disabled={!output} onClick={copyOutput}>{copied ? <><Check size={15}/> Copied</> : <><Clipboard size={15}/> Copy</>}</button></div></article>
      </section>
    </section>

    {smartLanguageNotice && <div className="smart-language-note">{smartLanguageNotice}</div>}
    {offlineNotice && <div className="ana-offline-note">{offlineNotice}</div>}
    {error && <div className="error">{error}</div>}
    <div className="action-row"><button className="translate-btn" disabled={!input.trim() || loading} onClick={translate}>{loading ? (extensionActionLabel ? `${extensionActionLabel}…` : writingMode === 'write' ? 'Writing…' : 'Translating…') : extensionActionLabel || (writingMode === 'write' ? 'Write for me' : 'Translate')}</button></div>

    {selected && <div className="popover-backdrop" onMouseDown={() => setSelected(null)}><div className="popover" onMouseDown={e => e.stopPropagation()}><div className="popover-head"><div><strong>{selected.word}</strong>{selected.partOfSpeech && <span>{selected.partOfSpeech}</span>}</div><button onClick={() => setSelected(null)}><X size={18}/></button></div>{selected.sourceContext && <div className="source-match"><span>Corresponding source</span><p>{selected.sourceContext}</p></div>}{suggestLoading ? <div className="popover-loading">Finding the best alternatives…</div> : <>{selected.meaning && <div className="meaning">{selected.meaning}{selected.sourceTerm && <small>From: <b>{selected.sourceTerm}</b></small>}</div>}<div className="alternative-list">{selected.alternatives?.length ? selected.alternatives.map(item => <div className="alternative" key={item.term}><button onClick={() => replaceSelected(item.term)}><strong>{item.term}</strong><span>{item.note}</span></button><button className="always" onClick={() => useAlways(item.term)}>Always</button></div>) : <div className="empty-mini">No clean drop-in alternatives found.</div>}</div></>}</div></div>}

    {glossaryOpen && <div className="drawer-backdrop" onMouseDown={() => setGlossaryOpen(false)}><aside className="drawer glossary-drawer" onMouseDown={e => e.stopPropagation()}><div className="drawer-head"><div><h2>Ana glossary</h2><p>{glossary.length} rules synced with your Ana account · {target}.</p></div><button onClick={() => setGlossaryOpen(false)}><X size={20}/></button></div>
      <div className="glossary-context-card"><label>Active project context</label><input value={glossaryContext} onChange={e => setGlossaryContext(e.target.value)} placeholder="e.g. S/4HANA Transformation"/><small>Personal and company rules always apply. Project rules apply only when this context matches.</small></div>
      <div className="glossary-scope-tabs">{[['personal','Personal'],['project','Project'],['company','Company']].map(([id,label])=><button type="button" className={glossaryScopeFilter===id?'active':''} onClick={()=>{setGlossaryScopeFilter(id);setNewGlossaryScope(id)}} key={id}>{label}</button>)}</div>
      <div className="add-rule scoped-add-rule">
        <select value={newGlossaryScope} onChange={e=>setNewGlossaryScope(e.target.value)}><option value="personal">Personal</option><option value="project">Project</option><option value="company">Company</option></select>
        {newGlossaryScope!=='personal' && <input value={newGlossaryContext} onChange={e=>setNewGlossaryContext(e.target.value)} placeholder={newGlossaryScope==='project'?'Project name':'Company name'}/>}
        <select value={newGlossaryRule} onChange={e=>setNewGlossaryRule(e.target.value)}><option value="preferred">Preferred wording</option><option value="locked">Never translate / correct</option></select>
        <input value={newSource} onChange={e=>setNewSource(e.target.value)} placeholder="Term"/>
        {newGlossaryRule==='preferred' && <><span>→</span><input value={newPreferred} onChange={e=>setNewPreferred(e.target.value)} placeholder={`Preferred ${target}`}/></>}
        <button onClick={addGlossary}><Plus size={17}/></button>
      </div>
      <div className="rules">{activeGlossary.length ? activeGlossary.map(item => <div className="rule scoped-rule" key={item.id}><div><div className="rule-badges"><small>{item.scope}</small>{item.context&&<small>{item.context}</small>}<small>{item.rule==='locked'?'Locked':'Preferred'}</small></div><strong>{item.source}</strong>{item.rule==='locked'?<><span>→</span><b>keep exactly</b></>:<><span>→</span><b>{item.preferred}</b></>}</div><button onClick={() => setGlossary(prev => prev.filter(x => x.id !== item.id))}><Trash2 size={16}/></button></div>) : <div className="empty-rules">No {glossaryScopeFilter} terms for {target} yet.</div>}</div>
    </aside></div>}
  </main>
}
