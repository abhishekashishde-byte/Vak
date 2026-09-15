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

    const applySession = async nextSession => {
      if (!active) return
      setReady(false)
      setSession(nextSession || null)
      try {
        if (nextSession?.user) await hydrateAndStartAccountPersistence(nextSession.user)
        else stopAccountPersistence()
      } catch (error) {
        console.warn('[Ana persistence] startup failed', error?.message || error)
      } finally {
        if (active) setReady(true)
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session || null))

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(() => applySession(nextSession || null), 0)
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
