import { DISCLOSURE_COPY, isSensitiveConversation, shouldRequireDisclosure } from './conversationPrivacy.js'

let installed = false
let bypassButton = null
let overlay = null
let pendingButton = null

function talkDetails(button) {
  const stage = button.closest('.talk-wrap.ready-stage')
  if (!stage || !/start conversation/i.test(button.textContent || '')) return null
  const selects = stage.querySelectorAll('.ready-languages select')
  const otherLanguage = selects?.[1]?.value || 'English'
  const context = stage.querySelector('.ready-summary p')?.textContent?.trim() || ''
  return { mode: 'Talk for me', languages: [otherLanguage], context }
}

function liveDetails(button) {
  if (!button.classList.contains('live-mic') || !/start conversation/i.test(button.textContent || '')) return null
  const stage = button.closest('.live-interpreter')
  if (!stage) return null
  const selects = stage.querySelectorAll('.live-pair-toolbar select')
  const first = selects?.[0]?.value || 'English'
  const second = selects?.[1]?.value || 'German'
  return { mode: 'Live interpreter', languages: [first, second], context: '' }
}

function detailsFor(button) {
  return talkDetails(button) || liveDetails(button)
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay
  overlay = document.createElement('div')
  overlay.className = 'ana-privacy-gate'
  overlay.innerHTML = `
    <div class="ana-privacy-card" role="dialog" aria-modal="true" aria-label="Voice privacy">
      <div class="ana-privacy-kicker">Privacy before voice</div>
      <h2>Make the conversation transparent.</h2>
      <p class="ana-privacy-owner-copy">Before Ana starts listening, show or explain the notice below to the other person.</p>
      <div class="ana-privacy-sensitive" hidden>Extra privacy mode is active for this conversation.</div>
      <div class="ana-privacy-disclosures"></div>
      <div class="ana-privacy-facts">
        <span><b>Live processing</b> Speech is sent to the realtime AI service only while the voice session is running.</span>
        <span><b>No conversation memory</b> Ana does not add what people say to your personal language memory.</span>
        <span><b>Session-only transcript</b> Ana does not sync voice-session transcripts into your account preferences.</span>
      </div>
      <p class="ana-privacy-legal">This disclosure is for transparency. It does not determine the legal requirements for every situation or country.</p>
      <div class="ana-privacy-actions"><button type="button" class="ana-privacy-cancel">Cancel</button><button type="button" class="ana-privacy-continue">I've informed them — start</button></div>
    </div>`
  document.body.appendChild(overlay)

  overlay.querySelector('.ana-privacy-cancel')?.addEventListener('click', closeGate)
  overlay.querySelector('.ana-privacy-continue')?.addEventListener('click', () => {
    const button = pendingButton
    closeGate()
    if (!button?.isConnected) return
    bypassButton = button
    button.click()
    queueMicrotask(() => { if (bypassButton === button) bypassButton = null })
  })
  overlay.addEventListener('mousedown', event => {
    if (event.target === overlay) closeGate()
  })
  return overlay
}

function closeGate() {
  pendingButton = null
  overlay?.classList.remove('visible')
}

function openGate(button, details) {
  pendingButton = button
  const node = ensureOverlay()
  const disclosures = node.querySelector('.ana-privacy-disclosures')
  disclosures.innerHTML = ''

  for (const language of [...new Set(details.languages)]) {
    const item = document.createElement('div')
    item.className = 'ana-privacy-disclosure'
    const label = document.createElement('span')
    label.textContent = language
    const text = document.createElement('p')
    text.textContent = DISCLOSURE_COPY[language] || DISCLOSURE_COPY.English
    item.append(label, text)
    disclosures.appendChild(item)
  }

  const sensitive = isSensitiveConversation(details.context)
  const badge = node.querySelector('.ana-privacy-sensitive')
  badge.hidden = !sensitive
  node.querySelector('.ana-privacy-kicker').textContent = `${details.mode} · privacy before voice`
  node.classList.add('visible')
}

function interceptStart(event) {
  const button = event.target?.closest?.('button')
  if (!button || button === bypassButton) return
  const details = detailsFor(button)
  if (!details || !shouldRequireDisclosure(details.context)) return

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  openGate(button, details)
}

export function installConversationPrivacyGate() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', interceptStart, true)
}
