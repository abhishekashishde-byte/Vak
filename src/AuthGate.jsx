import { useEffect, useState } from 'react'
import Workspace from './Workspace.jsx'
import AuthPage from './AuthPage.jsx'
import { authConfigured, supabase } from './lib/supabase'

export default function AuthGate() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!authConfigured)

  useEffect(() => {
    if (!authConfigured || !supabase) return

    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session || null)
      setReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null)
      setReady(true)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  if (!ready) {
    return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',background:'#f4f1ea',color:'#777169',fontFamily:'Inter,system-ui,sans-serif'}}>Loading Ana…</main>
  }

  if (!session) return <AuthPage />
  return <Workspace />
}
