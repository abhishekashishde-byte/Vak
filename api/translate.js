import { domainPrompt, publicDomain, resolveDomain } from '../server/domain.js'
import { validateDocumentUsage } from '../server/usageQuota.js'
import { logAiUsage } from '../server/aiUsage.js'

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
  return { content: collectText(data), usage: data?.usage || {}, responseId: data?.id || '' }
}

function cleanGifUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') ? value : ''
}

function normalizeGifV2(payload) {
  const source = Array.isArray(payload?.results) ? payload.results : []
  return source.slice(0, 24).map(item => {
    const formats = item?.media_formats || {}
    const preview = cleanGifUrl(formats?.tinygif?.url) || cleanGifUrl(formats?.mediumgif?.url) || cleanGifUrl(formats?.gif?.url)
    const share = cleanGifUrl(formats?.gif?.url) || cleanGifUrl(formats?.mediumgif?.url) || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

function normalizeGifV1(payload) {
  const source = Array.isArray(payload?.data?.data) ? payload.data.data : []
  return source.slice(0, 24).map(item => {
    if (item?.type === 'ad') return null
    const file = item?.file || {}
    const gif = size => cleanGifUrl(file?.[size]?.gif?.url)
    const preview = gif('xs') || gif('sm') || gif('md') || gif('hd')
    const share = gif('md') || gif('sm') || gif('hd') || preview
    return preview ? { title: String(item?.title || 'GIF'), preview, share } : null
  }).filter(Boolean)
}

async function fetchGifJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'AnaKeyboard/0.9' },
      signal: controller.signal,
    })
    const text = await response.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = {} }
    if (!response.ok) throw new Error(`KLIPY ${response.status}: ${data?.errors?.message?.[0] || data?.message || text.slice(0, 100)}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function handleGifRequest(req, res) {
  const key = String(process.env.KLIPY_API_KEY || '').trim()
  if (!key) return res.status(503).json({ error: 'GIF provider is not configured', needsProductionKey: true })

  const q = String(req.query?.q || '').trim().slice(0, 80)
  const limit = Math.max(1, Math.min(24, Number(req.query?.limit) || 18))
  const encodedKey = encodeURIComponent(key)
  const encodedQ = encodeURIComponent(q)

  try {
    const v2 = q
      ? `https://api.klipy.com/v2/search?key=${encodedKey}&q=${encodedQ}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
      : `https://api.klipy.com/v2/featured?key=${encodedKey}&searchfilter=gif&locale=en_US&contentfilter=medium&media_filter=gif,tinygif&limit=${limit}`
    const data = await fetchGifJson(v2)
    const results = normalizeGifV2(data)
    if (results.length) {
      res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json({ provider: 'klipy', results })
    }
  } catch (firstError) {
    try {
      const action = q ? 'search' : 'trending'
      const v1 = `https://api.klipy.com/api/v1/${encodedKey}/gifs/${action}?page=1&per_page=${limit}&customer_id=ana-keyboard&locale=en_US${q ? `&q=${encodedQ}` : ''}`
      const data = await fetchGifJson(v1)
      const results = normalizeGifV1(data)
      if (results.length) {
        res.setHeader('Cache-Control', q ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=3600, stale-while-revalidate=86400')
        return res.status(200).json({ provider: 'klipy', results })
      }
    } catch (secondError) {
      return res.status(503).json({
        error: 'GIF provider unavailable',
        detail: String(secondError?.message || firstError?.message || '').slice(0, 160),
      })
    }
  }

  return res.status(200).json({ provider: 'klipy', results: [] })
}

export default async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.mode || '') === 'gifs') {
    return handleGifRequest(req, res)
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text, instructions } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const rawInstructions = instructions || 'You are Ana, a precise and natural translation assistant.'
  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")
  const isTalkDebrief = rawInstructions.includes('reviewing a live real-world conversation after speaking for the user')
  const isTalkTurn = !isTalkDebrief && (rawInstructions.includes('live real-world conversation') || rawInstructions.includes('speaking for the user'))
  const isAnaTranslation = rawInstructions.includes('premium translation engine')
  const isWriteForMe = rawInstructions.includes('Ana Write for me')
  const isWordRefinement = rawInstructions.includes('bilingual editor refining a translation')
  const isLanguageDetection = rawInstructions.includes("Ana's language detector")
  const isKeyboardSentenceCorrection = rawInstructions.includes('Smart Sentence Correction') || rawInstructions.includes('Smart Paragraph Correction')
  const isMeetingNotes = rawInstructions.includes('ANA_MEETING_NOTES')
  const isMeetingEnrichment = rawInstructions.includes('ANA_MEETING_ENRICHMENT')
  const isMeetingQa = rawInstructions.includes('ANA_MEETING_QA')
  const isMeetingOutput = rawInstructions.includes('ANA_MEETING_OUTPUT')
  const isMeetingIntelligence = isMeetingNotes || isMeetingEnrichment || isMeetingQa || isMeetingOutput
  const isDocumentTranslation = rawInstructions.includes('positioned PDF text blocks')
    || rawInstructions.includes('translation guide for a PDF')
    || rawInstructions.includes('layout-rescue pass on a translated PDF')
    || rawInstructions.includes('formatting-preserving text segments from a Microsoft Word document')
    || rawInstructions.includes('translation guide for a Word document')
  const isVisualTranslation = rawInstructions.includes('visible text from a real-world image')
  const isVisualOrDocumentTranslation = isVisualTranslation || isDocumentTranslation
  const isStructuredLayoutRequest = rawInstructions.includes('LAYOUT IS BINDING.')
  const preserveLayout = isAnaTranslation && !isStructuredLayoutRequest && /[\r\n]/.test(text)

  const domainResolution = (isLanguageDetection || isKeyboardSentenceCorrection)
    ? resolveDomain('', { mode: 'general' })
    : resolveDomain(text, req.body?.domain)
  const domainInstructions = (isLanguageDetection || isKeyboardSentenceCorrection) ? '' : domainPrompt(domainResolution)

  const model = isTalkTurn || isAnaTranslation || isVisualOrDocumentTranslation ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
  const reasoningEffort = (isAnaTranslation || isKeyboardSentenceCorrection || isWriteForMe) ? 'none' : (isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief || isMeetingIntelligence ? 'low' : 'medium')
  const deadlineMs = isKeyboardSentenceCorrection ? 6500 : isWordRefinement ? 6000 : isLanguageDetection ? 6500 : isAnaBriefing ? 7000 : isTalkDebrief ? 8000 : isTalkTurn ? 15000 : isWriteForMe ? 14000 : isAnaTranslation ? 22000 : isMeetingIntelligence ? 18000 : isVisualOrDocumentTranslation ? 24000 : 20000

  const usageFeature = isMeetingNotes ? 'meeting_notes'
    : isMeetingEnrichment ? 'meeting_enrichment'
      : isMeetingQa ? 'meeting_qa'
        : isMeetingOutput ? 'meeting_output'
          : isDocumentTranslation ? 'document_translation'
            : isVisualTranslation ? 'camera_translation'
              : isKeyboardSentenceCorrection ? 'keyboard_correction'
                : isWordRefinement ? 'word_refinement'
                  : isLanguageDetection ? 'language_detection'
                    : isWriteForMe ? 'write_for_me'
                      : isAnaBriefing ? 'talk_briefing'
                      : isTalkDebrief ? 'talk_debrief'
                        : isTalkTurn ? 'talk_turn'
                          : isAnaTranslation ? 'translation'
                            : 'general'

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

  if (isDocumentTranslation) {
    const quota = await validateDocumentUsage(req, req.body?.quotaUsageId)
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error })
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
    if (isKeyboardSentenceCorrection) body.max_output_tokens = 420
    if (isWriteForMe) body.max_output_tokens = 1200
    if (isAnaTranslation || isVisualOrDocumentTranslation) body.max_output_tokens = Math.max(1200, Math.min(6000, Math.ceil(String(text).length * 1.6)))

    let result = await callResponses(body, controller.signal)
    await logAiUsage(req, { feature: usageFeature, model, usage: result.usage, metadata: { responseId: result.responseId } })
    let content = result.content
    if (!content) return res.status(502).json({ error: 'Model returned no text' })

    if (isWordRefinement && !validRefinementPayload(content)) {
      result = await callResponses({
        ...body,
        instructions: `${finalInstructions}\n\nRETRY REQUIREMENT: Return valid JSON only and make sourceTerm non-empty. Do not omit sourceTerm under any circumstance.`,
      }, controller.signal)
      await logAiUsage(req, { feature: usageFeature, model, usage: result.usage, metadata: { responseId: result.responseId, retry: true } })
      content = result.content
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
