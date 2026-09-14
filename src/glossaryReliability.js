import { markAccountPreferencesChanged } from './accountPreferences.js'

const GLOSSARY_KEY = 'ana-glossary-v1'
let installed = false

const readGlossary = () => {
  try {
    const value = JSON.parse(localStorage.getItem(GLOSSARY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const persistRule = ({ target, source, preferred }) => {
  if (!target || !source || !preferred) return false
  const previous = readGlossary()
  const next = [
    ...previous.filter(item => !(item?.target === target && String(item?.source || '').toLowerCase() === source.toLowerCase())),
    { id: crypto.randomUUID(), target, source, preferred },
  ]
  try {
    localStorage.setItem(GLOSSARY_KEY, JSON.stringify(next))
    markAccountPreferencesChanged()
    window.dispatchEvent(new CustomEvent('ana-account-preferences-hydrated'))
    window.dispatchEvent(new CustomEvent('ana-glossary-saved', { detail: { target, source, preferred } }))
    return true
  } catch {
    return false
  }
}

export function installGlossaryReliability() {
  if (installed || typeof document === 'undefined') return
  installed = true

  // React's Always action updates component state, but we also persist the rule
  // immediately from the visible refinement card. This prevents account hydration
  // or a fast drawer-open from making a just-saved preference appear to vanish.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button.always')
    if (!button) return
    const app = button.closest('.app-shell')
    const popover = button.closest('.popover')
    const row = button.closest('.alternative')
    const target = app?.querySelector('.toolbar select')?.value?.trim() || ''
    const source = popover?.querySelector('.meaning small b')?.textContent?.trim() || ''
    const preferred = row?.querySelector('button:first-child strong')?.textContent?.trim() || ''
    persistRule({ target, source, preferred })
  })
}
