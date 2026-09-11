import { useState } from 'react'
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
    if (!authConfigured || !supabase) { setError('Google sign-in is not configured yet.'); return }
    setLoading(true); setError('')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { access_type: 'offline', prompt: 'consent' } },
    })
    if (authError) { setError(authError.message); setLoading(false) }
  }

  return <main style={s.page}>
    <section style={s.card}>
      <div style={s.logo}><img src="/ana-logo.svg" alt="Ana" style={s.logoMark}/><div><strong style={s.wordmark}>Ana</strong><div style={s.tagline}>Your voice, in any language</div></div></div>
      <h1 style={s.title}>Speak naturally.<br/>Be understood.</h1>
      <p style={s.subtitle}>Sign in to translate with context, tone and terminology that feels like you.</p>
      <button style={{...s.googleButton, ...(loading ? s.disabled : {})}} onClick={signInWithGoogle} disabled={loading}><GoogleIcon/><span>{loading ? 'Connecting…' : 'Continue with Google'}</span></button>
      {error && <div style={s.error}>{error}</div>}
      <p style={s.note}>Your translation workspace is private to your account.</p>
    </section>
  </main>
}

const texture = 'linear-gradient(rgba(255,255,255,.35),rgba(255,255,255,.35)), repeating-radial-gradient(circle at 17% 22%,rgba(71,63,49,.045) 0 1px,transparent 1px 3px), repeating-linear-gradient(112deg,rgba(76,66,50,.03) 0 1px,transparent 1px 4px)'
const s = {
  page:{minHeight:'100dvh',display:'grid',placeItems:'center',padding:'28px 22px',backgroundColor:'#f4f1ea',backgroundImage:texture,color:'#171717'},
  card:{width:'100%',maxWidth:430,textAlign:'center',padding:'44px 32px',border:'1px solid rgba(43,39,33,.12)',borderRadius:24,background:'rgba(255,255,255,.48)',backdropFilter:'blur(10px)',boxShadow:'0 24px 70px rgba(70,58,42,.08)'},
  logo:{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginBottom:52,textAlign:'left'},logoMark:{width:48,height:48,objectFit:'contain'},wordmark:{fontSize:24,lineHeight:1},tagline:{fontSize:10,color:'#777169',marginTop:5},
  title:{margin:0,fontSize:'clamp(38px,8vw,54px)',lineHeight:.98,letterSpacing:'-.055em',fontWeight:650},subtitle:{margin:'17px auto 30px',maxWidth:350,color:'#7a7369',fontSize:14,lineHeight:1.55},
  googleButton:{width:'100%',minHeight:52,border:'1px solid rgba(43,39,33,.16)',borderRadius:12,background:'#fffdfa',color:'#171717',display:'flex',alignItems:'center',justifyContent:'center',gap:11,fontWeight:650,cursor:'pointer',boxShadow:'0 8px 20px rgba(57,48,37,.05)'},disabled:{opacity:.65,cursor:'wait'},
  error:{marginTop:14,padding:'10px 12px',borderRadius:10,border:'1px solid #dfbfc1',background:'#fff2f3',color:'#9a3f46',fontSize:12},note:{marginTop:20,color:'#938b80',fontSize:11}
}
