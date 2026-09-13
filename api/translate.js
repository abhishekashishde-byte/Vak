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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text, instructions } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const rawInstructions = instructions || 'You are Ana, a precise and natural translation assistant.'
  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")
  const isTalkDebrief = rawInstructions.includes('reviewing a live real-world conversation after speaking for the user')
  const isTalkTurn = !isTalkDebrief && (rawInstructions.includes('live real-world conversation') || rawInstructions.includes('speaking for the user'))

  // Interactive briefing must be fast. The heavier reasoning model is reserved for
  // places where the user is not blocked waiting for Ana to produce the next screen.
  const model = (isAnaBriefing || isTalkDebrief) ? 'gpt-5.6-luna' : isTalkTurn ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
  const reasoningEffort = (isAnaBriefing || isTalkDebrief) ? 'low' : isTalkTurn ? 'medium' : 'medium'
  const deadlineMs = isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : 20000

  let finalInstructions = rawInstructions
  if (isAnaBriefing) finalInstructions += BRIEFING_PROTOCOL
  if (isTalkTurn) finalInstructions += TALK_COMPLETION_PROTOCOL

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)

  try {
    const body = {
      model,
      instructions: finalInstructions,
      input: text,
      reasoning: { effort: reasoningEffort },
    }
    if (isAnaBriefing) body.max_output_tokens = 900
    if (isTalkDebrief) body.max_output_tokens = 700

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'OpenAI request failed' })
    }

    const content = collectText(data)
    if (!content) return res.status(502).json({ error: 'Model returned no text' })
    return res.status(200).json({ content, model })
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(503).json({ error: isAnaBriefing ? 'Ana took too long to prepare this conversation. Please try once more.' : 'Ana took too long to respond. Please try again.' })
    }
    return res.status(500).json({ error: error?.message || 'Request failed' })
  } finally {
    clearTimeout(timer)
  }
}
