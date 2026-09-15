import { getPrivacySettings } from './accountPreferences.js'
import { maskSensitiveText, restoreSensitiveText } from './sensitiveMaskingCore.js'

let installed = false
let nativeFetch = null

function maskRequestBody(body) {
  if (!body || typeof body !== 'object' || body.skipSensitiveMasking === true) return { body, items: [] }
  if (typeof body.text !== 'string' || !body.text) return { body, items: [] }

  const masked = maskSensitiveText(body.text)
  if (!masked.items.length) return { body, items: [] }

  const instruction = '\n\nPRIVACY PLACEHOLDERS: The user text may contain tokens such as [[ANA_PRIVATE_1]]. Treat every such token as an opaque value. Preserve each token EXACTLY, character-for-character, in the correct semantic position. Never translate, expand, explain, omit, reorder or alter a privacy token.'
  return {
    body: {
      ...body,
      text: masked.text,
      instructions: `${String(body.instructions || '')}${instruction}`.trim(),
    },
    items: masked.items,
  }
}

async function restoreResponse(response, items) {
  if (!items.length || !response?.clone) return response
  try {
    const data = await response.clone().json()
    if (!data || typeof data !== 'object' || typeof data.content !== 'string') return response
    const restored = { ...data, content: restoreSensitiveText(data.content, items) }
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    return new Response(JSON.stringify(restored), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return response
  }
}

function isTranslateRequest(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  return url.includes('/api/translate') && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string'
}

export function installLocalSensitiveMasking() {
  if (installed || typeof window === 'undefined' || !window.fetch) return
  installed = true
  nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    if (!isTranslateRequest(input, init)) return nativeFetch(input, init)

    const settings = getPrivacySettings()
    if (settings.maskSensitiveBeforeCloud === false) return nativeFetch(input, init)

    try {
      const parsed = JSON.parse(init.body)
      const masked = maskRequestBody(parsed)
      if (!masked.items.length) return nativeFetch(input, init)

      const counts = masked.items.reduce((acc, item) => {
        acc[item.type] = Number(acc[item.type] || 0) + 1
        return acc
      }, {})
      window.dispatchEvent(new CustomEvent('ana-sensitive-data-masked', { detail: { count: masked.items.length, types: counts } }))

      const response = await nativeFetch(input, { ...init, body: JSON.stringify(masked.body) })
      return restoreResponse(response, masked.items)
    } catch {
      return nativeFetch(input, init)
    }
  }
}
