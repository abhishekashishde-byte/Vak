import { useEffect, useState } from 'react'
import { CheckCircle2, Cloud, Database, ShieldCheck, Trash2, X } from 'lucide-react'
import { clearRememberedLanguageData, getPreferenceSyncState, getPrivacySettings, updatePrivacySettings } from './accountPreferences.js'

export default function PrivacySettings({ open, onClose }) {
  const [settings, setSettings] = useState(getPrivacySettings)
  const [syncState, setSyncState] = useState(getPreferenceSyncState())
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    const onPrivacy = event => setSettings({ ...getPrivacySettings(), ...(event.detail || {}) })
    const onSync = event => setSyncState(event.detail?.state || getPreferenceSyncState())
    const onHydrated = () => setSettings(getPrivacySettings())
    window.addEventListener('ana-privacy-settings-changed', onPrivacy)
    window.addEventListener('ana-preferences-sync-state', onSync)
    window.addEventListener('ana-account-preferences-hydrated', onHydrated)
    return () => {
      window.removeEventListener('ana-privacy-settings-changed', onPrivacy)
      window.removeEventListener('ana-preferences-sync-state', onSync)
      window.removeEventListener('ana-account-preferences-hydrated', onHydrated)
    }
  }, [])

  if (!open) return null

  const change = patch => setSettings(updatePrivacySettings(patch))
  const clearMemory = async () => {
    await clearRememberedLanguageData()
    setCleared(true)
    setTimeout(() => setCleared(false), 1800)
  }

  return <div className="privacy-settings-backdrop" onMouseDown={onClose}>
    <aside className="privacy-settings-panel" onMouseDown={e => e.stopPropagation()}>
      <div className="privacy-settings-head">
        <div><span>Privacy & memory</span><h2>How Ana remembers and listens.</h2></div>
        <button onClick={onClose} aria-label="Close"><X size={20}/></button>
      </div>

      <section className="privacy-setting-section">
        <div className="privacy-section-title"><Cloud size={18}/><div><strong>Account-synced language memory</strong><span>Keep Ana's language preferences with your signed-in account.</span></div></div>
        <label className="privacy-toggle-row">
          <div><strong>Sync across devices</strong><span>Glossary, Sie/du preference, preferred owner language and privacy choices can follow you to another browser or phone.</span></div>
          <input type="checkbox" checked={settings.syncAcrossDevices !== false} onChange={e => change({ syncAcrossDevices: e.target.checked })}/><i/>
        </label>
        <div className={`privacy-sync-state ${syncState}`}><CheckCircle2 size={14}/><span>{syncState === 'synced' ? 'Synced to your Ana account' : syncState === 'syncing' ? 'Syncing…' : syncState === 'error' ? 'Saved on this device; account sync could not complete' : 'Stored on this device'}</span></div>
        <button className="privacy-clear-memory" onClick={clearMemory}><Trash2 size={15}/>{cleared ? 'Language memory cleared' : 'Clear remembered language preferences'}</button>
      </section>

      <section className="privacy-setting-section">
        <div className="privacy-section-title"><ShieldCheck size={18}/><div><strong>Cloud data protection</strong><span>Reduce exposure of common identifiers before text is sent to Ana's cloud translation service.</span></div></div>
        <label className="privacy-toggle-row">
          <div><strong>Mask sensitive values before cloud processing</strong><span>Ana locally replaces high-confidence emails, IBANs, payment-card numbers, international phone numbers and labelled account/case/patient IDs with temporary placeholders, then restores them in the result.</span></div>
          <input type="checkbox" checked={settings.maskSensitiveBeforeCloud !== false} onChange={e => change({ maskSensitiveBeforeCloud: e.target.checked })}/><i/>
        </label>
        <p className="privacy-setting-note">This is a best-effort protection layer, not a guarantee that every kind of personal or confidential information will be detected.</p>
      </section>

      <section className="privacy-setting-section">
        <div className="privacy-section-title"><ShieldCheck size={18}/><div><strong>Voice conversation transparency</strong><span>Control when Ana requires a disclosure before Live or Talk for Me begins.</span></div></div>
        <label className="privacy-select-row"><span>Show disclosure</span><select value={settings.disclosureMode || 'always'} onChange={e => change({ disclosureMode: e.target.value })}><option value="always">Before every voice conversation</option><option value="sensitive">Sensitive conversations only</option></select></label>
        <label className="privacy-toggle-row">
          <div><strong>Extra privacy for sensitive conversations</strong><span>For contexts such as healthcare, authorities, banking, legal matters or similar situations, Ana minimises repetition and builds the final handoff from structured confirmed facts instead of sending the full transcript into the debrief step.</span></div>
          <input type="checkbox" checked={settings.extraPrivacySensitive !== false} onChange={e => change({ extraPrivacySensitive: e.target.checked })}/><i/>
        </label>
      </section>

      <section className="privacy-architecture-card">
        <div><Database size={17}/><strong>What Ana stores</strong></div>
        <p><b>Raw voice audio:</b> not stored in Ana's account memory.</p>
        <p><b>Voice-session transcript:</b> kept only in the current app session and not synced into personal language memory.</p>
        <p><b>Personal memory:</b> language preferences, glossary terms, register choices and privacy settings only.</p>
        <small>The privacy disclosure improves transparency but is not a substitute for checking the legal requirements that apply to a particular workplace, institution or country.</small>
      </section>
    </aside>
  </div>
}
