const NETWORK_EVENT = 'ana-network-state'

let installed = false
let nativeFetch = null

const aiEndpoint = url => {
  const value = typeof url === 'string' ? url : url?.url || ''
  return /\/api\/(translate|transcribe|document-ocr|realtime-token)(?:\?|$)/.test(value)
}

export function getNetworkState() {
  if (typeof navigator === 'undefined') return { online: true, weak: false, effectiveType: '' }
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  const effectiveType = String(connection?.effectiveType || '')
  const weak = Boolean(connection?.saveData || /(^|-)2g$/i.test(effectiveType) || effectiveType === 'slow-2g')
  return { online: navigator.onLine !== false, weak, effectiveType, saveData: Boolean(connection?.saveData) }
}

function announceNetworkState() {
  if (typeof window === 'undefined') return
  const state = getNetworkState()
  document.documentElement.dataset.anaNetwork = state.online ? (state.weak ? 'weak' : 'online') : 'offline'
  window.dispatchEvent(new CustomEvent(NETWORK_EVENT, { detail: state }))
}

export function subscribeNetworkState(listener) {
  if (typeof window === 'undefined') return () => {}
  const handler = event => listener(event.detail || getNetworkState())
  window.addEventListener(NETWORK_EVENT, handler)
  return () => window.removeEventListener(NETWORK_EVENT, handler)
}

export async function tryOnDeviceTranslation(text, target) {
  const targetCodes = { English: 'en', German: 'de', Hindi: 'hi', French: 'fr', Spanish: 'es', Italian: 'it' }
  const targetLanguage = targetCodes[target]
  if (!text?.trim() || !targetLanguage || target === 'Hinglish') return null

  const TranslatorApi = globalThis.Translator
  const DetectorApi = globalThis.LanguageDetector
  if (!TranslatorApi?.create || !DetectorApi?.create) return null

  try {
    const detector = await DetectorApi.create()
    const detections = await detector.detect(text)
    const sourceLanguage = detections?.[0]?.detectedLanguage || detections?.[0]?.language
    detector.destroy?.()
    if (!sourceLanguage) return null
    if (sourceLanguage.toLowerCase().split('-')[0] === targetLanguage) return text.trim()

    if (TranslatorApi.availability) {
      const availability = await TranslatorApi.availability({ sourceLanguage, targetLanguage })
      if (availability === 'unavailable') return null
      if (!getNetworkState().online && availability !== 'available') return null
    }

    const translator = await TranslatorApi.create({ sourceLanguage, targetLanguage })
    const translated = await translator.translate(text)
    translator.destroy?.()
    const result = String(translated || '').trim()
    return result || null
  } catch {
    return null
  }
}

export function installNetworkResilience() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('online', announceNetworkState)
  window.addEventListener('offline', announceNetworkState)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  connection?.addEventListener?.('change', announceNetworkState)
  announceNetworkState()

  if (window.fetch) {
    nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (navigator.onLine === false && aiEndpoint(input)) {
        const error = new Error('Ana needs a connection for this feature. Reconnect to continue; Ana will not guess or invent a result while offline.')
        error.code = 'ANA_OFFLINE'
        return Promise.reject(error)
      }
      return nativeFetch(input, init)
    }
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/ana-sw.js').catch(() => {})
    }, { once: true })
  }
}
