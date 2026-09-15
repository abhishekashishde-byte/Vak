const STORAGE_KEY = 'ana-domain-context-v1'
const EVENT_NAME = 'ana-domain-changed'
const FETCH_PATCH_FLAG = '__anaDomainFetchInstalled'

export const DOMAIN_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'general', label: 'General' },
  { id: 'sap', label: 'SAP' },
  { id: 'medical', label: 'Medical' },
  { id: 'legal', label: 'Legal' },
  { id: 'finance', label: 'Finance' },
]

const VALID = new Set(DOMAIN_OPTIONS.map(item => item.id))
const DOMAIN_LABELS = Object.fromEntries(DOMAIN_OPTIONS.map(item => [item.id, item.label]))

const LEXICON = {
  sap: [
    ['sap', 5], ['s/4hana', 6], ['s4hana', 6], ['ecc', 4], ['fiori', 4], ['spro', 6],
    ['t-code', 7], ['tcode', 7], ['transaction code', 6], ['migo', 7], ['miro', 7], ['me21n', 7], ['me23n', 7],
    ['iw32', 7], ['iw31', 7], ['co11n', 7], ['cm25', 7], ['cm01', 7], ['md01n', 7], ['md04', 7],
    ['mrp', 5], ['pp/ds', 7], ['ppds', 7], ['pds', 5], ['bom', 5], ['routing', 4], ['work center', 4],
    ['wareneingang', 7], ['warenausgang', 7], ['goods receipt', 6], ['goods issue', 6],
    ['prüfplan', 7], ['arbeitsplan', 7], ['stückliste', 7], ['rückmeldung', 6], ['fertigungsauftrag', 7],
    ['instandhaltung', 5], ['funktionsplatz', 7], ['materialstamm', 6], ['banf', 6], ['bewegungsart', 6],
    ['warenbewegung', 5], ['lagerort', 5], ['production version', 5], ['inspection plan', 5],
    ['material document', 5], ['functional location', 6], ['planned order', 5],
  ],
  medical: [
    ['arzt', 4], ['ärztin', 4], ['patient', 4], ['patientin', 4], ['anamnese', 7], ['diagnose', 5],
    ['medikament', 5], ['allergie', 5], ['symptom', 4], ['behandlung', 4], ['therapie', 5], ['ultraschall', 6],
    ['blutdruck', 6], ['labor', 4], ['blutuntersuchung', 6], ['arztbrief', 7], ['vorerkrankung', 7], ['vorerkrankungen', 7],
    ['schwangerschaft', 6], ['kinderwunsch', 7], ['zyklus', 5], ['eisprung', 6], ['fruchtbarkeit', 6], ['fertility', 6],
    ['schilddrüse', 6], ['blutverdünner', 7], ['dosierung', 6], ['impfung', 5], ['befund', 6],
    ['medical', 5], ['clinical', 5], ['doctor', 4], ['hospital', 4], ['clinic', 4], ['blood test', 5], ['pregnancy', 5],
  ],
  legal: [
    ['vertrag', 5], ['klausel', 6], ['kündigung', 6], ['haftung', 6], ['gewährleistung', 6], ['gericht', 5],
    ['anwalt', 5], ['rechtsanwalt', 6], ['gesetz', 5], ['dsgvo', 7], ['datenschutz', 5], ['vollmacht', 6],
    ['legal', 5], ['contract', 5], ['clause', 6], ['liability', 6], ['warranty', 5], ['statute', 6], ['court', 5],
    ['termination', 5], ['attorney', 5],
  ],
  finance: [
    ['rechnung', 4], ['buchung', 4], ['bilanz', 6], ['kostenstelle', 6], ['kostenart', 5], ['umsatzsteuer', 6],
    ['budget', 4], ['forecast', 4], ['marge', 5], ['abschreibung', 6], ['anlagevermögen', 6], ['invoice', 4],
    ['accounting', 5], ['balance sheet', 6], ['cost center', 6], ['cash flow', 6], ['cashflow', 6],
    ['revenue', 5], ['expense', 4], ['depreciation', 6], ['margin', 4], ['vat', 5], ['profit', 4], ['financial', 4],
  ],
}

let evidence = []
let current = readState()

function readState() {
  if (typeof localStorage === 'undefined') return { mode: 'auto', active: 'general', secondary: '', confidence: 0.35 }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const mode = VALID.has(value?.mode) ? value.mode : 'auto'
    const active = VALID.has(value?.active) && value.active !== 'auto' ? value.active : (mode !== 'auto' ? mode : 'general')
    const secondary = VALID.has(value?.secondary) && !['auto', active].includes(value.secondary) ? value.secondary : ''
    return { mode, active, secondary, confidence: Number(value?.confidence) || (mode === 'auto' ? 0.35 : 1) }
  } catch {
    return { mode: 'auto', active: 'general', secondary: '', confidence: 0.35 }
  }
}

function writeState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)) } catch {}
}

function dispatch(reason = '') {
  writeState()
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...current, reason } })) } catch {}
}

const clean = value => String(value || '').toLocaleLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').slice(0, 10000)

function occurrences(text, term) {
  let count = 0, cursor = 0
  while (count < 3) {
    const index = text.indexOf(term, cursor)
    if (index < 0) break
    count += 1
    cursor = index + term.length
  }
  return count
}

function scoreText(text, multiplier = 1) {
  const sample = clean(text)
  const scores = { sap: 0, medical: 0, legal: 0, finance: 0 }
  if (!sample) return scores
  Object.entries(LEXICON).forEach(([domain, terms]) => {
    for (const [term, weight] of terms) {
      const hits = occurrences(sample, term)
      if (hits) scores[domain] += Number(weight) * multiplier * (1 + Math.min(2, hits - 1) * 0.3)
    }
  })
  return scores
}

function recomputeFromEvidence(reason = 'auto') {
  if (current.mode !== 'auto') return current
  const scores = { sap: 0, medical: 0, legal: 0, finance: 0 }
  evidence.slice(-6).forEach((entry, index, list) => {
    const age = list.length - 1 - index
    const decay = Math.pow(0.58, age)
    const part = scoreText(entry.text, decay)
    Object.keys(scores).forEach(key => { scores[key] += part[key] })
  })

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topId = 'general', topScore = 0] = ranked[0] || []
  const [secondId = '', secondScore = 0] = ranked[1] || []
  if (topScore < 4) return current

  const next = {
    mode: 'auto',
    active: topId,
    secondary: secondScore >= 3.5 && secondScore >= topScore * 0.48 ? secondId : '',
    confidence: Math.min(0.99, 0.55 + topScore / 24),
  }
  const changed = next.active !== current.active || next.secondary !== current.secondary || Math.abs(next.confidence - current.confidence) > 0.08
  current = next
  if (changed) dispatch(reason)
  return current
}

export function observeDomainText(text, reason = 'content') {
  const value = String(text || '').trim()
  if (!value || current.mode !== 'auto') return current
  evidence.push({ text: value.slice(0, 6000), at: Date.now() })
  if (evidence.length > 8) evidence = evidence.slice(-8)
  return recomputeFromEvidence(reason)
}

export function applyServerDomain(domain, reason = 'server') {
  if (current.mode !== 'auto' || !domain || typeof domain !== 'object') return current
  const active = VALID.has(domain.active) && domain.active !== 'auto' ? domain.active : current.active
  const secondary = VALID.has(domain.secondary) && !['auto', active].includes(domain.secondary) ? domain.secondary : ''
  const confidence = Math.max(0, Math.min(1, Number(domain.confidence) || 0))
  if (confidence < 0.52 || !active) return current
  const changed = active !== current.active || secondary !== current.secondary
  current = { mode: 'auto', active, secondary, confidence }
  if (changed) dispatch(reason)
  return current
}

export function setDomainMode(mode) {
  const value = VALID.has(mode) ? mode : 'auto'
  evidence = []
  current = value === 'auto'
    ? { mode: 'auto', active: current.active || 'general', secondary: '', confidence: current.active === 'general' ? 0.35 : 0.55 }
    : { mode: value, active: value, secondary: '', confidence: 1 }
  dispatch('manual')
  return current
}

export function getDomainState() { return { ...current } }
export function getDomainPayload() { return { mode: current.mode, active: current.active, secondary: current.secondary } }
export function domainLabel(id) { return DOMAIN_LABELS[id] || 'General' }
export function subscribeDomain(listener) {
  if (typeof window === 'undefined') return () => {}
  const handler = event => listener?.(event?.detail || getDomainState())
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

function internalAnaEndpoint(input) {
  const raw = typeof input === 'string' ? input : input?.url
  if (!raw) return false
  try {
    const url = new URL(raw, window.location.href)
    if (url.origin !== window.location.origin) return false
    return /^\/api\/(translate|transcribe|document-ocr|ocr|realtime-token|realtime-translation-token|meeting-segment|v1\/)/.test(url.pathname)
  } catch { return false }
}

function evidenceFromBody(body) {
  if (!body || typeof body !== 'object') return ''
  if (typeof body.text === 'string') return body.text
  if (typeof body.contextHints === 'string') return body.contextHints
  if (typeof body.context === 'string') return body.context
  return ''
}

export function installDomainFetchInterceptor() {
  if (typeof window === 'undefined' || window[FETCH_PATCH_FLAG]) return
  window[FETCH_PATCH_FLAG] = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    if (!internalAnaEndpoint(input)) return nativeFetch(input, init)

    let nextInit = init
    try {
      const contentType = String(init?.headers?.['Content-Type'] || init?.headers?.['content-type'] || '')
      if (typeof init?.body === 'string' && contentType.includes('application/json')) {
        const parsed = JSON.parse(init.body)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const sample = evidenceFromBody(parsed)
          if (sample) observeDomainText(sample, 'request')
          parsed.domain = parsed.domain || getDomainPayload()
          nextInit = { ...init, body: JSON.stringify(parsed) }
        }
      }
    } catch {}

    const response = await nativeFetch(input, nextInit)
    try {
      response.clone().json().then(data => {
        if (data?.domain) applyServerDomain(data.domain, 'server')
        if (Array.isArray(data?.blocks) && data.blocks.length) {
          const text = data.blocks.map(item => item?.text || '').join(' ')
          if (text) observeDomainText(text, 'ocr')
        }
        if (typeof data?.text === 'string' && data.text) observeDomainText(data.text, 'transcript')
      }).catch(() => {})
    } catch {}
    return response
  }
}
