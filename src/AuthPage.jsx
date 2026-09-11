import { useState } from 'react'
import { authConfigured, supabase } from './lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!authConfigured || !supabase) {
      setError('Ana authentication is not configured yet.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      if (mode === 'signup') {
        if (!name.trim() || !location.trim()) throw new Error('Please enter your name and location.')

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              name: name.trim(),
              location: location.trim(),
            },
          },
        })

        if (signUpError) throw signUpError

        if (data?.session) return

        setSuccess('Account created. You can sign in with your email and password.')
        setMode('login')
        setPassword('')
        return
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (loginError) throw loginError
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return <main style={s.page}>
    <section style={s.card}>
      <div style={s.logo}>
        <img src="/ana-logo.svg" alt="Ana" style={s.logoMark}/>
        <div><strong style={s.wordmark}>Ana</strong><div style={s.tagline}>Your voice, in any language</div></div>
      </div>

      <h1 style={s.title}>{mode === 'login' ? 'Welcome back.' : 'Create your Ana account.'}</h1>
      <p style={s.subtitle}>{mode === 'login' ? 'Sign in with your email and password.' : 'Create your account and start using Ana.'}</p>

      <div style={s.tabs}>
        <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess('') }} style={{...s.tab, ...(mode === 'login' ? s.tabActive : {})}}>Sign in</button>
        <button type="button" onClick={() => { setMode('signup'); setError(''); setSuccess('') }} style={{...s.tab, ...(mode === 'signup' ? s.tabActive : {})}}>Create account</button>
      </div>

      <form onSubmit={submit} style={s.form}>
        {mode === 'signup' && <>
          <Field label="Name" value={name} onChange={setName} type="text" autoComplete="name" placeholder="Your name" />
          <Field label="Location" value={location} onChange={setLocation} type="text" autoComplete="address-level2" placeholder="City, country" />
        </>}

        <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Minimum 8 characters" minLength={8} />

        {error && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}

        <button type="submit" style={{...s.primary, ...(loading ? s.disabled : {})}} disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p style={s.note}>{mode === 'signup' ? 'Your account will be ready immediately after signup.' : 'Use the email and password you registered with.'}</p>
    </section>
  </main>
}

function Field({ label, value, onChange, ...props }) {
  return <label style={s.field}>
    <span style={s.label}>{label}</span>
    <input {...props} required value={value} onChange={e => onChange(e.target.value)} style={s.input}/>
  </label>
}

const texture = 'linear-gradient(rgba(255,255,255,.35),rgba(255,255,255,.35)), repeating-radial-gradient(circle at 17% 22%,rgba(71,63,49,.045) 0 1px,transparent 1px 3px), repeating-linear-gradient(112deg,rgba(76,66,50,.03) 0 1px,transparent 1px 4px)'
const s = {
  page:{minHeight:'100dvh',display:'grid',placeItems:'center',padding:'28px 22px',backgroundColor:'#f4f1ea',backgroundImage:texture,color:'#171717'},
  card:{width:'100%',maxWidth:460,padding:'38px 30px',border:'1px solid rgba(43,39,33,.12)',borderRadius:24,background:'rgba(255,255,255,.52)',backdropFilter:'blur(10px)',boxShadow:'0 24px 70px rgba(70,58,42,.08)'},
  logo:{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginBottom:34,textAlign:'left'},logoMark:{width:46,height:46,objectFit:'contain'},wordmark:{fontSize:24,lineHeight:1},tagline:{fontSize:10,color:'#777169',marginTop:5},
  title:{margin:0,textAlign:'center',fontSize:'clamp(30px,7vw,44px)',lineHeight:1,letterSpacing:'-.05em',fontWeight:650},subtitle:{margin:'13px auto 24px',maxWidth:360,textAlign:'center',color:'#7a7369',fontSize:13,lineHeight:1.55},
  tabs:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,padding:4,borderRadius:12,background:'rgba(79,69,55,.08)',marginBottom:20},tab:{border:0,borderRadius:9,padding:'10px 12px',background:'transparent',color:'#7c7469',cursor:'pointer',fontWeight:600},tabActive:{background:'#fffdfa',color:'#171717',boxShadow:'0 2px 9px rgba(57,48,37,.08)'},
  form:{display:'flex',flexDirection:'column',gap:14},field:{display:'flex',flexDirection:'column',gap:6},label:{fontSize:11,fontWeight:650,color:'#6f675d'},input:{width:'100%',height:48,border:'1px solid rgba(43,39,33,.15)',borderRadius:11,background:'rgba(255,253,250,.82)',padding:'0 13px',color:'#171717',outline:'none',fontSize:15},
  primary:{width:'100%',minHeight:50,border:0,borderRadius:12,background:'#171717',color:'#fffdfa',fontWeight:700,cursor:'pointer',marginTop:2},disabled:{opacity:.6,cursor:'wait'},
  error:{padding:'10px 12px',borderRadius:10,border:'1px solid #dfbfc1',background:'#fff2f3',color:'#9a3f46',fontSize:12,lineHeight:1.45},success:{padding:'11px 12px',borderRadius:10,border:'1px solid #c9d9c3',background:'#f3faef',color:'#43663b',fontSize:12,lineHeight:1.45},note:{margin:'18px 0 0',textAlign:'center',color:'#938b80',fontSize:11}
}
