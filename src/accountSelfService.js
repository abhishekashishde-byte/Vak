import { supabase } from './lib/supabase.js'

const TABLES = [
  'glossary_entries',
  'keyboard_learning_entries',
  'meeting_records',
  'meeting_actions',
  'meeting_action_routes',
  'ana_timed_usage_sessions',
  'ana_document_usage',
  'ana_ai_usage_events',
  'ana_consent_events',
  'ana_feedback',
  'ana_notes',
]

function safeMetadata(metadata = {}) {
  const copy = { ...metadata }
  if (copy.google_gmail && typeof copy.google_gmail === 'object') {
    copy.google_gmail = {
      email: String(copy.google_gmail.email || ''),
      connected_at: String(copy.google_gmail.connected_at || ''),
      scope: String(copy.google_gmail.scope || ''),
      connected: Boolean(copy.google_gmail.refresh_token),
    }
  }
  return copy
}

export async function exportAnaAccountData() {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) throw new Error('Please sign in again.')
  const user = userData.user

  const records = {}
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    records[table] = error ? { error: 'Could not export this section.' } : (data || [])
  }

  let retainedAudio = []
  try {
    const { data } = await supabase.storage.from('ana-meeting-audio').list(user.id, { limit: 1000 })
    retainedAudio = (data || []).map(item => ({
      name: item.name,
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      size: item.metadata?.size || null,
    }))
  } catch {}

  return {
    exportedAt: new Date().toISOString(),
    product: 'Ana',
    account: {
      id: user.id,
      email: user.email || '',
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      metadata: safeMetadata(user.user_metadata || {}),
    },
    retainedAudio,
    records,
  }
}

export function downloadAnaData(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ana-data-export-' + new Date().toISOString().slice(0, 10) + '.json'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function deleteAnaAccount() {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { error } = await supabase.rpc('ana_delete_my_account', { p_confirmation: 'DELETE' })
  if (error) throw error
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ana-')) localStorage.removeItem(key)
  } catch {}
  try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
  return true
}
