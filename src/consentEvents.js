import { supabase } from './lib/supabase.js'

export const CONSENT_VERSIONS = {
  meeting: 'meeting-recording-v2-2026-09-28',
  audioRetention: 'meeting-audio-retention-v1-2026-09-28',
  talkAi: 'talk-ai-disclosure-v1-2026-09-13',
  beta18: 'beta-18-plus-v1-2026-09-28',
}

export async function recordConsentEvent(consentType, outcome, noticeVersion, context = {}) {
  if (!supabase) return false
  try {
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user?.id) return false
    const safeContext = context && typeof context === 'object'
      ? Object.fromEntries(Object.entries(context).slice(0, 12).map(([key, value]) => [
          String(key).slice(0, 60),
          typeof value === 'string' ? value.slice(0, 160) : (typeof value === 'number' || typeof value === 'boolean' ? value : undefined),
        ]).filter(([, value]) => value !== undefined))
      : {}
    const { error } = await supabase.from('ana_consent_events').insert({
      user_id: user.id,
      consent_type: consentType,
      notice_version: String(noticeVersion || '').slice(0, 120),
      outcome,
      context: safeContext,
    })
    if (error) throw error
    return true
  } catch (error) {
    console.warn('[Ana consent receipt]', error?.message || error)
    return false
  }
}
