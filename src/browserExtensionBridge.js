const DRAFT_KEY = 'ana-translate-draft-v1'
const EXTENSION_PARAM = 'anaExt'
const MAX_SELECTION = 8000
const ACTIONS = new Set(['translate', 'rewrite', 'correct', 'shorter', 'friendly', 'formal', 'du', 'sie', 'explain', 'reply'])

function cleanText(value = '') {
  return String(value).replace(/\r\n?/g, '\n').trim().slice(0, MAX_SELECTION)
}

export function decodeExtensionRequest(hash = '') {
  const raw = String(hash || '').replace(/^#/, '')
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const encoded = params.get(EXTENSION_PARAM)
  if (!encoded) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(encoded))
    const action = ACTIONS.has(parsed?.action) ? parsed.action : 'translate'
    const text = cleanText(parsed?.text)
    if (!text) return null
    return {
      action,
      text,
      glossaryContext: String(parsed?.glossaryContext || '').trim().slice(0, 120),
      sourceTitle: String(parsed?.sourceTitle || '').trim().slice(0, 240),
      version: Number(parsed?.version) || 1,
    }
  } catch {
    return null
  }
}

export function extensionRequestToDraft(request, previous = {}) {
  if (!request?.text) return previous
  const text = cleanText(request.text)
  const common = { ...previous, output: '', updatedAt: Date.now() }

  const scoped = { ...common, glossaryContext: request.glossaryContext || previous.glossaryContext || '' }
  if (request.action !== 'translate') {
    return { ...scoped, writingMode: 'write', extensionAction: request.action, input: text }
  }
  return { ...scoped, writingMode: 'translate', extensionAction: '', input: text }
}

export function installBrowserExtensionBridge() {
  if (typeof window === 'undefined') return null
  const request = decodeExtensionRequest(window.location.hash)
  if (!request) return null

  try {
    let previous = {}
    try { previous = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || '{}') || {} } catch {}
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(extensionRequestToDraft(request, previous)))
  } catch {}

  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
  } catch {}

  return request
}
