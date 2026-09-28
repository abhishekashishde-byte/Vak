import { useState } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import { supabase } from './lib/supabase.js'

const CATEGORIES = [
  ['bug','Bug'],
  ['slow','Slow'],
  ['wrong_translation','Wrong translation'],
  ['ui','UI problem'],
  ['feature','Feature idea'],
]

function diagnosticsFor(mode) {
  return {
    appVersion: String(import.meta.env.VITE_APP_VERSION || 'web-beta').slice(0, 40),
    mode: String(mode || '').slice(0, 40),
    online: navigator.onLine,
    platform: String(navigator.userAgentData?.platform || navigator.platform || '').slice(0, 80),
    browser: String(navigator.userAgent || '').slice(0, 300),
    viewport: String(window.innerWidth) + 'x' + String(window.innerHeight),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    timestamp: new Date().toISOString(),
  }
}

export default function FeedbackPanel({ open, onClose, mode }) {
  const [category, setCategory] = useState('bug')
  const [message, setMessage] = useState('')
  const [attachDiagnostics, setAttachDiagnostics] = useState(true)
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  if (!open) return null

  const submit = async () => {
    if (message.trim().length < 3 || state === 'sending') return
    setState('sending')
    setError('')
    try {
      const { data } = await supabase.auth.getUser()
      if (!data?.user?.id) throw new Error('Please sign in again.')
      const { error: insertError } = await supabase.from('ana_feedback').insert({
        user_id: data.user.id,
        category,
        message: message.trim().slice(0, 3000),
        diagnostics: attachDiagnostics ? diagnosticsFor(mode) : {},
      })
      if (insertError) throw insertError
      setState('sent')
      setMessage('')
    } catch (err) {
      setError(err?.message || 'Feedback could not be sent.')
      setState('idle')
    }
  }

  return <div style={s.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose?.() }}>
    <section style={s.card}>
      <header style={s.head}>
        <div><small style={s.kicker}>EARLY ACCESS</small><h2 style={s.title}>Send feedback</h2></div>
        <button style={s.iconButton} onClick={onClose} aria-label="Close feedback"><X size={18}/></button>
      </header>
      {state === 'sent' ? <div style={s.sent}>
        <MessageSquareText size={24}/><strong>Thank you.</strong><span>Your feedback was saved.</span><button style={s.primary} onClick={onClose}>Close</button>
      </div> : <>
        <label style={s.field}><span>What happened?</span><select value={category} onChange={e => setCategory(e.target.value)} style={s.input}>{CATEGORIES.map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label style={s.field}><span>Tell us what you noticed</span><textarea value={message} onChange={e => setMessage(e.target.value)} style={{...s.input,minHeight:120,paddingTop:12}} placeholder="Describe the problem or idea. Avoid confidential information unless it is necessary."/></label>
        <label style={s.check}><input type="checkbox" checked={attachDiagnostics} onChange={e => setAttachDiagnostics(e.target.checked)}/><span><b>Attach technical diagnostics</b><small style={{display:'block',marginTop:3}}>App version, device/browser, Ana mode, network state and screen size only. Ana does not attach your translation, transcript, photo, clipboard or audio.</small></span></label>
        {error && <div style={s.error}>{error}</div>}
        <button style={{...s.primary,opacity:message.trim().length>=3?1:.45}} disabled={message.trim().length<3 || state==='sending'} onClick={submit}>{state==='sending'?'Sending…':'Send feedback'}</button>
      </>}
    </section>
  </div>
}

const s = {
  backdrop:{position:'fixed',inset:0,zIndex:1000,display:'grid',placeItems:'center',padding:18,background:'rgba(10,10,10,.48)',backdropFilter:'blur(7px)'},
  card:{width:'100%',maxWidth:520,maxHeight:'90dvh',overflow:'auto',padding:24,borderRadius:22,background:'#fffdfa',color:'#171717',boxShadow:'0 30px 90px rgba(0,0,0,.25)',fontFamily:'Inter,system-ui,sans-serif'},
  head:{display:'flex',justifyContent:'space-between',gap:16,alignItems:'start',marginBottom:18},
  kicker:{fontSize:10,fontWeight:850,letterSpacing:'.13em',color:'#81786d'},
  title:{fontSize:28,margin:'4px 0 0'},
  iconButton:{border:0,background:'transparent',cursor:'pointer'},
  field:{display:'flex',flexDirection:'column',gap:6,margin:'12px 0',fontSize:12,fontWeight:700,color:'#655e56'},
  input:{width:'100%',minHeight:46,border:'1px solid rgba(40,35,30,.16)',borderRadius:11,background:'#fff',padding:'0 11px',font:'inherit',fontSize:14,color:'#171717'},
  check:{display:'flex',gap:10,alignItems:'flex-start',padding:'12px 0',fontSize:13,lineHeight:1.4},
  primary:{width:'100%',minHeight:48,border:0,borderRadius:12,background:'#171717',color:'#fff',fontWeight:750,cursor:'pointer'},
  error:{padding:'9px 11px',borderRadius:10,background:'#fff0f1',color:'#993c44',fontSize:12},
  sent:{display:'flex',flexDirection:'column',alignItems:'center',textAlign:'center',gap:8,padding:'20px 4px'},
}
