import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from './lib/supabase.js'
import { CONSENT_VERSIONS, recordConsentEvent } from './consentEvents.js'

export const BETA_TERMS_VERSION = 'beta-18-plus-v1-2026-09-28'

export function hasBetaAcceptance(user) {
  const value = user?.user_metadata?.ana_beta_acceptance
  return Boolean(value?.age_18_plus === true && value?.version === BETA_TERMS_VERSION)
}

export default function BetaAccessGate({ user, onAccepted }) {
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const accept = async () => {
    if (!checked || !supabase || saving) return
    setSaving(true)
    setError('')
    try {
      const acceptance = {
        version: BETA_TERMS_VERSION,
        age_18_plus: true,
        accepted_at: new Date().toISOString(),
      }
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: { ana_beta_acceptance: acceptance },
      })
      if (updateError) throw updateError
      await recordConsentEvent('beta_18_plus', 'confirmed', CONSENT_VERSIONS.beta18, { earlyAccess: true })
      onAccepted?.(data?.user || user)
    } catch (err) {
      setError(err?.message || 'Ana could not save this confirmation.')
    } finally {
      setSaving(false)
    }
  }

  return <main style={s.page}>
    <section style={s.card}>
      <ShieldCheck size={30}/>
      <div><small style={s.kicker}>ANA EARLY ACCESS</small><h1 style={s.title}>One confirmation before you continue.</h1></div>
      <p style={s.copy}>Ana is currently a beta service. Availability is not guaranteed, and Ana is a communication aid — not a substitute for professional medical, legal or financial decisions.</p>
      <label style={s.check}>
        <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)}/>
        <span>I confirm that I am 18 or older and understand that Ana is currently an early-access beta.</span>
      </label>
      {error && <div style={s.error}>{error}</div>}
      <button style={{...s.button, opacity: checked && !saving ? 1 : .45}} disabled={!checked || saving} onClick={accept}>{saving ? 'Saving…' : 'Continue to Ana'}</button>
    </section>
  </main>
}

const s = {
  page:{minHeight:'100dvh',display:'grid',placeItems:'center',padding:24,background:'#f4f1ea',color:'#171717',fontFamily:'Inter,system-ui,sans-serif'},
  card:{width:'100%',maxWidth:520,padding:32,border:'1px solid rgba(43,39,33,.12)',borderRadius:24,background:'#fffdfa',boxShadow:'0 24px 70px rgba(70,58,42,.08)',display:'flex',flexDirection:'column',gap:16},
  kicker:{fontWeight:800,letterSpacing:'.13em',color:'#82796e'},
  title:{margin:'5px 0 0',fontSize:34,lineHeight:1.04,letterSpacing:'-.04em'},
  copy:{margin:0,color:'#6f675d',lineHeight:1.55},
  check:{display:'flex',gap:11,alignItems:'flex-start',padding:14,border:'1px solid rgba(43,39,33,.12)',borderRadius:14,lineHeight:1.45,fontSize:14},
  button:{minHeight:50,border:0,borderRadius:12,background:'#171717',color:'#fff',fontWeight:750,cursor:'pointer'},
  error:{fontSize:12,color:'#9a3f46'},
}
