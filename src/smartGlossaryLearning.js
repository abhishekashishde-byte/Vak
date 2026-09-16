import { markAccountPreferencesChanged } from './accountPreferences.js'

const GLOSSARY_KEY = 'ana-glossary-v1'
const LEARNING_KEY = 'ana-glossary-learning-v1'
const SUGGESTION_THRESHOLD = 2
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000
let installed = false

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch { return false }
}

function normalise(value = '') {
  return String(value).trim().toLocaleLowerCase()
}

function correctionKey(target, source, preferred) {
  return [normalise(target), normalise(source), normalise(preferred)].join('::')
}

function glossaryHasRule(target, source, preferred) {
  const glossary = readJson(GLOSSARY_KEY, [])
  if (!Array.isArray(glossary)) return false
  return glossary.some(item => normalise(item?.target) === normalise(target)
    && normalise(item?.source) === normalise(source)
    && normalise(item?.preferred) === normalise(preferred))
}

function persistGlossaryRule({ target, source, preferred }) {
  const previous = readJson(GLOSSARY_KEY, [])
  const glossary = Array.isArray(previous) ? previous : []
  const next = [
    ...glossary.filter(item => !(normalise(item?.target) === normalise(target) && normalise(item?.source) === normalise(source))),
    { id: crypto.randomUUID(), target, source, preferred },
  ]
  if (!writeJson(GLOSSARY_KEY, next)) return false
  markAccountPreferencesChanged()
  window.dispatchEvent(new CustomEvent('ana-account-preferences-hydrated'))
  window.dispatchEvent(new CustomEvent('ana-glossary-saved', { detail: { target, source, preferred, learned: true } }))
  return true
}

function recordCorrection(target, source, preferred) {
  const state = readJson(LEARNING_KEY, {})
  const key = correctionKey(target, source, preferred)
  const previous = state[key] || {}
  const entry = {
    target,
    source,
    preferred,
    count: Number(previous.count || 0) + 1,
    dismissedUntil: Number(previous.dismissedUntil || 0),
    updatedAt: Date.now(),
  }
  state[key] = entry
  writeJson(LEARNING_KEY, state)
  return { key, entry }
}

function forgetLearning(key) {
  const state = readJson(LEARNING_KEY, {})
  if (!state[key]) return
  delete state[key]
  writeJson(LEARNING_KEY, state)
}

function dismissLearning(key) {
  const state = readJson(LEARNING_KEY, {})
  if (!state[key]) return
  state[key] = { ...state[key], dismissedUntil: Date.now() + DISMISS_MS }
  writeJson(LEARNING_KEY, state)
}

function removeSuggestion() {
  document.querySelector('.ana-glossary-suggestion')?.remove()
}

function showSuggestion(key, entry) {
  if (entry.count < SUGGESTION_THRESHOLD || entry.dismissedUntil > Date.now()) return
  if (glossaryHasRule(entry.target, entry.source, entry.preferred)) {
    forgetLearning(key)
    return
  }

  removeSuggestion()
  const card = document.createElement('aside')
  card.className = 'ana-glossary-suggestion'
  card.setAttribute('role', 'status')
  card.setAttribute('aria-live', 'polite')

  const title = document.createElement('strong')
  title.textContent = 'Ana noticed a terminology preference'

  const body = document.createElement('p')
  body.textContent = `You have chosen this wording ${entry.count} times. Save it so Ana uses it automatically next time?`

  const map = document.createElement('div')
  map.className = 'ana-glossary-map'
  const source = document.createElement('b')
  source.textContent = entry.source
  const arrow = document.createTextNode(' → ')
  const preferred = document.createElement('b')
  preferred.textContent = entry.preferred
  map.append(source, arrow, preferred)

  const actions = document.createElement('div')
  actions.className = 'ana-glossary-actions'

  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = 'Not now'
  later.addEventListener('click', () => {
    dismissLearning(key)
    card.remove()
  })

  const save = document.createElement('button')
  save.type = 'button'
  save.dataset.primary = 'true'
  save.textContent = 'Save preference'
  save.addEventListener('click', () => {
    if (persistGlossaryRule(entry)) forgetLearning(key)
    card.remove()
  })

  actions.append(later, save)
  card.append(title, body, map, actions)
  document.body.appendChild(card)
}

function handleRefinementClick(event) {
  const button = event.target?.closest?.('.alternative > button:first-child')
  if (!button) return
  const popover = button.closest('.popover')
  const app = button.closest('.app-shell')
  const target = app?.querySelector('.toolbar select')?.value?.trim() || ''
  const source = popover?.querySelector('.meaning small b')?.textContent?.trim() || ''
  const preferred = button.querySelector('strong')?.textContent?.trim() || ''
  if (!target || !source || !preferred || normalise(source) === normalise(preferred)) return
  if (glossaryHasRule(target, source, preferred)) return

  const { key, entry } = recordCorrection(target, source, preferred)
  queueMicrotask(() => showSuggestion(key, entry))
}

export function installSmartGlossaryLearning() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', handleRefinementClick, true)
}
