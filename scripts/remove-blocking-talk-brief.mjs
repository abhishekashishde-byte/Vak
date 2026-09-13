import fs from 'node:fs'

const talkPath = 'src/TalkForMeRealtime.jsx'
let talk = fs.readFileSync(talkPath, 'utf8')

const start = talk.indexOf('  const sendBrief = async () => {')
const end = talk.indexOf('\n  const stopMeter = () => {', start)
if (start < 0 || end < 0) throw new Error('sendBrief block not found')

const replacement = `  const sendBrief = () => {
    const text = briefInput.trim()
    if (!text || briefLoading) return

    const next = [...briefing, { role: 'user', text }]
    setBriefing(next)
    setBriefInput('')
    setBriefLoading(false)
    setError('')

    // Talk for Me must never block the owner on a separate reasoning call.
    // The owner's own words become the operational brief immediately. The
    // Realtime agent discovers routine facts live and the deterministic
    // completion gate still prevents the task from closing prematurely.
    const userBrief = next
      .filter(message => message.role === 'user')
      .map(message => String(message.text || '').trim())
      .filter(Boolean)
      .join('\\n')

    setContextSummary(userBrief || text)
    setKnownFacts([])
    replaceCriticalFacts([{
      key: 'owner_goal_requirements',
      label: "Owner's requested outcome and conditions",
      required: true,
      risk: 'high',
      status: 'missing',
      value: '',
      evidence: '',
      reason: 'Ana must verify that the explicit owner goal and every material condition are satisfied before closing.',
    }])

    setBriefing(prev => [...prev, { role: 'ana', text: 'I have enough context. I’m ready to take it from here.' }])
    setStage('ready')
  }
`

talk = talk.slice(0, start) + replacement + talk.slice(end)

const criticalAnchor = `CRITICAL FACT VERIFICATION — mandatory:\n- Maintain the checklist above as structured evidence, not just as memory in prose.`
const criticalReplacement = `CRITICAL FACT VERIFICATION — mandatory:\n- Treat every explicit outcome, constraint and condition in USER'S GOAL / BRIEF as binding. The owner must not have to repeat it.\n- At the beginning of the live task, identify the material requirements in the brief and create/update structured critical facts for them as they become relevant. If the conversation reveals a new material dependency, rule or condition, create a required critical fact for that too.\n- The synthetic owner_goal_requirements fact is always required. Keep it unresolved until the requested outcome and every material owner condition have actually been satisfied or explicitly established as unavailable. Immediately before completing, record owner_goal_requirements as confirmed with concise evidence of why the owner's goal is satisfied. Never confirm it merely because the other person ended the conversation.\n- Maintain the checklist above as structured evidence, not just as memory in prose.`
if (!talk.includes(criticalAnchor)) throw new Error('critical verification anchor not found')
talk = talk.replace(criticalAnchor, criticalReplacement)

fs.writeFileSync(talkPath, talk)

const apiPath = 'api/translate.js'
let api = fs.readFileSync(apiPath, 'utf8')
api = api.replace(
  `  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")\n  const isTalkTurn = rawInstructions.includes('live real-world conversation') || rawInstructions.includes('speaking for the user')`,
  `  const isAnaBriefing = rawInstructions.includes("preparing to speak on a user's behalf")\n  const isTalkDebrief = rawInstructions.includes('reviewing a live real-world conversation after speaking for the user')\n  const isTalkTurn = !isTalkDebrief && (rawInstructions.includes('live real-world conversation') || rawInstructions.includes('speaking for the user'))`
)
api = api.replace(
  `  const model = isAnaBriefing ? 'gpt-5.6-luna' : isTalkTurn ? 'gpt-5.6-sol' : 'gpt-5.6-luna'\n  const reasoningEffort = isAnaBriefing ? 'low' : isTalkTurn ? 'medium' : 'medium'\n  const deadlineMs = isAnaBriefing ? 5500 : isTalkTurn ? 15000 : 20000`,
  `  const model = (isAnaBriefing || isTalkDebrief) ? 'gpt-5.6-luna' : isTalkTurn ? 'gpt-5.6-sol' : 'gpt-5.6-luna'\n  const reasoningEffort = (isAnaBriefing || isTalkDebrief) ? 'low' : isTalkTurn ? 'medium' : 'medium'\n  const deadlineMs = isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : 20000`
)
api = api.replace(
  `    if (isAnaBriefing) body.max_output_tokens = 900`,
  `    if (isAnaBriefing) body.max_output_tokens = 900\n    if (isTalkDebrief) body.max_output_tokens = 700`
)
fs.writeFileSync(apiPath, api)
