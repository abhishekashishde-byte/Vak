let installed = false
let manualMode = false
let holding = false
let talkTrack = null
let talkChannel = null
let ownerControls = null
let counterpartyButton = null
let tailTimer = null

const COPY = {
  English: { hold: 'Hold while you speak', listening: 'Listening…' },
  German: { hold: 'Zum Sprechen gedrückt halten', listening: 'Ich höre zu…' },
  Hindi: { hold: 'बोलते समय दबाकर रखें', listening: 'सुन रही हूँ…' },
  French: { hold: 'Maintenez pour parler', listening: 'Je vous écoute…' },
  Spanish: { hold: 'Mantenga pulsado para hablar', listening: 'Escuchando…' },
  Italian: { hold: 'Tenga premuto per parlare', listening: 'Sto ascoltando…' },
}

function conversation() {
  const stage = document.querySelector('.talk-wrap.voice-stage')
  const card = stage?.querySelector('.voice-card')
  const orb = card?.querySelector('.ana-orb')
  if (!stage || !card || !orb) return null
  const languageSpans = card.querySelectorAll('.voice-language span')
  const otherLanguage = languageSpans?.[2]?.textContent?.trim() || 'English'
  const ownerPending = card.classList.contains('owner-pending') || orb.classList.contains('needs-user')
  const speaking = orb.classList.contains('speaking') || orb.classList.contains('thinking') || orb.classList.contains('connecting')
  return { stage, card, orb, otherLanguage, ownerPending, speaking }
}

function setTrack(enabled) {
  if (!talkTrack || talkTrack.readyState === 'ended') return
  try { talkTrack.enabled = Boolean(enabled) } catch {}
}

function enforceMic() {
  if (!manualMode) return
  const current = conversation()
  if (!current || current.ownerPending || !holding) setTrack(false)
}

function beginHold(event) {
  if (!manualMode) return
  const current = conversation()
  if (!current || current.ownerPending || current.speaking) return
  event?.preventDefault?.()
  clearTimeout(tailTimer)
  holding = true
  setTrack(true)
  ownerControls?.classList.add('holding')
  counterpartyButton?.classList.add('holding')
  render()
  try { event?.currentTarget?.setPointerCapture?.(event.pointerId) } catch {}
}

function endHold(event) {
  if (!manualMode || !holding) return
  event?.preventDefault?.()
  holding = false
  clearTimeout(tailTimer)
  tailTimer = setTimeout(() => setTrack(false), 140)
  ownerControls?.classList.remove('holding')
  counterpartyButton?.classList.remove('holding')
  render()
}

function bindHold(button) {
  if (!button || button.dataset.pttBound === '1') return
  button.dataset.pttBound = '1'
  button.addEventListener('pointerdown', beginHold)
  button.addEventListener('pointerup', endHold)
  button.addEventListener('pointercancel', endHold)
  button.addEventListener('lostpointercapture', endHold)
  button.addEventListener('contextmenu', event => event.preventDefault())
}

function setManual(next) {
  manualMode = Boolean(next)
  holding = false
  clearTimeout(tailTimer)
  const current = conversation()
  if (manualMode || current?.ownerPending) setTrack(false)
  else setTrack(true)
  render()
}

function ensureOwnerControls(card) {
  if (ownerControls?.isConnected) return ownerControls
  ownerControls = document.createElement('div')
  ownerControls.className = 'ana-ptt-owner'
  ownerControls.innerHTML = `
    <div class="ana-ptt-mode">
      <div><strong>Noisy place?</strong><span>Use manual listening if background voices confuse Ana.</span></div>
      <div class="ana-ptt-segmented">
        <button type="button" data-mode="auto">Automatic</button>
        <button type="button" data-mode="manual">Push to talk</button>
      </div>
    </div>
    <button type="button" class="ana-ptt-hold"><span class="ana-ptt-mic">●</span><span>Hold while the other person speaks</span></button>
    <small>In push-to-talk mode the external microphone stays off until this button is held.</small>
  `
  const controls = card.querySelector('.voice-controls')
  if (controls) card.insertBefore(ownerControls, controls)
  else card.appendChild(ownerControls)
  ownerControls.querySelector('[data-mode="auto"]')?.addEventListener('click', () => setManual(false))
  ownerControls.querySelector('[data-mode="manual"]')?.addEventListener('click', () => setManual(true))
  bindHold(ownerControls.querySelector('.ana-ptt-hold'))
  return ownerControls
}

function ensureCounterpartyButton(overlay, language) {
  if (!counterpartyButton?.isConnected) {
    counterpartyButton = document.createElement('button')
    counterpartyButton.type = 'button'
    counterpartyButton.className = 'counterparty-ptt-hold'
    overlay.appendChild(counterpartyButton)
    bindHold(counterpartyButton)
  }
  const copy = COPY[language] || COPY.English
  const label = holding ? copy.listening : copy.hold
  if (counterpartyButton.textContent !== label) counterpartyButton.textContent = label
  return counterpartyButton
}

function render() {
  const current = conversation()
  if (!current) {
    manualMode = false
    holding = false
    setTrack(true)
    ownerControls?.remove()
    ownerControls = null
    counterpartyButton?.remove()
    counterpartyButton = null
    return
  }

  const controls = ensureOwnerControls(current.card)
  controls.classList.toggle('manual', manualMode)
  controls.classList.toggle('blocked', current.ownerPending || current.speaking)
  const autoButton = controls.querySelector('[data-mode="auto"]')
  const manualButton = controls.querySelector('[data-mode="manual"]')
  autoButton?.classList.toggle('active', !manualMode)
  manualButton?.classList.toggle('active', manualMode)
  if (autoButton) autoButton.disabled = current.ownerPending
  if (manualButton) manualButton.disabled = current.ownerPending
  const hold = controls.querySelector('.ana-ptt-hold')
  if (hold) hold.disabled = !manualMode || current.ownerPending || current.speaking

  const overlay = document.querySelector('.ana-counterparty-overlay')
  if (overlay) {
    overlay.classList.toggle('push-to-talk-mode', manualMode)
    const button = ensureCounterpartyButton(overlay, current.otherLanguage)
    button.hidden = !manualMode
    button.disabled = current.ownerPending || current.speaking
  }
  enforceMic()
}

function captureRealtime() {
  const pc = window.RTCPeerConnection?.prototype
  if (!pc) return

  const nativeAddTrack = pc.addTrack
  if (nativeAddTrack) {
    pc.addTrack = function patchedAddTrack(track, ...streams) {
      if (track?.kind === 'audio' && document.querySelector('.talk-wrap.voice-stage')) talkTrack = track
      return nativeAddTrack.call(this, track, ...streams)
    }
  }

  const nativeCreateDataChannel = pc.createDataChannel
  if (nativeCreateDataChannel) {
    pc.createDataChannel = function patchedCreateDataChannel(label, options) {
      const channel = nativeCreateDataChannel.call(this, label, options)
      if (label === 'oai-events' && document.querySelector('.talk-wrap.voice-stage')) {
        talkChannel = channel
        channel.addEventListener('message', message => {
          if (!manualMode) return
          try {
            const event = JSON.parse(message.data)
            if (event.type === 'response.done' || event.type === 'response.created') queueMicrotask(enforceMic)
          } catch {}
        })
        channel.addEventListener('close', () => {
          if (talkChannel === channel) talkChannel = null
        })
      }
      return channel
    }
  }
}

export function installPushToTalkFallback() {
  if (installed || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  installed = true
  captureRealtime()

  const observer = new MutationObserver(() => render())
  const start = () => {
    if (!document.body) return
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    render()
  }
  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })

  window.addEventListener('blur', () => {
    if (manualMode && holding) endHold()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && manualMode) {
      holding = false
      setTrack(false)
    }
  })
}
