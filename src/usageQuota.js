import { supabase } from './lib/supabase.js'

export const ANA_ADMIN_EMAIL = 'abhishekashish15@gmail.com'

const rpcError = (error, fallback) => {
  const message = String(error?.message || '')
  if (message.includes('ANA_QUOTA_EXCEEDED')) return new Error('You have reached this week’s tester limit.')
  if (message.includes('ANA_DOCUMENT_TOO_LONG')) return new Error('Tester documents are limited to 10 pages each.')
  if (message.includes('ANA_AUTH_REQUIRED')) return new Error('Please sign in again.')
  return new Error(message || fallback)
}

const emitUsage = status => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ana-usage-updated', { detail: status || null }))
  }
}

export async function getQuotaStatus() {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { data, error } = await supabase.rpc('ana_quota_status')
  if (error) throw rpcError(error, 'Could not load tester usage.')
  return data
}

export async function refreshQuotaStatus() {
  const status = await getQuotaStatus()
  emitUsage(status)
  return status
}

export async function startTimedUsage(kind) {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { data, error } = await supabase.rpc('ana_start_timed_usage', { p_kind: kind })
  if (error) throw rpcError(error, 'Could not start this tester session.')
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.session_id) throw new Error('Ana could not create a tester usage session.')
  emitUsage(null)
  return {
    sessionId: row.session_id,
    remainingSeconds: Number(row.remaining_seconds || 0),
    limitSeconds: Number(row.limit_seconds || 0),
    isAdmin: Boolean(row.is_admin),
  }
}

export async function heartbeatTimedUsage(sessionId) {
  if (!supabase || !sessionId) return null
  const { data, error } = await supabase.rpc('ana_heartbeat_timed_usage', { p_session_id: sessionId })
  if (error) throw rpcError(error, 'Could not update tester usage.')
  const row = Array.isArray(data) ? data[0] : data
  return row ? {
    allowed: Boolean(row.allowed),
    remainingSeconds: Number(row.remaining_seconds || 0),
    usedSeconds: Number(row.used_seconds || 0),
    limitSeconds: Number(row.limit_seconds || 0),
    isAdmin: Boolean(row.is_admin),
  } : null
}

export async function endTimedUsage(sessionId) {
  if (!supabase || !sessionId) return null
  const { data, error } = await supabase.rpc('ana_end_timed_usage', { p_session_id: sessionId })
  if (error) throw rpcError(error, 'Could not close tester usage.')
  emitUsage(data || null)
  return data
}

export async function startDocumentUsage(pageCount, fileName = '') {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { data, error } = await supabase.rpc('ana_start_document_usage', {
    p_page_count: Math.max(1, Number(pageCount) || 1),
    p_file_name: String(fileName || '').slice(0, 240),
  })
  if (error) throw rpcError(error, 'Could not start this document translation.')
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.usage_id) throw new Error('Ana could not reserve a document translation.')
  emitUsage(null)
  return {
    usageId: row.usage_id,
    remainingDocuments: Number(row.remaining_documents || 0),
    isAdmin: Boolean(row.is_admin),
  }
}

export async function finishDocumentUsage(usageId, success) {
  if (!supabase || !usageId) return null
  const { data, error } = await supabase.rpc('ana_finish_document_usage', {
    p_usage_id: usageId,
    p_success: Boolean(success),
  })
  if (error) throw rpcError(error, 'Could not update document usage.')
  emitUsage(data || null)
  return data
}

export async function authenticatedHeaders(extra = {}) {
  if (!supabase) throw new Error('Ana account services are unavailable.')
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again.')
  return { ...extra, Authorization: `Bearer ${token}` }
}

export function testerLimitLabel(seconds) {
  const totalMinutes = Math.max(0, Math.ceil(Number(seconds || 0) / 60))
  if (totalMinutes >= 120 && totalMinutes % 60 === 0) return `${totalMinutes / 60}h`
  return `${totalMinutes}m`
}
