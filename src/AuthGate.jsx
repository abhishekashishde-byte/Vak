import { useEffect, useState } from 'react'
import Workspace from './Workspace.jsx'
import AuthPage from './AuthPage.jsx'
import { authConfigured, supabase } from './lib/supabase'
import { hydrateAndStartAccountPersistence, stopAccountPersistence } from './accountDataPersistence.js'

const AUTH_EVENT_KEY = 'ana-pending-admin-auth-event'

async function notifyAdmin(event, session) {
  const token = session?.access_token
  if (!token) return

  try {
    await fetch('/api/auth-notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event }),
      keepalive: true,
    })
  } catch {
    // Authentication must never fail because an admin notification could not be delivered.
  }
}

function consumePendingAuthEvent() {
  try {
    const event = sessionStorage.getItem(AUTH_EVENT_KEY)
    sessionStorage.removeItem(AUTH_EVENT_KEY)
    return event === 'signup' ? 'signup' : 'login'
  } catch {
    return 'login'
  }
}

export default function AuthGate() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!authConfigured)

  useEffect(() => {
    if (!authConfigured || !supabase) return

    let active = true
    let initialising = true
    let persistenceUserId = ''
    let persistencePromise = Promise.resolve()
    const forceFreshLogin = (() => {
      try {
        const url = new URL(window.location.href)
        const shouldForce = url.searchParams.get('auth') === 'login'
        if (shouldForce) {
          url.searchParams.delete('auth')
          window.history.replaceState({}, '', url.pathname + url.search + url.hash)
        }
        return shouldForce
      } catch {
        return false
      }
    })()

    const startPersistence = user => {
      if (!user?.id) return Promise.resolve()
      if (persistenceUserId === user.id) return persistencePromise
      persistenceUserId = user.id
      persistencePromise = hydrateAndStartAccountPersistence(user).catch(error => {
        console.warn('[Ana persistence] startup failed', error?.message || error)
      })
      return persistencePromise
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return

      if (forceFreshLogin && data.session) {
        stopAccountPersistence()
        await supabase.auth.signOut()
        if (!active) return
        setSession(null)
        initialising = false
        setReady(true)
        return
      }

      const nextSession = data.session || null
      setSession(nextSession)
      if (nextSession?.user) await startPersistence(nextSession.user)
      else stopAccountPersistence()
      if (!active) return
      initialising = false
      setReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession || null)

      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        persistenceUserId = ''
        persistencePromise = Promise.resolve()
        stopAccountPersistence()
        if (!initialising) setReady(true)
        return
      }

      if (event === 'SIGNED_IN') {
        const adminEvent = consumePendingAuthEvent()
        setTimeout(() => notifyAdmin(adminEvent, nextSession), 0)
      }

      // Auth also emits token-refresh and metadata events. Start/sustain persistence,
      // but never put an already-open workspace back into a loading state.
      startPersistence(nextSession.user)
      if (!initialising) setReady(true)
    })

    return () => {
      active = false
      stopAccountPersistence()
      data.subscription.unsubscribe()
    }
  }, [])

  if (!ready) {
    return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',background:'#f4f1ea',color:'#777169',fontFamily:'Inter,system-ui,sans-serif'}}>Loading Ana…</main>
  }

  if (!session) return <AuthPage />
  return <Workspace />
}
