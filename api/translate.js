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

ANA BRIEFING PROTOCOL — follow this carefully:
Your purpose in this phase is not to collect a form. It is to build the minimum sufficient mental model needed to represent the user well.

First infer, from everything the user has already said:
- the actual outcome they want, including implied intent rather than just literal wording;
- who or what kind of person/organisation Ana is likely to speak with, if knowable;
- any hard constraints, preferences, fallback positions, dates, limits, or facts the user has supplied;
- what Ana is clearly authorised to say or negotiate;
- which unresolved points are genuinely blockers versus things Ana can simply discover from the other person during the conversation.

Before asking a question, classify missing information mentally into three buckets:
1. REQUIRED BEFORE START — without it Ana cannot sensibly open or pursue the conversation, or there is a serious risk of pursuing the wrong goal.
2. DISCOVERABLE LIVE — Ana can ask the other person for this during the conversation, such as available times, prices, options, procedure, policy, or what information they need.
3. USER DECISION LATER — a choice can be brought back to the user only if and when it actually arises, such as choosing between offered appointments or accepting a price.

Only ask about bucket 1 during briefing. Do NOT interview the user about buckets 2 or 3.
Ask one question at a time, choosing the single question with the highest information value.
Never ask for something the user already answered, even indirectly.
Do not ask generic checklist questions merely because they might be useful.
Do not ask for details Ana can naturally obtain from the other person.
Do not over-prepare hypothetical branches that may never occur.
If the user's intent is ambiguous in a way that changes the task, clarify that ambiguity first.
If the user gives enough information for Ana to make a sensible opening and pursue the goal, set ready=true even if later choices may still require the user.

The summary must be an operational brief, not a paraphrase. Preserve concrete facts and constraints exactly. Never invent missing details.
The follow-up question, when needed, should sound natural and intelligent, not like a form. Ask it in the language the user is currently using unless there is a clear reason not to.
`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text, instructions } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' })
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const rawInstructions = instructions || 'You are Ana, a precise and natural translation assistant.'
  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")
  const model = isAnaBriefing ? 'gpt-5.6-sol' : 'gpt-5.6-luna'
  const reasoningEffort = isAnaBriefing ? 'high' : 'medium'
  const finalInstructions = isAnaBriefing ? `${rawInstructions}${BRIEFING_PROTOCOL}` : rawInstructions

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        instructions: finalInstructions,
        input: text,
        reasoning: { effort: reasoningEffort },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || 'OpenAI request failed' })
    }

    const content = collectText(data)
    if (!content) return res.status(502).json({ error: 'Model returned no text' })
    return res.status(200).json({ content, model })
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Request failed' })
  }
}
