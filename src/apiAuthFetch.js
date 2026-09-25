import { supabase } from './lib/supabase.js'

let installed = false

export function installAuthenticatedApiFetch() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function' || !supabase) return
  installed = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    let url = ''
    try { url = typeof input === 'string' ? input : String(input?.url || '') } catch {}
    let isAnaApi = false
    try {
      const parsed = new URL(url, window.location.origin)
      isAnaApi = parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')
    } catch {}

    if (!isAnaApi) return nativeFetch(input, init)

    const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {})
    if (!headers.has('Authorization')) {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (token) headers.set('Authorization', `Bearer ${token}`)
      } catch {}
    }
    return nativeFetch(input, { ...init, headers })
  }
}
