let installed = false
let overlay = null
let manualOwnerView = false
let sessionPresent = false

const COPY = {
  English: {
    connecting: ['Ana is connecting', 'One moment, please.'],
    listening: ["I'm listening", 'Please speak naturally.'],
    thinking: ['One moment', 'Ana is understanding what you said.'],
    speaking: ['Ana is speaking', 'You can interrupt at any time.'],
    'needs-user': ['One moment', 'Ana needs to check something with the person she is helping.'],
    idle: ['Paused', 'Please wait a moment.'],
    owner: 'Owner view',
    ownerNeeded: 'Owner input needed',
    showAgain: 'Show counterparty view',
  },
  German: {
    connecting: ['Ana verbindet sich', 'Einen Moment bitte.'],
    listening: ['Ich höre zu', 'Sie können ganz normal sprechen.'],
    thinking: ['Einen Moment bitte', 'Ana versteht gerade, was Sie gesagt haben.'],
    speaking: ['Ana spricht', 'Sie können jederzeit unterbrechen.'],
    'needs-user': ['Einen Moment bitte', 'Ana muss kurz etwas mit der Person klären, der sie hilft.'],
    idle: ['Pausiert', 'Bitte warten Sie einen Moment.'],
    owner: 'Ansicht für Nutzer',
    ownerNeeded: 'Rückfrage an den Nutzer',
    showAgain: 'Ansicht für Gesprächspartner',
  },
  Hindi: {
    connecting: ['Ana जुड़ रही है', 'एक क्षण कृपया।'],
    listening: ['मैं सुन रही हूँ', 'आप सामान्य रूप से बोल सकते हैं।'],
    thinking: ['एक क्षण', 'Ana आपकी बात समझ रही है।'],
    speaking: ['Ana बोल रही है', 'आप किसी भी समय बीच में बोल सकते हैं।'],
    'needs-user': ['एक क्षण कृपया', 'Ana को उस व्यक्ति से एक बात पूछनी है जिसकी वह मदद कर रही है।'],
    idle: ['रुका हुआ', 'कृपया एक क्षण प्रतीक्षा करें।'],
    owner: 'यूज़र व्यू',
    ownerNeeded: 'यूज़र से जवाब चाहिए',
    showAgain: 'सामने वाले के लिए स्क्रीन दिखाएँ',
  },
  French: {
    connecting: ['Ana se connecte', 'Un instant, s’il vous plaît.'],
    listening: ["Je vous écoute", 'Vous pouvez parler normalement.'],
    thinking: ['Un instant', 'Ana comprend ce que vous venez de dire.'],
    speaking: ['Ana parle', 'Vous pouvez l’interrompre à tout moment.'],
    'needs-user': ['Un instant', 'Ana doit vérifier quelque chose avec la personne qu’elle aide.'],
    idle: ['En pause', 'Veuillez patienter un instant.'],
    owner: 'Vue utilisateur',
    ownerNeeded: 'Réponse de l’utilisateur requise',
    showAgain: 'Afficher la vue interlocuteur',
  },
  Spanish: {
    connecting: ['Ana se está conectando', 'Un momento, por favor.'],
    listening: ['Estoy escuchando', 'Puede hablar con normalidad.'],
    thinking: ['Un momento', 'Ana está comprendiendo lo que acaba de decir.'],
    speaking: ['Ana está hablando', 'Puede interrumpir en cualquier momento.'],
    'needs-user': ['Un momento', 'Ana necesita consultar algo con la persona a la que está ayudando.'],
    idle: ['En pausa', 'Espere un momento, por favor.'],
    owner: 'Vista del usuario',
    ownerNeeded: 'Se necesita respuesta del usuario',
    showAgain: 'Mostrar vista para interlocutor',
  },
  Italian: {
    connecting: ['Ana si sta collegando', 'Un momento, per favore.'],
    listening: ['Sto ascoltando', 'Può parlare normalmente.'],
    thinking: ['Un momento', 'Ana sta comprendendo ciò che ha detto.'],
    speaking: ['Ana sta parlando', 'Può interrompere in qualsiasi momento.'],
    'needs-user': ['Un momento', 'Ana deve verificare una cosa con la persona che sta aiutando.'],
    idle: ['In pausa', 'Attenda un momento, per favore.'],
    owner: 'Vista utente',
    ownerNeeded: 'Serve una risposta dell’utente',
    showAgain: 'Mostra vista interlocutore',
  },
}

const STATES = ['connecting', 'listening', 'thinking', 'speaking', 'needs-user', 'idle']

function getConversation() {
  const stage = document.querySelector('.talk-wrap.voice-stage')
  const card = stage?.querySelector('.voice-card')
  const orb = card?.querySelector('.ana-orb')
  if (!stage || !card || !orb) return null

  const state = STATES.find(value => orb.classList.contains(value)) || 'idle'
  const languageSpans = card.querySelectorAll('.voice-language span')
  const otherLanguage = languageSpans?.[2]?.textContent?.trim() || 'English'
  const ownerPending = card.classList.contains('owner-pending') || state === 'needs-user'
  return { stage, card, state, otherLanguage, ownerPending }
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay
  overlay = document.createElement('div')
  overlay.className = 'ana-counterparty-overlay'
  overlay.innerHTML = `
    <button type="button" class="counterparty-owner-button"></button>
    <div class="counterparty-brand"><span class="counterparty-a">A</span><span>Ana</span></div>
    <div class="counterparty-signal" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="counterparty-copy"><strong></strong><span></span></div>
    <div class="counterparty-language"></div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('.counterparty-owner-button')?.addEventListener('click', () => {
    manualOwnerView = true
    render()
  })
  return overlay
}

function ensureReturnButton(stage, language) {
  let button = stage.querySelector('.counterparty-return-button')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'counterparty-return-button'
    button.addEventListener('click', () => {
      manualOwnerView = false
      render()
    })
    stage.appendChild(button)
  }
  const copy = COPY[language] || COPY.English
  button.textContent = copy.showAgain
  return button
}

function removeReturnButtons() {
  document.querySelectorAll('.counterparty-return-button').forEach(node => node.remove())
}

function render() {
  const conversation = getConversation()
  if (!conversation) {
    if (sessionPresent) manualOwnerView = false
    sessionPresent = false
    overlay?.classList.remove('visible')
    removeReturnButtons()
    return
  }

  sessionPresent = true
  const { stage, state, otherLanguage, ownerPending } = conversation
  const copy = COPY[otherLanguage] || COPY.English
  const current = copy[state] || copy.idle

  const node = ensureOverlay()
  node.dataset.state = state
  node.querySelector('.counterparty-copy strong').textContent = current[0]
  node.querySelector('.counterparty-copy span').textContent = current[1]
  node.querySelector('.counterparty-language').textContent = `Ana · ${otherLanguage}`

  const ownerButton = node.querySelector('.counterparty-owner-button')
  ownerButton.textContent = ownerPending ? copy.ownerNeeded : copy.owner
  ownerButton.classList.toggle('attention', ownerPending)

  if (manualOwnerView) {
    node.classList.remove('visible')
    ensureReturnButton(stage, otherLanguage)
  } else {
    removeReturnButtons()
    node.classList.add('visible')
  }
}

export function installCounterpartyView() {
  if (installed || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  installed = true

  const observer = new MutationObserver(() => render())
  const start = () => {
    if (!document.body) return
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    render()
  }

  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })
}
