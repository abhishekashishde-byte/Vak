import { useEffect, useState } from 'react'
import Workspace from './Workspace.jsx'
import AuthPage from './AuthPage.jsx'
import { authConfigured, supabase } from './lib/supabase'
import { hydrateAndStartAccountPersistence, stopAccountPersistence } from './accountDataPersistence.js'

export default function AuthGate() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!authConfigured)

  useEffect(() => {
    if (!authConfigured || !supabase) return

    let active = true
    let persistenceUserId = ''

    const startPersistence = user => {
      if (!user?.id || persistenceUserId === user.id) return
      persistenceUserId = user.id
      hydrateAndStartAccountPersistence(user).catch(error => {
        console.warn('[Ana persistence] startup failed', error?.message || error)
      })
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      const nextSession = data.session || null
      setSession(nextSession)
      setReady(true)
      if (nextSession?.user) startPersistence(nextSession.user)
      else stopAccountPersistence()
    })

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return

      // Auth emits events for token refreshes and user-metadata updates too.
      // Never put Ana back into the loading screen for those events: doing so
      // unmounts the workspace and makes the UI look like it refreshes constantly.
      setSession(nextSession || null)
      setReady(true)

      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        persistenceUserId = ''
        stopAccountPersistence()
        return
      }

      startPersistence(nextSession.user)
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
