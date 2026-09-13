import { getPrivacySettings } from './accountPreferences.js'

const SENSITIVE_PATTERN = /(doctor|clinic|hospital|medical|health|arzt|klinik|krankenhaus|buergeramt|behorde|authority|government|bank|insurance|versicherung|legal|contract|vertrag|school|schule|appointment|termin|passport|ausweis)/i

export const DISCLOSURE_COPY = {
  English: 'Ana is helping with this conversation. Speech is processed in real time by an AI service. Please continue only if you are comfortable with that.',
  German: 'Ana hilft bei diesem Gespraech. Sprache wird in Echtzeit von einem KI-Dienst verarbeitet. Bitte fahren Sie nur fort, wenn das fuer Sie in Ordnung ist.',
  French: 'Ana aide dans cette conversation. La parole est traitee en temps reel par un service IA. Continuez uniquement si cela vous convient.',
  Spanish: 'Ana esta ayudando con esta conversacion. La voz se procesa en tiempo real mediante un servicio de IA. Continue solo si se siente comodo con ello.',
  Italian: 'Ana sta aiutando in questa conversazione. La voce viene elaborata in tempo reale da un servizio di IA. Continui solo se si sente a suo agio.',
}

export function isSensitiveConversation(text = '') {
  return SENSITIVE_PATTERN.test(String(text || ''))
}

export function shouldRequireDisclosure(context = '') {
  const settings = getPrivacySettings()
  if (settings.disclosureMode === 'always') return true
  return isSensitiveConversation(context)
}

export function isExtraPrivacyConversation(context = '') {
  const settings = getPrivacySettings()
  return settings.extraPrivacySensitive !== false && isSensitiveConversation(context)
}

export function privacyRealtimePolicy(instructions = '') {
  const text = String(instructions || '')
  const isTalk = text.includes("live speech-to-speech agent speaking to another person on the user's behalf") || text.includes("USER'S GOAL / BRIEF:")
  if (!isTalk) return ''

  const briefMatch = text.match(/USER'S GOAL \/ BRIEF:\s*([\s\S]*?)(?:\n\nKNOWN FACTS:|\n\nCRITICAL FACT)/i)
  const context = briefMatch?.[1] || text
  const settings = getPrivacySettings()
  const extraPrivacy = settings.extraPrivacySensitive !== false && isSensitiveConversation(context)

  return `\n\nPRIVACY & TRANSPARENCY:\n- The owner is shown a privacy disclosure before the microphone starts.\n- If the other person asks what Ana is doing, explain briefly that Ana is an AI communication assistant and speech is processed in real time by an AI service to help with this conversation.\n- Never claim that continuing creates legal consent.\n- If the other person objects to AI processing or asks to stop, stop pursuing the task and call ask_owner so the owner can decide how to proceed.\n- Do not add conversation content to personal language memory. Personal memory is only for language preferences, terminology and communication settings.${extraPrivacy ? '\n- EXTRA PRIVACY MODE applies here: minimise repetition of sensitive details and use them only when needed for accuracy or task completion.' : ''}`
}

export function minimiseSensitiveDebriefRequest(body) {
  if (!body || typeof body !== 'object' || typeof body.text !== 'string') return body
  if (!body.text.includes("OWNER'S ORIGINAL GOAL:") || !body.text.includes('CONVERSATION TRANSCRIPT:')) return body

  const goalMatch = body.text.match(/OWNER'S ORIGINAL GOAL:\s*([\s\S]*?)(?:\n\nSTRUCTURED CRITICAL FACTS:)/i)
  const goal = goalMatch?.[1] || ''
  if (!isExtraPrivacyConversation(goal)) return body

  const next = { ...body }
  next.text = body.text.replace(
    /(CONVERSATION TRANSCRIPT:\s*)[\s\S]*?(\n\nThe conversation\s)/i,
    '$1(Omitted by Ana extra privacy mode. Use the structured confirmed facts above.)$2',
  )
  return next
}
