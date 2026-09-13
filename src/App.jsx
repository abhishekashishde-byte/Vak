import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Clipboard, Languages, LogOut, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { markAccountPreferencesChanged } from './accountPreferences.js'
import { getNetworkState, tryOnDeviceTranslation } from './networkResilience.js'

const TARGETS = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const GLOSSARY_KEY = 'ana-glossary-v1'
const REGISTER_KEY = 'ana-german-register'
const DRAFT_KEY = 'ana-translate-draft-v1'
const GERMAN_TARGETS = new Set(['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)'])
const isGermanTarget = value => GERMAN_TARGETS.has(value)
const germanVariantRule = value => value === 'Swabian German (Schwäbisch)'
  ? 'Use natural Swabian German (Schwäbisch) as spoken in Baden-Württemberg. Keep it authentic but readable and avoid caricature.'
  : value === 'Bavarian German (Bairisch)'
    ? 'Use natural Bavarian German (Bairisch) as spoken in Bavaria. Keep it authentic but readable and avoid caricature.'
    : value === 'Low German (Plattdeutsch)'
      ? 'Use natural Low German (Plattdeutsch), not Standard German. Keep it understandable and avoid invented dialect spellings.'
      : 'Use flawless Standard German (Hochdeutsch) as written in Germany.'

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}
function splitTranslation(text = '') { return String(text).split(/(\s+|[.,!?;:()[\]{}\"“”]+)/g).filter(Boolean) }
function isWord(part = '') {
  try { return /[\p{L}\p{N}]/u.test(part) } catch { return /[A-Za-z0-9À-ž]/.test(part) }
}
function loadGlossary() {
  try { return JSON.parse(localStorage.getItem(GLOSSARY_KEY) || '[]') } catch { return [] }
}
function loadDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}
function TranslationText({ text, onWord }) {
  const parts = useMemo(() => splitTranslation(text), [text])
  let cursor = 0
  return <div className="translation-text">{parts.map((part, index) => {
    const start = cursor, end = start + part.length; cursor = end
    if (!isWord(part)) return <span key={`${index}-${start}`}>{part}</span>
    return <button key={`${index}-${start}`} className="word" onClick={() => onWord(part, start, end)}>{part}</button>
  })}</div>
}
async function callLuna(text, instructions) {
  const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, instructions }) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Translation failed')
  return String(data.content || '').trim()
}

export default function App() {
  const [input, setInput] = useState(() => String(loadDraft().input || ''))
  const [output, setOutput] = useState(() => String(loadDraft().output || ''))
  const [target, setTarget] = useState(() => TARGETS.includes(loadDraft().target) ? loadDraft().target : 'German')
  const [outputMode, setOutputMode] = useState(() => loadDraft().outputMode === 'device' ? 'device' : 'online')
  const [offlineNotice, setOfflineNotice] = useState('')
  const [register, setRegister] = useState(() => { try { return localStorage.getItem(REGISTER_KEY) || 'formal' } catch { return 'formal' } })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [glossary, setGlossary] = useState(loadGlossary)
  const [newSource, setNewSource] = useState('')
  const [newPreferred, setNewPreferred] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { try { localStorage.setItem(REGISTER_KEY, register); markAccountPreferencesChanged() } catch {} }, [register])
  useEffect(() => { try { localStorage.setItem(GLOSSARY_KEY, JSON.stringify(glossary)); markAccountPreferencesChanged() } catch {} }, [glossary])
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, output, target, outputMode, updatedAt: Date.now() })) } catch {}
  }, [input, output, target, outputMode])
  useEffect(() => {
    const hydrate = () => {
      try {
        setRegister(localStorage.getItem(REGISTER_KEY) || 'formal')
        setGlossary(loadGlossary())
      } catch {}
    }
    window.addEventListener('ana-account-preferences-hydrated', hydrate)
    return () => window.removeEventListener('ana-account-preferences-hydrated', hydrate)
  }, [])
  useEffect(() => { inputRef.current?.focus() }, [])

  const activeGlossary = glossary.filter(item => item.target === target)
  const registerRules = () => register === 'formal'
    ? 'For German, use formal Sie/Ihnen/Ihr consistently. Never switch to du.'
    : 'For German, use informal du/dich/dir/dein consistently. Never switch to Sie.'
  const glossaryInstructions = () => activeGlossary.length
    ? `\nPERSONAL GLOSSARY — explicit user preferences override ordinary word choice:\n${activeGlossary.map(item => `- "${item.source}" → "${item.preferred}"`).join('\n')}\nPreserve preferred wording unless grammar requires inflection.`
    : ''

  const translate = async () => {
    const text = input.trim(); if (!text || loading) return
    setLoading(true); setError(''); setOfflineNotice(''); setSelected(null); setCopied(false)
    try {
      let instructions = `You are Ana, a premium translation engine. Detect the source language and translate into ${target}. Return ONLY the finished translation with no explanation, labels or quotation marks. Preserve paragraph breaks, bullets, names, dates, numbers, URLs, greetings and signatures. Translate idiomatically and naturally, not word-for-word. Preserve the user's tone, intent and level of formality.`
      if (isGermanTarget(target)) instructions += `\n${germanVariantRule(target)} ${registerRules()}`
      if (target === 'Hinglish') instructions += `\nHinglish means natural spoken Hindi written entirely in the Latin/Roman alphabet. Do NOT use Devanagari/Hindi script. Write the way a Hindi speaker would naturally say it. Keep names, brands, numbers and unavoidable English terms naturally. Do not translate into English.`
      instructions += glossaryInstructions()
      setOutput(await callLuna(text, instructions))
      setOutputMode('online')
    } catch (err) {
      const deviceResult = await tryOnDeviceTranslation(text, target)
      if (deviceResult) {
        setOutput(deviceResult)
        setOutputMode('device')
        setOfflineNotice('Basic on-device translation. Reconnect for Ana’s full context, glossary and tone handling.')
      } else {
        const network = getNetworkState()
        setError(network.online ? (err.message || 'Could not translate') : 'You’re offline. Your text is saved automatically. Reconnect to use Ana’s full translation; on-device translation is not available for this language pair on this browser.')
      }
    } finally { setLoading(false) }
  }

  const inspectWord = async (word, start, end) => {
    if (!output || suggestLoading) return
    setSelected({ word, start, end, sourceTerm: '', partOfSpeech: '', meaning: '', alternatives: [] })
    setSuggestLoading(true)
    try {
      const prompt = `SOURCE TEXT:\n${input}\n\nCURRENT ${target.toUpperCase()} TRANSLATION:\n${output}\n\nSELECTED TARGET WORD:\n${word}\n\nIdentify the source word or short source phrase represented by the selected target word, then suggest up to 5 natural alternatives that are drop-in replacements for exactly this selected span. Return JSON only: {"sourceTerm":"...","partOfSpeech":"...","meaning":"short plain-English meaning in context","alternatives":[{"term":"...","note":"short nuance"}]}`
      let instructions = `You are a bilingual editor refining a translation into ${target}. Return valid JSON only.`
      if (isGermanTarget(target)) instructions += ` ${germanVariantRule(target)} ${registerRules()}`
      if (target === 'Hinglish') instructions += ' Hinglish must be natural Hindi written only in Roman/Latin letters, never Devanagari.'
      const parsed = parseJson(await callLuna(prompt, instructions)) || {}
      const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.filter(x => x?.term && String(x.term).toLowerCase() !== word.toLowerCase()).slice(0, 5) : []
      setSelected(prev => prev ? { ...prev, sourceTerm: String(parsed.sourceTerm || '').trim(), partOfSpeech: String(parsed.partOfSpeech || '').trim(), meaning: String(parsed.meaning || '').trim(), alternatives } : prev)
    } catch (err) { setSelected(prev => prev ? { ...prev, error: err.message || 'Could not load alternatives' } : prev) }
    finally { setSuggestLoading(false) }
  }

  const replaceSelected = term => {
    if (!selected || !term) return
    setOutput(output.slice(0, selected.start) + term + output.slice(selected.end)); setSelected(null)
  }
  const useAlways = term => {
    if (!selected?.sourceTerm || !term) return
    setGlossary(prev => [...prev.filter(item => !(item.target === target && item.source.toLowerCase() === selected.sourceTerm.toLowerCase())), { id: crypto.randomUUID(), target, source: selected.sourceTerm, preferred: term }])
    replaceSelected(term)
  }
  const addGlossary = () => {
    const source = newSource.trim(), preferred = newPreferred.trim(); if (!source || !preferred) return
    setGlossary(prev => [...prev.filter(item => !(item.target === target && item.source.toLowerCase() === source.toLowerCase())), { id: crypto.randomUUID(), target, source, preferred }])
    setNewSource(''); setNewPreferred('')
  }
  const copyOutput = async () => { if (!output) return; await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1400) }
  const clear = () => { setInput(''); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null); setError(''); inputRef.current?.focus() }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><img src="/ana-app-icon.png" alt="Ana"/><div><strong>Ana</strong><span>Your voice, in any language</span></div></div>
      <div className="header-actions"><button className="ghost" onClick={() => setGlossaryOpen(true)}>Glossary <span className="badge">{activeGlossary.length}</span></button><button className="ghost icon-only" title="Sign out" onClick={() => supabase?.auth.signOut()}><LogOut size={16}/></button></div>
    </header>

    <section className="hero">
      <div className="eyebrow"><Sparkles size={14}/> Meaning before words</div>
      <h1>Say exactly what you mean.</h1>
      <p>Your voice, in any language.</p>
    </section>

    <section className="translator-card">
      <div className="toolbar">
        <div className="language-pill"><Languages size={16}/><span>Auto-detect</span></div><ArrowLeftRight size={16} className="muted"/>
        <select value={target} onChange={e => { setTarget(e.target.value); setOutput(''); setOutputMode('online'); setOfflineNotice(''); setSelected(null) }}>{TARGETS.map(lang => <option key={lang}>{lang}</option>)}</select>
        {isGermanTarget(target) && <div className="segmented"><button className={register === 'formal' ? 'active' : ''} onClick={() => setRegister('formal')}>Sie</button><button className={register === 'informal' ? 'active' : ''} onClick={() => setRegister('informal')}>du</button></div>}
        <div className="spacer"/><button className="ghost icon-text" onClick={clear}><RotateCcw size={15}/> Clear</button>
      </div>
      <section className="workspace">
        <article className="pane input-pane"><div className="pane-label">Original</div><textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder="Type or paste anything…" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') translate() }}/><div className="pane-foot"><span>{input.length.toLocaleString()} characters</span><span>⌘/Ctrl + Enter</span></div></article>
        <article className="pane output-pane"><div className="pane-label">{target}</div><div className="output-area">{loading ? <div className="thinking"><span></span><span></span><span></span> Translating</div> : output ? <TranslationText text={output} onWord={inspectWord}/> : <div className="placeholder">Your translation will appear here.</div>}</div><div className="pane-foot"><span>{output ? (outputMode === 'device' ? 'Basic on-device translation' : 'Tap a word to refine it') : 'Context-aware translation'}</span><button className="copy" disabled={!output} onClick={copyOutput}>{copied ? <><Check size={15}/> Copied</> : <><Clipboard size={15}/> Copy</>}</button></div></article>
      </section>
    </section>

    {offlineNotice && <div className="ana-offline-note">{offlineNotice}</div>}
    {error && <div className="error">{error}</div>}
    <div className="action-row"><button className="translate-btn" disabled={!input.trim() || loading} onClick={translate}>{loading ? 'Translating…' : 'Translate'}</button></div>

    {selected && <div className="popover-backdrop" onMouseDown={() => setSelected(null)}><div className="popover" onMouseDown={e => e.stopPropagation()}><div className="popover-head"><div><strong>{selected.word}</strong>{selected.partOfSpeech && <span>{selected.partOfSpeech}</span>}</div><button onClick={() => setSelected(null)}><X size={18}/></button></div>{suggestLoading ? <div className="popover-loading">Finding the best alternatives…</div> : <>{selected.meaning && <div className="meaning">{selected.meaning}{selected.sourceTerm && <small>From: <b>{selected.sourceTerm}</b></small>}</div>}<div className="alternative-list">{selected.alternatives?.length ? selected.alternatives.map(item => <div className="alternative" key={item.term}><button onClick={() => replaceSelected(item.term)}><strong>{item.term}</strong><span>{item.note}</span></button><button className="always" onClick={() => useAlways(item.term)}>Always</button></div>) : <div className="empty-mini">No clean drop-in alternatives found.</div>}</div></>}</div></div>}

    {glossaryOpen && <div className="drawer-backdrop" onMouseDown={() => setGlossaryOpen(false)}><aside className="drawer" onMouseDown={e => e.stopPropagation()}><div className="drawer-head"><div><h2>Personal glossary</h2><p>{target} terminology Ana should remember.</p></div><button onClick={() => setGlossaryOpen(false)}><X size={20}/></button></div><div className="add-rule"><input value={newSource} onChange={e => setNewSource(e.target.value)} placeholder="Source term"/><span>→</span><input value={newPreferred} onChange={e => setNewPreferred(e.target.value)} placeholder={`Preferred ${target}`}/><button onClick={addGlossary}><Plus size={17}/></button></div><div className="rules">{activeGlossary.length ? activeGlossary.map(item => <div className="rule" key={item.id}><div><strong>{item.source}</strong><span>→</span><b>{item.preferred}</b></div><button onClick={() => setGlossary(prev => prev.filter(x => x.id !== item.id))}><Trash2 size={16}/></button></div>) : <div className="empty-rules">No saved terms for {target} yet.</div>}</div></aside></div>}
  </main>
}
