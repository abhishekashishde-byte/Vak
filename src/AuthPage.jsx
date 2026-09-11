import { useState } from 'react'
import { Languages } from 'lucide-react'
import { authConfigured, supabase } from './lib/supabase'

function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.4h5.52a4.7 4.7 0 0 1-2.05 3.08l-.02.11 2.98 2.31.21.02c1.93-1.78 2.96-4.4 2.96-7.12Z"/>
    <path fill="#34A853" d="M12 22c2.69 0 4.95-.89 6.64-2.42l-3.17-2.44c-.85.57-1.95.97-3.47.97-2.59 0-4.79-1.75-5.58-4.17l-.1.01-3.1 2.4-.04.1A10 10 0 0 0 12 22Z"/>
    <path fill="#FBBC05" d="M6.42 13.94A6.1 6.1 0 0 1 6.08 12c0-.67.12-1.32.33-1.93v-.12L3.27 7.51l-.1.05A10 10 0 0 0 2 12c0 1.59.38 3.1 1.18 4.44l3.24-2.5Z"/>
    <path fill="#EA4335" d="M12 5.89c1.87 0 3.13.81 3.85 1.48l2.85-2.78C16.95 2.96 14.69 2 12 2a10 10 0 0 0-8.82 5.56l3.23 2.51C7.21 7.64 9.41 5.89 12 5.89Z"/>
  </svg>
}

export default function AuthPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const signInWithGoogle = async () => {
    if (!authConfigured || !supabase) {
      setError('Google sign-in is not configured yet.')
      return
    }

    setLoading(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  return <main style={s.page}>
    <section style={s.card}>
      <div style={s.logo}><div style={s.mark}>V</div><span>Vak</span></div>
      <div style={s.iconWrap}><Languages size={28}/></div>
      <h1 style={s.title}>Speak beyond language.</h1>
      <p style={s.subtitle}>Sign in to translate naturally, refine every word, and keep your language preferences with you.</p>

      <button style={{...s.googleButton, ...(loading ? s.disabled : {})}} onClick={signInWithGoogle} disabled={loading}>
        <GoogleIcon />
        <span>{loading ? 'Connecting…' : 'Continue with Google'}</span>
      </button>

      {error && <div style={s.error}>{error}</div>}
      <p style={s.note}>Your translation workspace is private to your account.</p>
    </section>
  </main>
}

const s = {
  page: {
    minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px',
    background: 'radial-gradient(circle at 50% -10%, #202025 0, #0d0d10 38%, #09090b 66%)',
    color: '#f5f5f5',
  },
  card: { width: '100%', maxWidth: 420, textAlign: 'center' },
  logo: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 56, fontWeight: 700, fontSize: 18 },
  mark: { width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg,#fff,#a5a5aa)', color: '#0b0b0d', fontFamily: 'Georgia, serif', fontWeight: 800 },
  iconWrap: { width: 58, height: 58, display: 'grid', placeItems: 'center', margin: '0 auto 20px', border: '1px solid #2f2f35', borderRadius: 18, background: '#151517', color: '#b7b7c0' },
  title: { margin: 0, fontSize: 'clamp(34px,8vw,48px)', lineHeight: 1.02, letterSpacing: '-.055em', fontWeight: 650 },
  subtitle: { margin: '16px auto 30px', maxWidth: 360, color: '#8f8f99', fontSize: 14, lineHeight: 1.55 },
  googleButton: { width: '100%', minHeight: 50, border: '1px solid #d7d7db', borderRadius: 12, background: '#f4f4f5', color: '#151517', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, fontWeight: 650, cursor: 'pointer' },
  disabled: { opacity: .65, cursor: 'wait' },
  error: { marginTop: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid #552d32', background: '#211315', color: '#f0a9b1', fontSize: 12 },
  note: { marginTop: 20, color: '#5f5f68', fontSize: 11 },
}
