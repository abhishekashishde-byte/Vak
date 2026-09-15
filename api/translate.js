import { domainPrompt, publicDomain, resolveDomain } from './_domain.js'

function collectText(data) {
  return (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

const BRIEFING_PROTOCOL = `

ANA BRIEFING PROTOCOL:
- Build only the minimum operational brief Ana needs to start safely.
- Infer the user's real outcome, supplied constraints and what Ana may discover from the other person.
- Ask only one genuinely blocking question if the task cannot sensibly start without it.
- Do not ask the user for prices, availability, procedures, rules or options Ana can discover live.
- Create a short critical-fact checklist only for facts material to this exact goal.
- Never invent missing facts.
- If the goal is clear enough to pursue, set ready=true even if later owner decisions may be needed.
- Return concise valid JSON only.`

const TALK_COMPLETION_PROTOCOL = `

ANA TASK-COMPLETION PROTOCOL — this overrides any tendency to keep chatting:
Treat the user's brief as a concrete task with a finish line, NOT as an open-ended conversation.

Before every reply, maintain a compact internal completion checklist: what facts, confirmations, choices, or actions are still required for the owner to understand the outcome and act on it afterwards.
Ask or say ONLY what is necessary to complete that checklist.

Be aggressively concise:
- do not make small talk;
- do not ask optional, curiosity-driven, or "anything else" questions;
- do not repeat information already established;
- do not explore adjacent topics unless they are required to complete the user's stated goal;
- do not keep the other person engaged merely because they are still willing to talk.

However, concise does NOT mean superficial. Ana must understand the result well enough to explain it back to the owner precisely.
When the other person gives a result that is incomplete, aggregated, ambiguous, or difficult to explain, ask the smallest useful follow-up question directly to THEM before closing.

Facts that can be discovered from the other person should be discovered from the other person. Do NOT interrupt the owner for those. Only return to the owner for an actual decision, authorization, sensitive fact, payment/price acceptance, appointment choice, commitment, or other material choice.
If numerical components are supplied, sanity-check that they reconcile with the stated total. If they do not, clarify once rather than silently accepting an inconsistency.

The moment the user's goal is satisfied AND the result is sufficiently clear to hand back, stop the task immediately.
If a material owner decision is still needed — payment, price acceptance, appointment choice, commitment, sensitive information, terms, or another consequential choice — ask the owner and do not falsely mark the task complete.`

const LINE_BREAK_TOKEN = '⟦ANA_LINE_BREAK⟧'

function encodeTranslationLayout(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n/g, ` ${LINE_BREAK_TOKEN} `)
}

function restoreTranslationLayout(text) {
  return String(text)
    .replace(new RegExp(`\\s*${LINE_BREAK_TOKEN}\\s*`, 'g'), '\n')
    .trim()
}

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}

function validRefinementPayload(text) {
  const parsed = parseJson(text)
  return Boolean(
    parsed &&
    typeof parsed.sourceTerm === 'string' && parsed.sourceTerm.trim() &&
    Array.isArray(parsed.alternatives)
  )
}

async function callResponses(body, signal) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'OpenAI request failed')
    error.status = response.status
    throw error
  }
  return collectText(data)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text, instructions } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const rawInstructions = instructions || 'You are Ana, a precise and natural translation assistant.'
  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")
  const isTalkDebrief = rawInstructions.includes('reviewing a live real-world conversation after speaking for the user')
  const isTalkTurn = !isTalkDebrief && (rawInstructions.includes('live real-world conversation') || rawInstructions.includes('speaking for the user'))
  const isAnaTranslation = rawInstructions.includes('premium translation engine')
  const isWordRefinement = rawInstructions.includes('bilingual editor refining a translation')
  const isLanguageDetection = rawInstructions.includes("Ana's language detector")
  const isMeetingNotes = rawInstructions.includes('ANA_MEETING_NOTES')
  const isMeetingEnrichment = rawInstructions.includes('ANA_MEETING_ENRICHMENT')
  const isMeetingQa = rawInstructions.includes('ANA_MEETING_QA')
  const isMeetingOutput = rawInstructions.includes('ANA_MEETING_OUTPUT')
  const isMeetingIntelligence = isMeetingNotes || isMeetingEnrichment || isMeetingQa || isMeetingOutput
  const isVisualOrDocumentTranslation = rawInstructions.includes('visible text from a real-world image') || rawInstructions.includes('positioned PDF text blocks') || rawInstructions.includes('translation guide for a PDF') || rawInstructions.includes('layout-rescue pass on a translated PDF')
  const isStructuredLayoutRequest = rawInstructions.includes('LAYOUT IS BINDING.')
  const preserveLayout = isAnaTranslation && !isStructuredLayoutRequest && /[\r\n]/.test(text)

  const domainResolution = isLanguageDetection
    ? resolveDomain('', { mode: 'general' })
    : resolveDomain(text, req.body?.domain)
  const domainInstructions = isLanguageDetection ? '' : domainPrompt(domainResolution)

  const model = isTalkTurn || isAnaTranslation || isVisualOrDocumentTranslation ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
  const reasoningEffort = isAnaTranslation ? 'none' : (isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief || isMeetingIntelligence ? 'low' : 'medium')
  const deadlineMs = isWordRefinement ? 6000 : isLanguageDetection ? 4500 : isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : isAnaTranslation ? 22000 : isMeetingIntelligence ? 18000 : isVisualOrDocumentTranslation ? 24000 : 20000

  let finalInstructions = rawInstructions
  if (domainInstructions) finalInstructions += `\n\n${domainInstructions}`
  if (isAnaBriefing) finalInstructions += BRIEFING_PROTOCOL
  if (isTalkTurn) finalInstructions += TALK_COMPLETION_PROTOCOL
  if (isWordRefinement) {
    finalInstructions += `\n\nGLOSSARY MAPPING — mandatory:\nThe JSON field sourceTerm MUST be a non-empty exact source-language word or shortest source phrase from SOURCE TEXT that corresponds to SELECTED TARGET WORD. Never return an empty sourceTerm. This mapping is required because the user may save the alternative as an Always preference.`
  }
  if (preserveLayout) {
    finalInstructions += `\n\nLAYOUT PRESERVATION — mandatory:\nThe input contains ${LINE_BREAK_TOKEN} markers representing line breaks typed by the user. Copy EVERY marker exactly, in the same order, between the corresponding translated passages. Never remove, add, translate, combine, or move these markers. Preserve blank lines by preserving consecutive markers.`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)

  try {
    const body = {
      model,
      instructions: finalInstructions,
      input: preserveLayout ? encodeTranslationLayout(text) : text,
      reasoning: { effort: reasoningEffort },
    }
    if (isAnaBriefing) body.max_output_tokens = 900
    if (isTalkDebrief) body.max_output_tokens = 700
    if (isLanguageDetection) body.max_output_tokens = 90
    if (isWordRefinement) body.max_output_tokens = 280
    if (isMeetingNotes) body.max_output_tokens = 2200
    if (isMeetingEnrichment) body.max_output_tokens = 3400
    if (isMeetingQa) body.max_output_tokens = 1000
    if (isMeetingOutput) body.max_output_tokens = 1800
    if (isAnaTranslation || isVisualOrDocumentTranslation) body.max_output_tokens = Math.max(1200, Math.min(6000, Math.ceil(String(text).length * 1.6)))

    let content = await callResponses(body, controller.signal)
    if (!content) return res.status(502).json({ error: 'Model returned no text' })

    if (isWordRefinement && !validRefinementPayload(content)) {
      content = await callResponses({
        ...body,
        instructions: `${finalInstructions}\n\nRETRY REQUIREMENT: Return valid JSON only and make sourceTerm non-empty. Do not omit sourceTerm under any circumstance.`,
      }, controller.signal)
      if (!validRefinementPayload(content)) {
        return res.status(502).json({ error: 'Ana could not identify the source term for this glossary preference. Please tap the word again.' })
      }
    }

    if (preserveLayout) content = restoreTranslationLayout(content)
    return res.status(200).json({ content, model, domain: publicDomain(domainResolution) })
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(503).json({ error: isAnaBriefing ? 'Ana took too long to prepare this conversation. Please try once more.' : 'Ana took too long to respond. Please try again.' })
    }
    if (error?.status) return res.status(error.status).json({ error: error.message || 'OpenAI request failed' })
    return res.status(500).json({ error: error?.message || 'Request failed' })
  } finally {
    clearTimeout(timer)
  }
}
