import { supabase } from './lib/supabase.js'

const GLOSSARY_KEY = 'ana-glossary-v1'
const MEETING_HISTORY_KEY = 'ana-meeting-history-v1'
const GLOSSARY_LIMIT = 100
const MEETING_LIMIT = 200

let activeUserId = ''
let watcher = null
let syncingGlossary = false
let syncingMeetings = false
let lastGlossarySignature = ''
let lastMeetingSignature = ''

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

const stableStringify = value => {
  try { return JSON.stringify(value) } catch { return '' }
}

const makeClientId = prefix => {
  try { return crypto.randomUUID() } catch { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
}

const cleanGlossary = input => {
  if (!Array.isArray(input)) return []
  const byKey = new Map()
  for (const raw of input) {
    const target = String(raw?.target || '').trim().slice(0, 64)
    const source = String(raw?.source || '').trim().slice(0, 300)
    const preferred = String(raw?.preferred || '').trim().slice(0, 300)
    if (!target || !source || !preferred) continue
    const key = `${target}\u0000${source.toLocaleLowerCase()}`
    byKey.set(key, {
      id: String(raw?.id || raw?.client_id || makeClientId('glossary')),
      target,
      source,
      preferred,
    })
  }
  return [...byKey.values()].slice(-GLOSSARY_LIMIT)
}

const mergeGlossaries = (...lists) => cleanGlossary(lists.flatMap(list => Array.isArray(list) ? list : []))

const toMillis = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

const cleanMeeting = raw => {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || raw.client_id || makeClientId('meeting'))
  const startedAt = toMillis(raw.startedAt ?? raw.started_at)
  const endedAt = toMillis(raw.endedAt ?? raw.ended_at)
  const notes = raw.notes && typeof raw.notes === 'object' ? raw.notes : null
  return {
    id,
    title: String(raw.title || 'Meeting').trim() || 'Meeting',
    startedAt: startedAt || endedAt || Date.now(),
    endedAt: endedAt || startedAt || Date.now(),
    durationMs: Math.max(0, Number(raw.durationMs ?? raw.duration_ms) || 0),
    target: String(raw.target || '').trim(),
    source: String(raw.source || '').trim(),
    notes,
    originalText: String(raw.originalText ?? raw.original_text ?? ''),
    translatedText: String(raw.translatedText ?? raw.translated_text ?? ''),
  }
}

const cleanMeetings = input => {
  if (!Array.isArray(input)) return []
  const byId = new Map()
  for (const raw of input) {
    const item = cleanMeeting(raw)
    if (item) byId.set(item.id, item)
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
    .slice(0, MEETING_LIMIT)
}

const mergeMeetings = (...lists) => cleanMeetings(lists.flatMap(list => Array.isArray(list) ? list : []))

async function getUser() {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data?.user || null
}

async function loadRemoteGlossary(user) {
  const { data, error } = await supabase
    .from('glossary_entries')
    .select('id,client_id,target,source,preferred,updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: true })
    .limit(GLOSSARY_LIMIT)
  if (error) throw error
  return cleanGlossary((data || []).map(item => ({
    id: item.client_id || item.id,
    target: item.target,
    source: item.source,
    preferred: item.preferred,
  })))
}

async function syncGlossary(user, glossary) {
  if (!supabase || !user || syncingGlossary) return
  syncingGlossary = true
  try {
    const items = cleanGlossary(glossary)
    if (items.length) {
      const rows = items.map(item => ({
        user_id: user.id,
        client_id: item.id,
        target: item.target,
        source: item.source,
        preferred: item.preferred,
      }))
      const { error } = await supabase
        .from('glossary_entries')
        .upsert(rows, { onConflict: 'user_id,client_id' })
      if (error) throw error
    }

    const { data: existing, error: readError } = await supabase
      .from('glossary_entries')
      .select('client_id')
      .eq('user_id', user.id)
    if (readError) throw readError

    const keep = new Set(items.map(item => item.id))
    const remove = (existing || []).map(item => item.client_id).filter(id => id && !keep.has(id))
    if (remove.length) {
      const { error } = await supabase
        .from('glossary_entries')
        .delete()
        .eq('user_id', user.id)
        .in('client_id', remove)
      if (error) throw error
    }
  } catch (error) {
    console.warn('[Ana persistence] glossary sync failed', error?.message || error)
  } finally {
    syncingGlossary = false
  }
}

async function loadRemoteMeetings(user) {
  const { data, error } = await supabase
    .from('meeting_records')
    .select('client_id,title,started_at,ended_at,duration_ms,target,source,notes,original_text,translated_text,updated_at')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(MEETING_LIMIT)
  if (error) throw error
  return cleanMeetings(data || [])
}

async function syncMeetings(user, meetings) {
  if (!supabase || !user || syncingMeetings) return
  syncingMeetings = true
  try {
    const items = cleanMeetings(meetings)
    if (!items.length) return
    const rows = items.map(item => ({
      user_id: user.id,
      client_id: item.id,
      title: item.title,
      started_at: item.startedAt ? new Date(item.startedAt).toISOString() : null,
      ended_at: item.endedAt ? new Date(item.endedAt).toISOString() : null,
      duration_ms: Math.max(0, Number(item.durationMs) || 0),
      target: item.target || null,
      source: item.source || null,
      notes: item.notes,
      original_text: item.originalText || '',
      translated_text: item.translatedText || '',
    }))
    const { error } = await supabase
      .from('meeting_records')
      .upsert(rows, { onConflict: 'user_id,client_id' })
    if (error) throw error
  } catch (error) {
    console.warn('[Ana persistence] meeting sync failed', error?.message || error)
  } finally {
    syncingMeetings = false
  }
}

async function hydrate(user) {
  if (!supabase || !user) return

  const localGlossary = cleanGlossary(readJson(GLOSSARY_KEY, []))
  const metadataGlossary = cleanGlossary(user.user_metadata?.ana_preferences?.glossary || [])
  let remoteGlossary = []
  try { remoteGlossary = await loadRemoteGlossary(user) } catch (error) {
    console.warn('[Ana persistence] glossary load failed', error?.message || error)
  }
  const glossary = mergeGlossaries(remoteGlossary, metadataGlossary, localGlossary)
  writeJson(GLOSSARY_KEY, glossary)
  lastGlossarySignature = stableStringify(glossary)
  await syncGlossary(user, glossary)

  const localMeetings = cleanMeetings(readJson(MEETING_HISTORY_KEY, []))
  let remoteMeetings = []
  try { remoteMeetings = await loadRemoteMeetings(user) } catch (error) {
    console.warn('[Ana persistence] meeting load failed', error?.message || error)
  }
  const meetings = mergeMeetings(remoteMeetings, localMeetings)
  writeJson(MEETING_HISTORY_KEY, meetings)
  lastMeetingSignature = stableStringify(meetings)
  await syncMeetings(user, meetings)

  try {
    window.dispatchEvent(new CustomEvent('ana-account-data-hydrated', {
      detail: { glossaryCount: glossary.length, meetingCount: meetings.length },
    }))
    window.dispatchEvent(new CustomEvent('ana-account-preferences-hydrated'))
  } catch {}
}

function startWatcher(user) {
  if (watcher) clearInterval(watcher)
  watcher = setInterval(async () => {
    if (!user || activeUserId !== user.id) return

    const glossary = cleanGlossary(readJson(GLOSSARY_KEY, []))
    const glossarySignature = stableStringify(glossary)
    if (glossarySignature !== lastGlossarySignature) {
      lastGlossarySignature = glossarySignature
      await syncGlossary(user, glossary)
    }

    const meetings = cleanMeetings(readJson(MEETING_HISTORY_KEY, []))
    const meetingSignature = stableStringify(meetings)
    if (meetingSignature !== lastMeetingSignature) {
      lastMeetingSignature = meetingSignature
      await syncMeetings(user, meetings)
    }
  }, 900)
}

export async function hydrateAndStartAccountPersistence(userOverride = null) {
  if (!supabase) return
  const user = userOverride || await getUser()
  if (!user) {
    stopAccountPersistence()
    return
  }
  activeUserId = user.id
  await hydrate(user)
  startWatcher(user)
}

export function stopAccountPersistence() {
  activeUserId = ''
  if (watcher) clearInterval(watcher)
  watcher = null
  lastGlossarySignature = ''
  lastMeetingSignature = ''
}
