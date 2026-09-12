let installed = false
let nativeSend = null

const LIVE_TONE_POLICY = `

VOICE & EMOTION POLICY:
- Listen not only to the words but also to the speaker's delivery: politeness, warmth, concern, frustration, excitement, seriousness, urgency, confidence, hesitation and conversational intensity.
- Preserve that communicative tone in the translated speech using natural prosody in the target language. A polite request should sound politely spoken; a worried statement should sound concerned; a firm complaint should sound firm; an excited reaction may sound upbeat.
- Preserve the LEVEL of emotion, not just its category. Mild frustration must not become anger. Strong urgency must not become casual.
- Never exaggerate, dramatize, caricature, mock, imitate an individual's identity, or add emotion that was not present.
- Do not copy a source-language accent into the target language. Use natural native pronunciation for the target language while carrying over the intent and emotional delivery.
- Tone must never change the factual meaning, numbers, names, commitments or degree of certainty.
- When tone is ambiguous, use a natural neutral-to-warm conversational delivery.
- Do not describe the emotion aloud. Express it only through wording that is translation-equivalent and through vocal delivery.`

const TALK_TONE_POLICY = `

VOICE, TONE & SOCIAL JUDGMENT:
- Speak like a capable human representative, not a neutral text reader. Choose a restrained, situation-appropriate delivery on every turn.
- Infer the owner's intended tone from the brief and preserve explicit intent such as polite, formal, friendly, firm, apologetic, concerned or urgent.
- Also read the other person's current tone and adapt intelligently: be warm when they are helpful, calm when they are confused or upset, concise and firm when resolving a problem, and appropriately serious for medical, official, financial or consequential matters.
- Do NOT blindly mirror hostility, sarcasm or aggression. De-escalate while still protecting the owner's goal.
- For ordinary counters, shops, restaurants and travel situations, sound naturally polite and conversational rather than overly formal.
- For authorities, doctors, schools and formal organisations, use respectful professional delivery unless the context clearly calls for something else.
- Emotion is delivery, not invention: never alter facts, certainty, price, authorization, commitments or the owner's actual position just to sound empathetic or persuasive.
- Keep emotional expression subtle. Never become theatrical, sales-like, excessively cheerful, apologetic without reason, or artificially sympathetic.
- If the situation gives no clear emotional cue, default to calm, confident, friendly professionalism.`

function enhancedInstructions(instructions) {
  const text = String(instructions || '')
  if (!text || text.includes('VOICE & EMOTION POLICY:') || text.includes('VOICE, TONE & SOCIAL JUDGMENT:')) return text

  if (text.includes('live two-way interpreter') || text.includes('YOUR ONLY JOB IS TO INTERPRET')) {
    return `${text}${LIVE_TONE_POLICY}`
  }

  if (text.includes("live speech-to-speech agent speaking to another person on the user's behalf") || text.includes("USER'S GOAL / BRIEF:")) {
    return `${text}${TALK_TONE_POLICY}`
  }

  return text
}

export function installRealtimeTonePolicy() {
  if (installed || typeof window === 'undefined' || typeof window.RTCDataChannel === 'undefined') return

  const proto = window.RTCDataChannel.prototype
  if (!proto?.send) return

  nativeSend = proto.send

  try {
    proto.send = function patchedAnaRealtimeSend(data) {
      if (typeof data === 'string') {
        try {
          const event = JSON.parse(data)
          if (event?.type === 'session.update' && event?.session?.instructions) {
            event.session.instructions = enhancedInstructions(event.session.instructions)
            return nativeSend.call(this, JSON.stringify(event))
          }
        } catch {}
      }
      return nativeSend.call(this, data)
    }
    installed = true
  } catch {
    nativeSend = null
  }
}
