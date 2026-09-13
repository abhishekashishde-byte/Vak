import { markAccountPreferencesChanged } from './accountPreferences.js'

const MEMORY_KEY = 'ana-personal-language-memory-v1'
const GLOSSARY_KEY = 'ana-glossary-v1'
const REGISTER_KEY = 'ana-german-register'

let installed = false
let nativeFetch = null
let nativeRtcSend = null

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const readMemory = () => readJson(MEMORY_KEY, {})

const writeMemory = patch => {
  try {
    const next = { ...readMemory(), ...patch, updatedAt: Date.now() }
    localStorage.setItem(MEMORY_KEY, JSON.stringify(next))
    markAccountPreferencesChanged()
    return next
  } catch {
    return readMemory()
  }
}

const clean = value => String(value || '').trim()

const learnFromInstructions = instructions => {
  const text = clean(instructions)
  if (!text) return

  const patch = {}
  const owner = text.match(/OWNER LANGUAGE:\s*(English|German|Swabian German \(Schwäbisch\)|Bavarian German \(Bairisch\)|Low German \(Plattdeutsch\)|Hindi|Hinglish|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian)/i)
  const other = text.match(/OTHER PERSON LANGUAGE:\s*(English|German|Swabian German \(Schwäbisch\)|Bavarian German \(Bairisch\)|Low German \(Plattdeutsch\)|Hindi|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian)/i)
  const live = text.match(/live two-way interpreter between\s+(English|German|Swabian German \(Schwäbisch\)|Bavarian German \(Bairisch\)|Low German \(Plattdeutsch\)|Hindi|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian)\s+and\s+(English|German|Swabian German \(Schwäbisch\)|Bavarian German \(Bairisch\)|Low German \(Plattdeutsch\)|Hindi|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian)/i)

  if (owner?.[1]) patch.ownerLanguage = owner[1]
  if (other?.[1]) patch.lastOtherLanguage = other[1]
  if (live?.[1] && live?.[2]) patch.lastLiveLanguages = [live[1], live[2]]
  if (/formal Sie\/Ihnen\/Ihr consistently/i.test(text)) patch.germanRegister = 'formal'
  if (/informal du\/dich\/dir\/dein consistently/i.test(text)) patch.germanRegister = 'informal'

  if (Object.keys(patch).length) writeMemory(patch)
}

const groupedGlossary = () => {
  const glossary = readJson(GLOSSARY_KEY, [])
  if (!Array.isArray(glossary)) return []

  const groups = new Map()
  for (const item of glossary.slice(-60)) {
    const target = clean(item?.target)
    const source = clean(item?.source)
    const preferred = clean(item?.preferred)
    if (!target || !source || !preferred) continue
    if (!groups.has(target)) groups.set(target, [])
    groups.get(target).push({ source, preferred })
  }
  return [...groups.entries()]
}

export const personalLanguageInstructions = () => {
  const memory = readMemory()
  let germanRegister = memory.germanRegister
  try { germanRegister = localStorage.getItem(REGISTER_KEY) || germanRegister } catch {}

  const lines = [
    'ANA PERSONAL LANGUAGE MEMORY — apply these preferences only when relevant. Explicit instructions in the current task always win. Never change a requested output format because of memory.',
  ]

  if (germanRegister === 'formal') {
    lines.push('- German register preference: default to formal Sie/Ihnen/Ihr when the source does not clearly require another register. Preserve clearly intentional informal speech.')
  } else if (germanRegister === 'informal') {
    lines.push('- German register preference: default to informal du/dich/dir/dein when the source does not clearly require another register. Preserve clearly intentional formal speech.')
  }

  if (memory.ownerLanguage) {
    lines.push(`- The user's previously preferred owner-facing language is ${memory.ownerLanguage}. Treat this only as a fallback when the current user language is not clear.`)
    if (memory.ownerLanguage === 'Hinglish') {
      lines.push('- For owner-facing Hinglish, use natural conversational Hindi in Roman/Latin letters only, never Devanagari.')
    }
  }

  const groups = groupedGlossary()
  if (groups.length) {
    lines.push('- Remembered terminology/corrections below are user preferences. Apply an entry only when producing its listed target language and when it fits the current meaning:')
    for (const [target, items] of groups) {
      lines.push(`  ${target}: ${items.map(item => `"${item.source}" → "${item.preferred}"`).join('; ')}`)
    }
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

const augmentTranslateFetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url
  if (!url || !url.includes('/api/translate') || String(init?.method || 'GET').toUpperCase() !== 'POST' || typeof init?.body !== 'string') {
    return { input, init }
  }

  try {
    const body = JSON.parse(init.body)
    learnFromInstructions(body.instructions)
    const memory = personalLanguageInstructions()
    if (!memory) return { input, init }
    body.instructions = `${clean(body.instructions)}\n\n${memory}`.trim()
    return { input, init: { ...init, body: JSON.stringify(body) } }
  } catch {
    return { input, init }
  }
}

const augmentRealtimeEvent = data => {
  if (typeof data !== 'string') return data
  try {
    const event = JSON.parse(data)
    if (event?.type !== 'session.update' || !event?.session) return data
    learnFromInstructions(event.session.instructions)
    const memory = personalLanguageInstructions()
    if (!memory) return data
    event.session.instructions = `${clean(event.session.instructions)}\n\n${memory}`.trim()
    return JSON.stringify(event)
  } catch {
    return data
  }
}

export function installPersonalLanguageMemory() {
  if (installed || typeof window === 'undefined') return
  installed = true

  if (window.fetch) {
    nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const next = augmentTranslateFetch(input, init)
      return nativeFetch(next.input, next.init)
    }
  }

  const rtcProto = window.RTCDataChannel?.prototype
  if (rtcProto?.send) {
    nativeRtcSend = rtcProto.send
    rtcProto.send = function sendWithAnaMemory(data) {
      return nativeRtcSend.call(this, augmentRealtimeEvent(data))
    }
  }
}

export function getPersonalLanguageMemory() {
  return readMemory()
}

export function rememberPersonalLanguagePreference(patch) {
  return writeMemory(patch)
}
