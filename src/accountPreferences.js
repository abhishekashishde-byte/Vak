import { supabase } from './lib/supabase.js'

const MEMORY_KEY = 'ana-personal-language-memory-v1'
const GLOSSARY_KEY = 'ana-glossary-v1'
const GLOSSARY_UPDATED_KEY = 'ana-glossary-updated-at'
const REGISTER_KEY = 'ana-german-register'
const PRIVACY_KEY = 'ana-privacy-settings-v1'
const LOCAL_UPDATED_KEY = 'ana-account-preferences-updated-at'

export const DEFAULT_PRIVACY_SETTINGS = {
  syncAcrossDevices: true,
  disclosureMode: 'always',
  extraPrivacySensitive: true,
  maskSensitiveBeforeCloud: true,
}

let installed = false
let applyingRemote = false
let bootstrapping = true
let suppressMarksUntil = 0
let syncTimer = null
let syncState = 'local'
let lastGlossarySignature = ''

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

const emit = (name, detail) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })) } catch {}
}

const setSyncState = state => {
  syncState = state
  emit('ana-preferences-sync-state', { state })
}

const localUpdatedAt = () => {
  try { return Number(localStorage.getItem(LOCAL_UPDATED_KEY) || 0) || 0 } catch { return 0 }
}

const setLocalUpdatedAt = value => {
  try { localStorage.setItem(LOCAL_UPDATED_KEY, String(Number(value) || Date.now())) } catch {}
}

const glossaryUpdatedAt = () => {
  try { return Number(localStorage.getItem(GLOSSARY_UPDATED_KEY) || 0) || 0 } catch { return 0 }
}

const setGlossaryUpdatedAt = value => {
  try { localStorage.setItem(GLOSSARY_UPDATED_KEY, String(Number(value) || Date.now())) } catch {}
}

const sanitiseGlossary = glossary => {
  if (!Array.isArray(glossary)) return []
  return glossary.slice(-120).map(item => {
    const scope = ['personal', 'project', 'company'].includes(item?.scope) ? item.scope : 'personal'
    const rule = ['preferred', 'locked'].includes(item?.rule) ? item.rule : 'preferred'
    const source = String(item?.source || '').slice(0, 160)
    const preferred = String(item?.preferred || (rule === 'locked' ? source : '')).slice(0, 160)
    return {
      id: String(item?.id || ''),
      target: String(item?.target || '').slice(0, 40),
      source,
      preferred,
      scope,
      context: scope === 'personal' ? '' : String(item?.context || '').slice(0, 120),
      rule,
    }
  }).filter(item => item.target && item.source && item.preferred)
}

const glossarySignature = glossary => JSON.stringify(sanitiseGlossary(glossary))

const mergeGlossaries = (older = [], newer = []) => {
  const map = new Map()
  const keyFor = item => [item.scope, item.context.toLocaleLowerCase(), item.target, item.source.toLocaleLowerCase()].join('\u0000')
  for (const item of sanitiseGlossary(older)) map.set(keyFor(item), item)
  for (const item of sanitiseGlossary(newer)) map.set(keyFor(item), item)
  return [...map.values()].slice(-120)
}

export const getPrivacySettings = () => ({
  ...DEFAULT_PRIVACY_SETTINGS,
  ...readJson(PRIVACY_KEY, {}),
})

export const getPreferenceSyncState = () => syncState

export const getLocalPreferenceBundle = () => ({
  memory: readJson(MEMORY_KEY, {}),
  glossary: sanitiseGlossary(readJson(GLOSSARY_KEY, [])),
  glossaryUpdatedAt: glossaryUpdatedAt(),
  germanRegister: (() => { try { return localStorage.getItem(REGISTER_KEY) || 'formal' } catch { return 'formal' } })(),
  privacy: getPrivacySettings(),
})

const applyRemoteBundle = remote => {
  if (!remote || typeof remote !== 'object') return
  applyingRemote = true
  try {
    if (remote.memory && typeof remote.memory === 'object') writeJson(MEMORY_KEY, remote.memory)

    if (Array.isArray(remote.glossary)) {
      const localGlossary = sanitiseGlossary(readJson(GLOSSARY_KEY, []))
      const remoteGlossary = sanitiseGlossary(remote.glossary)
      const localGlossaryTs = glossaryUpdatedAt()
      const remoteGlossaryTs = Number(remote.glossaryUpdatedAt || 0) || 0

      if (remoteGlossaryTs > localGlossaryTs) {
        if (localGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {
          const merged = mergeGlossaries(localGlossary, remoteGlossary)
          writeJson(GLOSSARY_KEY, merged)
          setGlossaryUpdatedAt(Date.now())
        } else {
          writeJson(GLOSSARY_KEY, remoteGlossary)
          setGlossaryUpdatedAt(remoteGlossaryTs)
        }
      } else if (localGlossaryTs > remoteGlossaryTs) {
        if (remoteGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {
          const merged = mergeGlossaries(remoteGlossary, localGlossary)
          writeJson(GLOSSARY_KEY, merged)
          setGlossaryUpdatedAt(Date.now())
        }
      } else if (!localGlossary.length && remoteGlossary.length) {
        writeJson(GLOSSARY_KEY, remoteGlossary)
      } else if (localGlossary.length && remoteGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {
        writeJson(GLOSSARY_KEY, mergeGlossaries(remoteGlossary, localGlossary))
        setGlossaryUpdatedAt(Date.now())
      }
    }

    if (remote.germanRegister === 'formal' || remote.germanRegister === 'informal') {
      try { localStorage.setItem(REGISTER_KEY, remote.germanRegister) } catch {}
    }
    if (remote.privacy && typeof remote.privacy === 'object') {
      writeJson(PRIVACY_KEY, { ...DEFAULT_PRIVACY_SETTINGS, ...remote.privacy })
    }
    setLocalUpdatedAt(remote.updatedAt || Date.now())
    lastGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))
    suppressMarksUntil = Date.now() + 400
  } finally {
    applyingRemote = false
  }
  emit('ana-account-preferences-hydrated', getLocalPreferenceBundle())
}

async function uploadPreferences(user, bundle = getLocalPreferenceBundle(), updatedAt = Date.now()) {
  if (!supabase || !user || bundle.privacy?.syncAcrossDevices === false) {
    setSyncState('local')
    return
  }

  setSyncState('syncing')
  const payload = {
    version: 2,
    updatedAt,
    memory: bundle.memory || {},
    glossary: sanitiseGlossary(bundle.glossary),
    glossaryUpdatedAt: Number(bundle.glossaryUpdatedAt || 0) || 0,
    germanRegister: bundle.germanRegister || 'formal',
    privacy: { ...DEFAULT_PRIVACY_SETTINGS, ...(bundle.privacy || {}) },
  }

  const { error } = await supabase.auth.updateUser({ data: { ana_preferences: payload } })
  if (error) {
    setSyncState('error')
    return
  }
  setLocalUpdatedAt(updatedAt)
  setSyncState('synced')
}

export async function hydrateAccountPreferences() {
  if (!supabase) {
    bootstrapping = false
    return
  }
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      setSyncState('local')
      return
    }

    const user = data.user
    const remote = user.user_metadata?.ana_preferences
    const local = getLocalPreferenceBundle()
    const localTs = localUpdatedAt()
    const remoteTs = Number(remote?.updatedAt || 0) || 0
    const localGlossaryTs = Number(local.glossaryUpdatedAt || 0) || 0
    const remoteGlossaryTs = Number(remote?.glossaryUpdatedAt || 0) || 0

    if (remoteTs && remoteTs > localTs) {
      applyRemoteBundle(remote)
      const reconciled = getLocalPreferenceBundle()
      if (reconciled.privacy?.syncAcrossDevices !== false && Number(reconciled.glossaryUpdatedAt || 0) > remoteGlossaryTs) {
        await uploadPreferences(user, reconciled, Date.now())
      } else {
        setSyncState('synced')
      }
      return
    }

    if (remoteTs && remoteTs === localTs) {
      if (remoteGlossaryTs > localGlossaryTs) {
        applyRemoteBundle(remote)
        setSyncState('synced')
        return
      }
      if (localGlossaryTs > remoteGlossaryTs && local.privacy?.syncAcrossDevices !== false) {
        await uploadPreferences(user, local, Date.now())
        return
      }
      setSyncState(local.privacy?.syncAcrossDevices === false ? 'local' : 'synced')
      return
    }

    if (local.privacy?.syncAcrossDevices !== false) {
      await uploadPreferences(user, local, localTs || Date.now())
    } else {
      setSyncState('local')
    }
  } catch {
    setSyncState('error')
  } finally {
    bootstrapping = false
    lastGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))
  }
}

export function markAccountPreferencesChanged() {
  if (applyingRemote || Date.now() < suppressMarksUntil) return
  const now = Date.now()
  const currentGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))
  if (bootstrapping) {
    if (currentGlossarySignature !== lastGlossarySignature) {
      lastGlossarySignature = currentGlossarySignature
      setGlossaryUpdatedAt(now)
      setLocalUpdatedAt(now)
    }
    return
  }
  if (currentGlossarySignature !== lastGlossarySignature) {
    lastGlossarySignature = currentGlossarySignature
    setGlossaryUpdatedAt(now)
  }
  setLocalUpdatedAt(now)
  emit('ana-account-preferences-changed', getLocalPreferenceBundle())
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    if (!supabase) return
    try {
      const { data } = await supabase.auth.getUser()
      if (data?.user) await uploadPreferences(data.user, getLocalPreferenceBundle(), now)
    } catch {
      setSyncState('error')
    }
  }, 650)
}

export function updatePrivacySettings(patch) {
  const next = { ...getPrivacySettings(), ...(patch || {}) }
  if (!['always', 'sensitive'].includes(next.disclosureMode)) next.disclosureMode = 'always'
  writeJson(PRIVACY_KEY, next)
  if (bootstrapping) bootstrapping = false
  markAccountPreferencesChanged()
  emit('ana-privacy-settings-changed', next)
  return next
}

export async function clearRememberedLanguageData() {
  try {
    localStorage.setItem(MEMORY_KEY, '{}')
    localStorage.setItem(GLOSSARY_KEY, '[]')
    localStorage.setItem(GLOSSARY_UPDATED_KEY, String(Date.now()))
    localStorage.setItem(REGISTER_KEY, 'formal')
  } catch {}
  lastGlossarySignature = glossarySignature([])
  if (bootstrapping) bootstrapping = false
  markAccountPreferencesChanged()
  emit('ana-account-preferences-hydrated', getLocalPreferenceBundle())
}

export function installAccountPreferenceSync() {
  if (installed || typeof window === 'undefined') return
  installed = true
  lastGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))
  hydrateAccountPreferences()

  if (supabase) {
    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => hydrateAccountPreferences(), 0)
      }
      if (event === 'SIGNED_OUT') setSyncState('local')
    })
  }
}