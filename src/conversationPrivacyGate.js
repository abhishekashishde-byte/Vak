import { DISCLOSURE_COPY, isSensitiveConversation, shouldRequireDisclosure } from './conversationPrivacy.js'

let installed = false
let bypassButton = null
let overlay = null
let pendingButton = null
let pendingDetails = null

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function talkDetails(button) {
  const stage = button.closest('.talk-wrap.ready-stage')
  if (!stage || !/start conversation/i.test(button.textContent || '')) return null
  const selects = stage.querySelectorAll('.ready-languages select')
  const otherLanguage = selects?.[1]?.value || 'English'
  const context = stage.querySelector('.ready-summary p')?.textContent?.trim() || ''
  return { mode: 'Talk for me', languages: [otherLanguage], context, mandatory: true }
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

function roomDetails(button) {
  if (!button.classList.contains('room-start') || !/open room/i.test(button.textContent || '')) return null
  const stage = button.closest('.room-setup')
  if (!stage) return null
  const languages = [...stage.querySelectorAll('.room-person-row select')].map(select => select.value).filter(Boolean)
  return { mode: 'Conversation Room', languages: languages.length ? languages : ['English'], context: '' }
}

function captionsDetails(button) {
  if (!button.classList.contains('captions-start') || !/start (?:captions|subtitles)/i.test(button.textContent || '')) return null
  const stage = button.closest('.captions-wrap')
  if (!stage) return null
  const selects = stage.querySelectorAll('.captions-toolbar select')
  const target = selects?.[1]?.value || 'English'
  const languages = target && target !== 'Original only' ? ['English', target] : ['English']
  return { mode: 'Live Subtitles', languages, context: '' }
}

function meetingDetails(button) {
  if (!button.classList.contains('meeting-start') || !/start listening/i.test(button.textContent || '')) return null
  const stage = button.closest('.meeting-wrap')
  if (!stage) return null
  const selects = stage.querySelectorAll('.meeting-toolbar select')
  const target = selects?.[1]?.value || 'English'
  return { mode: 'Meeting Listen', languages: [target], context: '' }
}

function detailsFor(button) {
  return talkDetails(button) || liveDetails(button) || roomDetails(button) || captionsDetails(button) || meetingDetails(button)
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay
  overlay = document.createElement('div')
  overlay.className = 'ana-privacy-gate'
  overlay.innerHTML = `
    <div class="ana-privacy-card" role="dialog" aria-modal="true" aria-label="Voice privacy">
      <div class="ana-privacy-kicker">Privacy before voice</div>
      <h2>Make the conversation transparent.</h2>
      <p class="ana-privacy-owner-copy">Before Ana starts listening, make sure the people whose speech may be captured are appropriately informed.</p>
      <div class="ana-privacy-sensitive" hidden>Extra privacy mode is active for this conversation.</div>
      <div class="ana-privacy-disclosures"></div>
      <div class="ana-privacy-facts">
        <span><b>Voice processing</b> Speech is sent to the AI service only while Ana is actively listening or translating.</span>
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
    const details = pendingDetails

    // Microphone and screen capture must remain attached to a genuine user tap.
    // After the privacy gate on iPhone Live and for Meeting Listen, return to the
    // real start button instead of replaying it synthetically.
    if ((details?.mode === 'Live interpreter' && isIOSDevice()) || details?.mode === 'Meeting Listen') {
      if (button?.isConnected) button.dataset.anaPrivacyBypass = '1'
      closeGate()
      requestAnimationFrame(() => {
        try { button?.focus?.({ preventScroll: true }) } catch {}
        try { button?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }) } catch {}
      })
      return
    }

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
  pendingDetails = null
  overlay?.classList.remove('visible')
}

function openGate(button, details) {
  pendingButton = button
  pendingDetails = details
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

  const ownerCopy = node.querySelector('.ana-privacy-owner-copy')
  const continueButton = node.querySelector('.ana-privacy-continue')
  if (details.mode === 'Talk for me') {
    ownerCopy.textContent = 'Ana will identify herself as an AI communication assistant, explain that speech is processed by an AI service, and ask the other person before the task begins.'
    continueButton.textContent = 'Start — Ana will ask them'
  } else if (details.mode === 'Live interpreter' && isIOSDevice()) {
    ownerCopy.textContent = 'Before Ana starts listening, make sure the people whose speech may be captured are appropriately informed. On iPhone, after Continue, tap Start conversation once more so the microphone opens directly from your tap.'
    continueButton.textContent = 'Continue'
  } else if (details.mode === 'Meeting Listen') {
    ownerCopy.textContent = 'Before Ana listens to a meeting, make sure participants are appropriately informed. Ana saves the text transcript on this device but does not store meeting audio. After Continue, tap Start listening once more so browser audio capture opens from your real tap.'
    continueButton.textContent = 'Continue'
  } else {
    ownerCopy.textContent = 'Before Ana starts listening, make sure the people whose speech may be captured are appropriately informed.'
    continueButton.textContent = "I've informed them — start"
  }

  const sensitive = isSensitiveConversation(details.context)
  const badge = node.querySelector('.ana-privacy-sensitive')
  badge.hidden = !sensitive
  node.querySelector('.ana-privacy-kicker').textContent = `${details.mode} · privacy before voice`
  node.classList.add('visible')
}

function interceptStart(event) {
  const button = event.target?.closest?.('button')
  if (!button) return
  if (button.dataset?.anaPrivacyBypass === '1') {
    delete button.dataset.anaPrivacyBypass
    return
  }
  if (button === bypassButton) return
  const details = detailsFor(button)
  if (!details || (!details.mandatory && !shouldRequireDisclosure(details.context))) return

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
