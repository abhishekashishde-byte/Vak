const DOMAIN_IDS = new Set(['general', 'sap', 'medical', 'legal', 'finance'])

const PROFILES = {
  general: {
    label: 'General',
    terms: [],
    prompt: '',
  },
  sap: {
    label: 'SAP',
    terms: [
      ['sap', 5], ['s/4hana', 6], ['s4hana', 6], ['ecc', 4], ['fiori', 4], ['spro', 6],
      ['t-code', 7], ['tcode', 7], ['transaction code', 6], ['migo', 7], ['miro', 7], ['me21n', 7], ['me23n', 7],
      ['iw32', 7], ['iw31', 7], ['co11n', 7], ['cm25', 7], ['cm01', 7], ['md01n', 7], ['md04', 7],
      ['mrp', 5], ['pp/ds', 7], ['ppds', 7], ['pds', 5], ['bom', 5], ['routing', 4], ['work center', 4],
      ['wareneingang', 7], ['warenausgang', 7], ['goods receipt', 6], ['goods issue', 6],
      ['prüfplan', 7], ['arbeitsplan', 7], ['stückliste', 7], ['rückmeldung', 6], ['fertigungsauftrag', 7],
      ['instandhaltung', 5], ['funktionsplatz', 7], ['equipment', 3], ['materialstamm', 6], ['bestellung', 4],
      ['banf', 6], ['bewegungsart', 6], ['warenbewegung', 5], ['lagerort', 5], ['werk', 2.5], ['disposition', 3],
      ['production version', 5], ['inspection plan', 5], ['maintenance order', 5], ['planned order', 5],
      ['material document', 5], ['purchase order', 4], ['functional location', 6], ['notification', 2],
    ],
    prompt: `SAP DOMAIN CONTEXT — mandatory when relevant:
- Interpret ambiguous business words using standard SAP meaning, not literal everyday meaning.
- Preserve SAP transaction codes, object names, acronyms, configuration terms, material numbers and technical identifiers exactly.
- Use established SAP English terminology where it exists. Examples: Wareneingang = Goods Receipt (GR), Warenausgang = Goods Issue (GI), Prüfplan = Inspection Plan, Arbeitsplan = Routing, Stückliste = BOM, Rückmeldung = Confirmation, Funktionsplatz = Functional Location.
- Treat “T-code” as transaction code; never normalize it into a similar-sounding ordinary phrase.
- Do not invent a transaction, field, process step or SAP meaning that is not supported by the source.
- If SAP and Finance overlap, preserve both SAP process meaning and finance terminology.`,
  },
  medical: {
    label: 'Medical',
    terms: [
      ['arzt', 4], ['ärztin', 4], ['patient', 4], ['patientin', 4], ['anamnese', 7], ['diagnose', 5],
      ['medikament', 5], ['medication', 5], ['allergie', 5], ['symptom', 4], ['behandlung', 4], ['therapie', 5],
      ['operation', 3], ['ultraschall', 6], ['blutdruck', 6], ['labor', 4], ['blutuntersuchung', 6], ['arztbrief', 7],
      ['überweisung', 4], ['krankenkasse', 3], ['versichertenkarte', 5], ['vorerkrankung', 7], ['vorerkrankungen', 7],
      ['schwangerschaft', 6], ['kinderwunsch', 7], ['zyklus', 5], ['eisprung', 6], ['fruchtbarkeit', 6], ['fertility', 6],
      ['schilddrüse', 6], ['blutverdünner', 7], ['dosierung', 6], ['impfung', 5], ['rezept', 4], ['befund', 6],
      ['fragebogen', 1.5], ['medical', 5], ['clinical', 5], ['doctor', 4], ['hospital', 4], ['clinic', 4],
      ['pain', 2.5], ['fever', 3], ['blood test', 5], ['pregnancy', 5], ['treatment', 4], ['diagnosis', 5],
    ],
    prompt: `MEDICAL DOMAIN CONTEXT — mandatory when relevant:
- Preserve the clinical meaning of symptoms, diagnoses, medications, anatomy, procedures, measurements, contraindications and questionnaire wording.
- Prefer established medical English/German terminology over casual literal translations, while keeping the wording understandable.
- Never silently change a negative into a positive, a frequency, dose, duration, body side, unit, date, or risk qualifier.
- For forms, translate the question faithfully enough that the user can answer the form; do not answer the medical question on the user's behalf.
- When the task is explanation rather than translation, explain medical wording plainly and distinguish explanation from the original clinical term.
- Do not diagnose or invent medical facts that are not in the source.`,
  },
  legal: {
    label: 'Legal',
    terms: [
      ['vertrag', 5], ['vertrags', 4], ['klausel', 6], ['kündigung', 6], ['haftung', 6], ['gewährleistung', 6],
      ['anspruch', 4], ['frist', 3], ['gericht', 5], ['anwalt', 5], ['rechtsanwalt', 6], ['gesetz', 5], ['paragraph', 4],
      ['dsgvo', 7], ['datenschutz', 5], ['einwilligung', 5], ['vollmacht', 6], ['widerspruch', 4], ['rechtsbehelf', 6],
      ['contract', 5], ['clause', 6], ['liability', 6], ['warranty', 5], ['legal', 5], ['statute', 6], ['court', 5],
      ['consent', 3], ['privacy', 3], ['obligation', 4], ['termination', 5], ['claim', 3], ['attorney', 5],
    ],
    prompt: `LEGAL DOMAIN CONTEXT — mandatory when relevant:
- Preserve legal effect, defined terms, obligations, permissions, prohibitions, conditions, deadlines, exceptions and references precisely.
- Do not simplify away qualifiers such as may, must, unless, subject to, without prejudice, or equivalent German legal wording.
- Keep clause numbering, section references, dates, parties and quoted terms intact.
- Prefer established legal terminology in the target language, but do not invent legal conclusions or provide legal advice unless explicitly asked.`,
  },
  finance: {
    label: 'Finance',
    terms: [
      ['rechnung', 4], ['buchung', 4], ['bilanz', 6], ['kostenstelle', 6], ['kostenart', 5], ['steuer', 4], ['umsatzsteuer', 6],
      ['zahlung', 3], ['iban', 6], ['budget', 4], ['forecast', 4], ['marge', 5], ['abschreibung', 6], ['anlagevermögen', 6],
      ['invoice', 4], ['accounting', 5], ['balance sheet', 6], ['cost center', 6], ['cash flow', 6], ['cashflow', 6],
      ['revenue', 5], ['expense', 4], ['asset', 3], ['depreciation', 6], ['margin', 4], ['tax', 3], ['vat', 5],
      ['profit', 4], ['loss', 3], ['financial', 4], ['payment', 3], ['purchase price', 3],
    ],
    prompt: `FINANCE DOMAIN CONTEXT — mandatory when relevant:
- Preserve accounting and finance meaning, signs, currencies, percentages, periods, totals, tax treatment and units exactly.
- Use standard finance/accounting terminology rather than casual literal wording.
- Distinguish similar concepts such as revenue vs cash receipt, expense vs payment, asset vs cost, and forecast vs actual.
- If Finance overlaps with SAP, retain the SAP process/object term where that is the source meaning rather than replacing it with a generic finance phrase.
- Never invent figures, reconciliations or financial conclusions.`,
  },
}

const UNIVERSAL_AMBIGUITY_TERMS = [
  'T-code', 'transaction code', 'SAP', 'MIGO', 'SPRO', 'Wareneingang', 'Warenausgang', 'Goods Receipt', 'Goods Issue',
  'Prüfplan', 'Arbeitsplan', 'Stückliste', 'Rückmeldung', 'Anamnese', 'Vorerkrankungen', 'Kinderwunsch', 'Schilddrüse',
  'Blutverdünner', 'Diagnose', 'Medikament', 'DSGVO', 'Kündigung', 'Haftung', 'Kostenstelle', 'Umsatzsteuer',
]

const cleanText = value => String(value || '')
  .toLocaleLowerCase()
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/\s+/g, ' ')
  .slice(0, 24000)

function countOccurrences(haystack, needle) {
  if (!needle || !haystack.includes(needle)) return 0
  let count = 0
  let cursor = 0
  while (count < 4) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) break
    count += 1
    cursor = index + needle.length
  }
  return count
}

function scoreDomains(text) {
  const sample = cleanText(text)
  const scores = {}
  for (const id of ['sap', 'medical', 'legal', 'finance']) {
    let score = 0
    for (const [term, weight] of PROFILES[id].terms) {
      const hits = countOccurrences(sample, term.toLocaleLowerCase())
      if (hits) score += Number(weight) * (1 + Math.min(2, hits - 1) * 0.35)
    }
    scores[id] = score
  }
  return scores
}

function normalizeDomainRequest(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const requestedMode = String(raw.mode || 'auto').trim().toLocaleLowerCase()
  const mode = requestedMode === 'auto' || DOMAIN_IDS.has(requestedMode) ? requestedMode : 'auto'
  const active = DOMAIN_IDS.has(String(raw.active || '').trim().toLocaleLowerCase())
    ? String(raw.active).trim().toLocaleLowerCase()
    : 'general'
  const secondary = DOMAIN_IDS.has(String(raw.secondary || '').trim().toLocaleLowerCase())
    ? String(raw.secondary).trim().toLocaleLowerCase()
    : ''
  return { mode, active, secondary }
}

export function resolveDomain(text = '', requested = null) {
  const preference = normalizeDomainRequest(requested)
  if (preference.mode !== 'auto') {
    return {
      mode: preference.mode,
      active: preference.mode,
      secondary: '',
      confidence: 1,
      detected: false,
      scores: {},
    }
  }

  const scores = scoreDomains(text)
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topId = 'general', topScore = 0] = ranked[0] || []
  const [secondId = '', secondScore = 0] = ranked[1] || []
  const enoughEvidence = topScore >= 4
  const active = enoughEvidence ? topId : preference.active
  const confidence = enoughEvidence ? Math.min(0.99, 0.55 + topScore / 24) : (active !== 'general' ? 0.55 : 0.35)
  const secondary = enoughEvidence && secondScore >= 3.5 && secondScore >= topScore * 0.48 ? secondId : ''

  return {
    mode: 'auto',
    active: DOMAIN_IDS.has(active) ? active : 'general',
    secondary: secondary && secondary !== active ? secondary : '',
    confidence,
    detected: enoughEvidence,
    scores,
  }
}

export function domainPrompt(resolution) {
  const active = DOMAIN_IDS.has(resolution?.active) ? resolution.active : 'general'
  const secondary = DOMAIN_IDS.has(resolution?.secondary) ? resolution.secondary : ''
  const parts = []
  if (active !== 'general' && PROFILES[active]?.prompt) parts.push(PROFILES[active].prompt)
  if (secondary && secondary !== 'general' && secondary !== active && PROFILES[secondary]?.prompt) {
    parts.push(`SECONDARY DOMAIN CONTEXT (${PROFILES[secondary].label}):\n${PROFILES[secondary].prompt}`)
  }
  if (parts.length) {
    parts.push('DOMAIN PRIORITY: preserve the source meaning first. A user-supplied personal glossary or explicit wording preference overrides a generic domain synonym when they conflict.')
  }
  return parts.join('\n\n')
}

export function transcriptionDomainPrompt(resolution) {
  const active = DOMAIN_IDS.has(resolution?.active) ? resolution.active : 'general'
  if (active === 'sap') return 'Current context is SAP. Be especially careful with T-codes, transaction names, German SAP terminology, acronyms, object names, material numbers and technical identifiers. Hear “T-code” as transaction code when the audio supports it.'
  if (active === 'medical') return 'Current context is medical. Be especially careful with clinical terms, medication names, anatomy, symptoms, diagnoses, procedures, measurements, questionnaire wording and German medical vocabulary.'
  if (active === 'legal') return 'Current context is legal. Be especially careful with clause numbers, legal terms, dates, names, obligations, permissions, prohibitions and German legal vocabulary.'
  if (active === 'finance') return 'Current context is finance/accounting. Be especially careful with figures, currencies, percentages, periods, accounting terms, cost centers, tax terms and finance abbreviations.'
  return 'The domain may change while the conversation continues. Preserve specialized terminology exactly when clearly heard instead of replacing it with a similar-sounding everyday phrase.'
}

export function domainKeywords(resolution, { includeUniversal = true, limit = 40 } = {}) {
  const out = []
  const seen = new Set()
  const add = value => {
    const text = String(value || '').trim()
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key) || out.length >= limit) return
    seen.add(key)
    out.push(text)
  }

  const active = DOMAIN_IDS.has(resolution?.active) ? resolution.active : 'general'
  const secondary = DOMAIN_IDS.has(resolution?.secondary) ? resolution.secondary : ''
  for (const id of [active, secondary]) {
    if (!id || id === 'general') continue
    for (const [term] of PROFILES[id].terms) add(term)
  }
  if (includeUniversal) UNIVERSAL_AMBIGUITY_TERMS.forEach(add)
  return out.slice(0, limit)
}

export function publicDomain(resolution) {
  const active = DOMAIN_IDS.has(resolution?.active) ? resolution.active : 'general'
  const secondary = DOMAIN_IDS.has(resolution?.secondary) ? resolution.secondary : ''
  return {
    mode: resolution?.mode === 'auto' ? 'auto' : active,
    active,
    secondary: secondary && secondary !== active ? secondary : '',
    label: PROFILES[active]?.label || 'General',
    confidence: Math.max(0, Math.min(1, Number(resolution?.confidence) || 0)),
    detected: Boolean(resolution?.detected),
  }
}

export function profileLabel(id) {
  return PROFILES[id]?.label || 'General'
}
