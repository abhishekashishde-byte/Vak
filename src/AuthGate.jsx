import { useEffect, useState } from 'react'
import App from './App.jsx'
import AuthPage from './AuthPage.jsx'
import { authConfigured, supabase } from './lib/supabase'

export default function AuthGate() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!authConfigured)

  useEffect(() => {
    if (!authConfigured || !supabase) return

    let active = true

    const acceptSession = async (nextSession) => {
      if (!active) return
      if (nextSession?.user && !nextSession.user.email_confirmed_at) {
        await supabase.auth.signOut()
        if (active) setSession(null)
      } else if (active) {
        setSession(nextSession || null)
      }
      if (active) setReady(true)
    }

    supabase.auth.getSession().then(({ data }) => acceptSession(data.session || null))

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      acceptSession(nextSession || null)
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
  return <App />
}
