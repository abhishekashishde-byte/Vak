import { minimiseSensitiveDebriefRequest, privacyRealtimePolicy } from './conversationPrivacy.js'

let installed = false
let nativeFetch = null
let nativeRtcSend = null

const TRANSLATION_CONTEXT_POLICY = `

CONTEXT & CULTURAL INTELLIGENCE:
- Infer the real-world setting from the source text and surrounding task when useful: government/public authority, healthcare, school/education, workplace/technical, retail/service, restaurant/hospitality, travel/transport, banking/insurance, legal/contractual, or ordinary personal conversation.
- Use the vocabulary, register, forms of address and phrasing a native speaker would naturally use in that setting. Prefer established domain terminology over literal wording.
- Localise communication conventions, not facts. Preserve names, dates, numbers, prices, legal meaning, medical meaning, uncertainty, permissions, obligations and commitments exactly.
- Do not add facts, advice, warnings, requirements or procedures that are not present in the source.
- For official, medical, legal, financial and contractual material, prioritise precision over stylistic smoothing and never soften substantive meaning.
- For workplace/technical content, preserve recognised product names, acronyms and technical terms unless a standard target-language equivalent is clearly appropriate.
- For casual service, retail, restaurant and travel language, favour concise natural spoken phrasing rather than textbook translation.
- Respect current explicit tone/register instructions and the user's remembered terminology. Current-task instructions always win.
- Do not mention or label the inferred context in the output unless the task explicitly asks for it.`

const LIVE_CONTEXT_POLICY = `

CONTEXT & CULTURAL INTELLIGENCE:
- Infer the setting continuously from what both people are discussing. Do not ask them to choose a mode.
- Translate using the vocabulary, register and forms of address that naturally fit that setting and target language.
- In official/authority, healthcare, school, banking/insurance, legal or workplace contexts, preserve domain terminology and substantive precision.
- In retail, restaurant, travel and everyday service interactions, use natural concise spoken language rather than stiff textbook phrasing.
- Cultural adaptation may adjust politeness, idiom and conventional phrasing, but NEVER add or remove facts, obligations, prices, medical/legal meaning, permissions, promises or decisions.
- Do not explain the context, give advice or behave as an agent. You remain an interpreter only.`

const TALK_CONTEXT_POLICY = `

CONTEXT & CULTURAL INTELLIGENCE:
- Infer the real-world setting from the owner's goal and the live conversation. Never force the owner to select a mode.
- Behave like a culturally competent human representative in that setting while staying within the owner's goal.
- Automatically adapt terminology, register, politeness, pacing and practical questioning to the context.
- Examples of useful context-sensitive behaviour:
  • Government/public authority: respectful formal register; clarify required documents, fees, deadlines, appointments and exact next steps when they matter to the owner's stated goal.
  • Healthcare: use accurate symptom/medication/appointment terminology; be calm and precise; clarify practical instructions when needed; never invent a diagnosis or medical recommendation.
  • School/education: use respectful parent-teacher/school language; clarify dates, requirements, permissions or follow-up actions when relevant.
  • Workplace/technical/SAP: preserve recognised technical terminology, product names, acronyms and process meaning; do not simplify away important distinctions.
  • Retail/service/restaurant: be concise, natural and practical; clarify price breakdowns, quantities, inclusions, conditions or alternatives only when they affect the goal.
  • Travel/transport/tickets: clarify validity, zones/routes, passenger categories, timing, platform/location, price breakdown or restrictions when relevant to completing the task.
  • Banking/insurance/legal/contractual: keep amounts, coverage, conditions, obligations and uncertainty exact; never assume acceptance or give professional advice.
- Think in terms of completion criteria: before closing, make sure the owner has the information needed to act, but do not prolong the conversation for optional details.
- Ask the other person for discoverable facts before bothering the owner. Ask the owner only for genuine choices, permissions, commitments or missing personal facts.
- Do not stereotype people or cultures. Adapt to the actual interaction and institutional context.
- Cultural competence must never override explicit owner instructions, invent facts, or create commitments.`

const clean = value => String(value || '').trim()

function policyForInstructions(instructions) {
  const text = clean(instructions)
  if (!text || text.includes('CONTEXT & CULTURAL INTELLIGENCE:')) return ''

  if (text.includes('live two-way interpreter') || text.includes('YOUR ONLY JOB IS TO INTERPRET')) {
    return LIVE_CONTEXT_POLICY
  }

  if (text.includes("live speech-to-speech agent speaking to another person on the user's behalf") || text.includes("USER'S GOAL / BRIEF:")) {
    return TALK_CONTEXT_POLICY
  }

  return TRANSLATION_CONTEXT_POLICY
}

function augmentTranslateFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url
  if (!url || !url.includes('/api/translate') || String(init?.method || 'GET').toUpperCase() !== 'POST' || typeof init?.body !== 'string') {
    return { input, init }
  }

  try {
    let body = JSON.parse(init.body)
    body = minimiseSensitiveDebriefRequest(body)
    const policy = policyForInstructions(body.instructions)
    if (policy) body.instructions = `${clean(body.instructions)}${policy}`.trim()
    return { input, init: { ...init, body: JSON.stringify(body) } }
  } catch {
    return { input, init }
  }
}

function augmentRealtimeEvent(data) {
  if (typeof data !== 'string') return data

  try {
    const event = JSON.parse(data)
    if (event?.type !== 'session.update' || !event?.session?.instructions) return data
    const policy = policyForInstructions(event.session.instructions)
    const privacy = privacyRealtimePolicy(event.session.instructions)
    if (!policy && !privacy) return data
    const additions = [policy && policy !== TRANSLATION_CONTEXT_POLICY ? policy : '', privacy].filter(Boolean).join('')
    if (!additions) return data
    event.session.instructions = `${clean(event.session.instructions)}${additions}`.trim()
    return JSON.stringify(event)
  } catch {
    return data
  }
}

export function installContextualIntelligence() {
  if (installed || typeof window === 'undefined') return
  installed = true

  if (window.fetch) {
    nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const next = augmentTranslateFetch(input, init)
      return nativeFetch(next.input, next.init)
    }
  }

  const proto = window.RTCDataChannel?.prototype
  if (proto?.send) {
    nativeRtcSend = proto.send
    proto.send = function sendWithAnaContext(data) {
      return nativeRtcSend.call(this, augmentRealtimeEvent(data))
    }
  }
}
