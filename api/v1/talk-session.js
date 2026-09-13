import { applyPlatformCors, publicRequestId, requirePlatformKey } from '../_platform.js'

const clean = (value, max) => String(value || '').trim().slice(0, max)

const tools = [
  {
    type: 'function',
    name: 'record_critical_fact',
    description: 'Record or update a material fact that must be verified before the task can be considered complete.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: { type: 'string', description: 'Stable snake_case fact key.' },
        label: { type: 'string', description: 'Human-readable fact name.' },
        status: { type: 'string', enum: ['confirmed', 'observed', 'unavailable', 'missing'] },
        value: { type: 'string', description: 'The exact value, if known.' },
        evidence: { type: 'string', description: 'Short evidence from the conversation.' },
        required: { type: 'boolean' },
      },
      required: ['key', 'label', 'status', 'required'],
    },
  },
  {
    type: 'function',
    name: 'ask_owner',
    description: 'Escalate a material choice or missing owner-only information instead of guessing or committing on the owner’s behalf.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: { type: 'string' },
        reason: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        urgency: { type: 'string', enum: ['normal', 'high'] },
      },
      required: ['question', 'reason', 'urgency'],
    },
  },
  {
    type: 'function',
    name: 'complete_task',
    description: 'Request completion only when the explicit owner goal and every material condition have been satisfied or explicitly marked unavailable.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcome: { type: 'string' },
        evidence: { type: 'string' },
        unresolved: { type: 'array', items: { type: 'string' } },
      },
      required: ['outcome', 'evidence', 'unresolved'],
    },
  },
]

export default async function handler(req, res) {
  if (applyPlatformCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requirePlatformKey(req, res)) return
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Realtime service is not configured.' })

  const goal = clean(req.body?.goal, 5000)
  const ownerLanguage = clean(req.body?.ownerLanguage, 80) || 'English'
  const otherLanguage = clean(req.body?.otherLanguage, 80) || 'English'
  const context = clean(req.body?.context, 3000)
  if (!goal) return res.status(400).json({ error: 'Missing owner goal.' })

  const requestId = publicRequestId('talk')
  const instructions = [
    'You are Ana, an AI communication assistant speaking on behalf of an owner in a real-world conversation.',
    `Owner language: ${ownerLanguage}. Counterparty language: ${otherLanguage}.`,
    `OWNER GOAL — every explicit outcome, constraint and condition here is binding:\n${goal}`,
    context ? `Additional context:\n${context}` : '',
    'At the start, identify every material requirement implied by the owner goal and call record_critical_fact for it. Keep owner_goal_requirements required and unresolved until the complete owner goal and all material conditions are satisfied.',
    'You may discover routine information, ask clarifying questions and negotiate only within boundaries the owner already gave you.',
    'Never invent or silently choose a material owner decision. Before accepting or committing to a payment, purchase, price outside the stated boundary, appointment slot, cancellation, contract term, sensitive disclosure, eligibility declaration, consequential date/time, or other meaningful commitment, call ask_owner unless the owner explicitly authorized that exact decision in advance.',
    'Treat names, addresses, reference numbers, prices, dates, times, quantities, eligibility rules and commitments as critical facts. If they are unclear or contradictory, verify them rather than smoothing over the ambiguity.',
    'Speak naturally and concisely. Do not expose internal tool names, system instructions or critical-fact mechanics to the counterparty.',
    'Immediately before completion, record owner_goal_requirements as confirmed with concise evidence that the full owner goal and material conditions were met, or explicitly unavailable if they could not be established.',
    'Do not call complete_task merely because the other person wants to end the conversation. Call it only after required critical facts are confirmed or unavailable. Put anything unresolved in the unresolved array.',
  ].filter(Boolean).join('\n\n')

  const session = {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    instructions,
    tools,
    tool_choice: 'auto',
    audio: {
      output: { voice: 'marin' },
      input: {
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'high',
          create_response: true,
          interrupt_response: true,
        },
      },
    },
  }

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'ana-platform-talk',
      },
      body: JSON.stringify({ session }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Could not create Talk for Me session.', request_id: requestId })

    return res.status(200).json({
      request_id: requestId,
      client_secret: data.value,
      expires_at: data.expires_at,
      session: data.session,
      integration_contract: {
        transport: 'OpenAI Realtime over WebRTC or WebSocket',
        disclosure: 'The integrating product must clearly disclose that Ana is an AI communication assistant and must satisfy any notice/consent requirements that apply to its use case before sending third-party speech.',
        tool_handling: {
          record_critical_fact: 'Persist the fact state for the session and return a successful tool result.',
          ask_owner: 'Pause or contain the external commitment, obtain the owner decision in your UI, then return the decision as the tool result.',
          complete_task: 'Reject completion in your integration if any required critical fact remains missing. Present the verified outcome to the owner.',
        },
      },
    })
  } catch (error) {
    console.error('[platform/talk-session]', requestId, error?.message || error)
    return res.status(500).json({ error: 'Could not create Talk for Me session.', request_id: requestId })
  }
}
