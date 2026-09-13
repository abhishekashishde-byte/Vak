import fs from 'node:fs'

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from)
  if (first < 0) throw new Error(`Missing anchor: ${label}`)
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`Anchor is not unique: ${label}`)
  return text.slice(0, first) + to + text.slice(first + from.length)
}

const talkPath = 'src/TalkForMeRealtime.jsx'
let talk = fs.readFileSync(talkPath, 'utf8')

talk = replaceOnce(talk,
  "import { ArrowRight, Check, Languages, ListChecks, Mic, Pause, Send, ShieldCheck, Sparkles, UserRound } from 'lucide-react'\n",
  "import { ArrowRight, Check, Languages, ListChecks, Mic, Pause, Send, ShieldCheck, Sparkles, UserRound } from 'lucide-react'\nimport { createTalkPermissionSession, getTalkDisclosure, recordTalkPermissionOutcome } from './talkConsent.js'\n",
  'Talk consent import')

talk = replaceOnce(talk, "  const [error, setError] = useState('')\n", "  const [error, setError] = useState('')\n  const [permissionState, setPermissionState] = useState('idle')\n", 'permission state')
talk = replaceOnce(talk, "  const finishingRef = useRef(false)\n", "  const finishingRef = useRef(false)\n  const permissionStateRef = useRef('idle')\n  const permissionSessionRef = useRef(null)\n  const permissionDisclosureResponseRef = useRef(null)\n", 'permission refs')

talk = replaceOnce(talk,
`  const sendRealtime = event => {
    const dc = dataChannelRef.current
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event))
  }

`,
`  const sendRealtime = event => {
    const dc = dataChannelRef.current
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event))
  }

  const setPermission = value => {
    permissionStateRef.current = value
    setPermissionState(value)
  }

  const permissionInstructions = () => \`You are Ana's mandatory counterparty permission gate. You are NOT allowed to start, reveal, discuss or pursue the owner's task yet. The app will give you a fixed disclosure sentence to speak. Speak that disclosure faithfully, then listen for the other person's response in \${otherLanguage}. Silence is never permission. If the response clearly agrees, call record_counterparty_permission with decision=accepted. If it clearly refuses or objects to AI processing, call it with decision=declined. If the answer is genuinely unclear, ask only one short clarification about whether they agree to continue with AI assistance. Do not ask any task-related question. Do not infer agreement from politeness, continued presence or unrelated speech.\`

  const beginTaskAfterPermission = callId => {
    setPermission('accepted')
    recordTalkPermissionOutcome(permissionSessionRef.current, 'accepted')
    sendRealtime({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify({ accepted: true }) } })
    lastOtherRef.current = ''
    latestAnaRef.current = ''
    setLatestOther('')
    setLatestAna('')
    setInterim('')
    sendRealtime({ type: 'session.update', session: { instructions: realtimeInstructions(), tool_choice: 'auto' } })
    sendRealtime({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: \`Permission has been accepted. Begin the user's real task now in \${otherLanguage}. Do not repeat the AI disclosure. Open naturally, work toward the user's goal, keep the critical-fact completion checklist current through the tools, and finish as soon as the verified goal is achieved.\` }],
      },
    })
    openingRef.current = true
    sendRealtime({ type: 'response.create' })
    setSessionState('thinking')
  }

  const handleCounterpartyPermissionTool = item => {
    if (!item?.call_id) return
    let args = {}
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    const decision = ['accepted', 'declined', 'withdrawn'].includes(args.decision) ? args.decision : 'declined'
    if (decision === 'accepted' && permissionStateRef.current !== 'accepted') {
      beginTaskAfterPermission(item.call_id)
      return
    }
    recordTalkPermissionOutcome(permissionSessionRef.current, decision)
    sendRealtime({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ accepted: false, decision }) } })
    setPermission(decision === 'withdrawn' ? 'withdrawn' : 'declined')
    setMicEnabled(false)
    setError(decision === 'withdrawn' ? 'The other person withdrew permission. Ana stopped immediately.' : 'The other person did not agree to AI-assisted processing. Ana stopped before starting the task.')
    endRealtime(true)
  }

`, 'permission helpers')

talk = replaceOnce(talk, "          instructions: realtimeInstructions(),\n", "          instructions: permissionInstructions(),\n", 'initial permission instructions')
talk = replaceOnce(talk, "      const micTrack = stream.getAudioTracks()[0]\n      micTrack.enabled = true\n", "      const micTrack = stream.getAudioTracks()[0]\n      micTrack.enabled = false\n", 'mic gated before disclosure')

talk = replaceOnce(talk,
"          tools: [\n            {\n              type: 'function',\n              name: 'ask_owner',",
"          tools: [\n            {\n              type: 'function',\n              name: 'record_counterparty_permission',\n              description: 'Mandatory permission gate. Use accepted only for a clear affirmative response to the AI disclosure. Use declined for a clear refusal or objection before the task. Use withdrawn if the other person later asks Ana or AI processing to stop.',\n              parameters: { type: 'object', properties: { decision: { type: 'string', enum: ['accepted', 'declined', 'withdrawn'] } }, required: ['decision'] },\n            },\n            {\n              type: 'function',\n              name: 'ask_owner',", 'permission tool')

talk = replaceOnce(talk,
"            text: `Begin now. Open the real conversation yourself in ${otherLanguage}, introduce yourself naturally as Ana, and immediately work toward the user's goal. Speak to the other person, not to the owner. Keep the critical-fact completion checklist current through the tools and finish as soon as the verified goal is achieved.`,",
"            text: `Say exactly this fixed disclosure to the other person and nothing about the user's task yet: ${getTalkDisclosure(otherLanguage)}` ,", 'fixed disclosure opening')

talk = replaceOnce(talk, "    awaitingClosingRef.current = false\n    closingResponseRef.current = null\n\n    try {", "    awaitingClosingRef.current = false\n    closingResponseRef.current = null\n    permissionDisclosureResponseRef.current = null\n    permissionSessionRef.current = createTalkPermissionSession(otherLanguage)\n    setPermission('disclosing')\n\n    try {", 'permission session initialization')

talk = replaceOnce(talk, "      case 'response.created':\n        if (awaitingClosingRef.current) {", "      case 'response.created':\n        if (permissionStateRef.current === 'disclosing' && !permissionDisclosureResponseRef.current) {\n          permissionDisclosureResponseRef.current = event.response?.id || null\n        }\n        if (awaitingClosingRef.current) {", 'track disclosure response')

talk = replaceOnce(talk,
"      case 'response.output_item.done':\n        if (event.item?.type === 'function_call') {\n          if (event.item?.name === 'ask_owner') handleOwnerTool(event.item)\n          if (event.item?.name === 'record_critical_fact') handleCriticalFactTool(event.item)\n          if (event.item?.name === 'complete_task') handleCompleteTaskTool(event.item)\n        }\n        break",
"      case 'response.output_item.done':\n        if (event.item?.type === 'function_call') {\n          if (event.item?.name === 'record_counterparty_permission') { handleCounterpartyPermissionTool(event.item); break }\n          if (permissionStateRef.current !== 'accepted') break\n          if (event.item?.name === 'ask_owner') handleOwnerTool(event.item)\n          if (event.item?.name === 'record_critical_fact') handleCriticalFactTool(event.item)\n          if (event.item?.name === 'complete_task') handleCompleteTaskTool(event.item)\n        }\n        break", 'permission tool routing')

talk = replaceOnce(talk,
"        const responseId = event.response?.id || null\n        latestAnaRef.current = ''\n        if (closingResponseRef.current && responseId === closingResponseRef.current) {",
"        const responseId = event.response?.id || null\n        latestAnaRef.current = ''\n        if (permissionDisclosureResponseRef.current && responseId === permissionDisclosureResponseRef.current) {\n          permissionDisclosureResponseRef.current = null\n          setPermission('awaiting')\n          setMicEnabled(true)\n          setSessionState('listening')\n          break\n        }\n        if (closingResponseRef.current && responseId === closingResponseRef.current) {", 'permission response completion')

talk = replaceOnce(talk, "          if (other) {\n            appendHistory({ id: `${Date.now()}-${Math.random()}`, other, anaSpoken: transcript })\n            lastOtherRef.current = ''\n          }", "          if (other && permissionStateRef.current === 'accepted') {\n            appendHistory({ id: `${Date.now()}-${Math.random()}`, other, anaSpoken: transcript })\n            lastOtherRef.current = ''\n          }", 'exclude permission speech from transcript')

talk = replaceOnce(talk, "- Keep the conversation focused on the user's stated goal.\n\nCRITICAL FACT VERIFICATION — mandatory:", "- Keep the conversation focused on the user's stated goal.\n- The counterparty permission gate has already completed before these task instructions become active. If the other person later objects to AI involvement, asks Ana to stop, or withdraws permission, immediately call record_counterparty_permission with decision=withdrawn. Do not ask the owner whether to override them and do not continue the task.\n\nCRITICAL FACT VERIFICATION — mandatory:", 'withdrawal instruction')

talk = replaceOnce(talk, "    awaitingClosingRef.current = false\n    closingResponseRef.current = null\n    if (returnToReady) setStage('ready')", "    awaitingClosingRef.current = false\n    closingResponseRef.current = null\n    permissionDisclosureResponseRef.current = null\n    setPermission('idle')\n    if (returnToReady) setStage('ready')", 'reset permission')

talk = replaceOnce(talk, "      {error && <div className=\"error brief-error\">{error}</div>}\n      <button className=\"magic-start\" onClick={startConversation}><Mic size={19}/> Start conversation</button>", "      <div className=\"verification-preview\"><div className=\"verification-preview-head\"><ShieldCheck size={17}/><div><strong>Permission before the task</strong><span>Ana will identify herself as AI, explain voice processing and ask the other person before the task begins.</span></div></div></div>\n      {error && <div className=\"error brief-error\">{error}</div>}\n      <button className=\"magic-start\" onClick={startConversation}><Mic size={19}/> Start conversation</button>", 'ready permission preview')

talk = replaceOnce(talk, "      <div><span className=\"talk-kicker\">Ana is handling</span><p>{contextSummary}</p></div>", "      <div><span className=\"talk-kicker\">{permissionState === 'accepted' ? 'Ana is handling' : 'Before Ana begins'}</span><p>{contextSummary}</p></div>", 'voice topbar permission state')

talk = replaceOnce(talk, "      {requiredCount > 0 && <div className=\"verification-live\"><ShieldCheck size={14}/><span>{verifiedCount}/{requiredCount} key details resolved</span></div>}", "      {permissionState !== 'accepted' && <div className=\"verification-live\"><ShieldCheck size={14}/><span>{permissionState === 'disclosing' ? 'Ana is giving the AI disclosure' : permissionState === 'awaiting' ? 'Waiting for the other person to agree' : 'Permission is required before the task'}</span></div>}\n      {permissionState === 'accepted' && requiredCount > 0 && <div className=\"verification-live\"><ShieldCheck size={14}/><span>{verifiedCount}/{requiredCount} key details resolved</span></div>}", 'live permission badge')

talk = replaceOnce(talk,
"          <strong>{sessionState === 'connecting' ? 'Connecting Ana' : sessionState === 'listening' ? 'Listening' : sessionState === 'thinking' ? 'Thinking' : sessionState === 'speaking' ? 'Ana is speaking' : sessionState === 'needs-user' ? 'Waiting for you' : 'Paused'}</strong>\n          <span>{sessionState === 'connecting' ? 'Starting realtime voice…' : sessionState === 'listening' ? (interim || 'The other person can speak naturally') : sessionState === 'thinking' ? 'Ana is working out the next move…' : sessionState === 'speaking' ? (latestAna || 'Speaking… You can interrupt Ana anytime.') : sessionState === 'needs-user' ? 'The other-person microphone is paused.' : 'Tap resume when you are ready.'}</span>",
"          <strong>{permissionState === 'disclosing' ? 'Ana is introducing herself' : permissionState === 'awaiting' ? 'Waiting for their permission' : sessionState === 'connecting' ? 'Connecting Ana' : sessionState === 'listening' ? 'Listening' : sessionState === 'thinking' ? 'Thinking' : sessionState === 'speaking' ? 'Ana is speaking' : sessionState === 'needs-user' ? 'Waiting for you' : 'Paused'}</strong>\n          <span>{permissionState === 'disclosing' ? 'The microphone stays off until Ana finishes the fixed AI disclosure.' : permissionState === 'awaiting' ? (interim || 'The task will start only after a clear yes.') : sessionState === 'connecting' ? 'Starting realtime voice…' : sessionState === 'listening' ? (interim || 'The other person can speak naturally') : sessionState === 'thinking' ? 'Ana is working out the next move…' : sessionState === 'speaking' ? (latestAna || 'Speaking… You can interrupt Ana anytime.') : sessionState === 'needs-user' ? 'The other-person microphone is paused.' : 'Tap resume when you are ready.'}</span>", 'permission voice copy')

talk = replaceOnce(talk, "        {pending ? <button className=\"waiting-owner\" disabled><UserRound size={17}/> Waiting for your answer</button> : activeRef.current ? <button className=\"pause-btn\" onClick={pauseConversation}><Pause size={17}/> Pause</button> : <button className=\"resume-btn\" onClick={resumeConversation}><Mic size={17}/> Resume</button>}", "        {permissionState !== 'accepted' ? <button className=\"waiting-owner\" disabled><ShieldCheck size={17}/> Permission gate active</button> : pending ? <button className=\"waiting-owner\" disabled><UserRound size={17}/> Waiting for your answer</button> : activeRef.current ? <button className=\"pause-btn\" onClick={pauseConversation}><Pause size={17}/> Pause</button> : <button className=\"resume-btn\" onClick={resumeConversation}><Mic size={17}/> Resume</button>}", 'permission controls')

fs.writeFileSync(talkPath, talk)

const gatePath = 'src/conversationPrivacyGate.js'
let gate = fs.readFileSync(gatePath, 'utf8')
gate = replaceOnce(gate, "  return { mode: 'Talk for me', languages: [otherLanguage], context }", "  return { mode: 'Talk for me', languages: [otherLanguage], context, mandatory: true }", 'mandatory Talk owner gate')
gate = replaceOnce(gate,
"  const sensitive = isSensitiveConversation(details.context)\n  const badge = node.querySelector('.ana-privacy-sensitive')",
"  const ownerCopy = node.querySelector('.ana-privacy-owner-copy')\n  const continueButton = node.querySelector('.ana-privacy-continue')\n  if (details.mode === 'Talk for me') {\n    ownerCopy.textContent = 'Ana will identify herself as an AI communication assistant and ask the other person whether they agree before the task begins. Their microphone stays gated until Ana finishes the disclosure.'\n    continueButton.textContent = 'Start — Ana will ask them'\n  } else {\n    ownerCopy.textContent = 'Before Ana starts listening, make sure the people whose speech may be captured are appropriately informed.'\n    continueButton.textContent = \"I've informed them — start\"\n  }\n\n  const sensitive = isSensitiveConversation(details.context)\n  const badge = node.querySelector('.ana-privacy-sensitive')", 'owner gate copy')
gate = replaceOnce(gate, "  if (!details || !shouldRequireDisclosure(details.context)) return", "  if (!details || (!details.mandatory && !shouldRequireDisclosure(details.context))) return", 'mandatory Talk gate condition')
fs.writeFileSync(gatePath, gate)
