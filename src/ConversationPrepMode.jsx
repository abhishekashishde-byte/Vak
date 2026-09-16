import { useMemo, useState } from 'react'
import { Check, Clipboard, Languages, LoaderCircle, MessagesSquare, RotateCcw, Sparkles } from 'lucide-react'

const TARGETS = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const GERMAN_TARGETS = new Set(['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)'])
const REGISTER_KEY = 'ana-german-register'

function parseJson(text = '') {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) }
  catch { return null }
}

async function callAna(text, instructions) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not prepare this conversation')
  return String(data.content || '').trim()
}

const safeArray = value => Array.isArray(value) ? value.filter(Boolean) : []
const phraseText = item => typeof item === 'string' ? item : String(item?.target || item?.text || '')
const phraseMeaning = item => typeof item === 'string' ? '' : String(item?.meaning || item?.note || '')

function PrepPhrase({ item }) {
  const target = phraseText(item)
  const meaning = phraseMeaning(item)
  if (!target) return null
  return <li><strong>{target}</strong>{meaning && <span>{meaning}</span>}</li>
}

export default function ConversationPrepMode() {
  const [tool, setTool] = useState('prepare')
  const [target, setTarget] = useState('German')
  const [register, setRegister] = useState(() => {
    try { return localStorage.getItem(REGISTER_KEY) || 'formal' } catch { return 'formal' }
  })
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const german = GERMAN_TARGETS.has(target)
  const placeholder = tool === 'prepare'
    ? 'Example: I need to discuss a delayed shipment with a German supplier tomorrow. I want to be polite but firm and agree on a realistic delivery date.'
    : 'Paste the sentence, email or message you want Ana to check. You can write it in any language.'

  const buttonLabel = tool === 'prepare' ? 'Prepare me' : 'Check tone'

  const registerRule = german
    ? register === 'formal'
      ? 'Use formal German address (Sie/Ihnen/Ihr) consistently.'
      : 'Use informal German address (du/dich/dir/dein) consistently.'
    : ''

  const instructions = useMemo(() => {
    const common = `You are Ana, a culturally aware multilingual communication assistant. The selected communication language is ${target}. ${registerRule}
Base cultural guidance on broad communication conventions, never stereotypes. Phrase uncertain cultural observations as possibilities (for example, “may sound” or “can come across as”), not facts. Preserve all user facts exactly and never invent names, dates, prices, promises, legal/medical claims or commitments. Keep the response concise and practical. If the selected language is Hinglish, write Hindi naturally in Roman/Latin script only.`

    if (tool === 'prepare') {
      return `${common}
The user is preparing for a real conversation. Return ONLY valid JSON in this exact shape:
{"summary":"one short sentence describing the goal","opening":{"target":"opening line in ${target}","meaning":"brief explanation in the same language the user used to describe the situation"},"phrases":[{"target":"useful phrase in ${target}","meaning":"brief meaning/explanation"}],"likelyQuestions":[{"target":"likely question in ${target}","meaning":"brief meaning/explanation"}],"responseIdeas":[{"target":"useful response in ${target}","meaning":"brief meaning/explanation"}],"culturalNotes":["short practical note"],"ready":["information or item the user should have ready"]}
Provide 3-6 useful phrases, 2-4 likely questions, 2-4 response ideas, 1-3 cultural/tone notes, and only genuinely useful readiness items. Do not create optional filler.`
    }

    return `${common}
The user wants to know how a draft may land with a ${target}-speaking recipient and how to improve it. If the draft is not already in ${target}, translate its intended meaning into ${target} before coaching. Return ONLY valid JSON in this exact shape:
{"summary":"short assessment in the same language the user used","recommended":"best ready-to-send version in ${target}","notes":["specific cultural, formality or tone observation"],"alternatives":[{"label":"short label such as Warmer, More formal or More direct","text":"alternative in ${target}"}]}
Focus on how wording may be perceived, formality, directness, politeness and naturalness. Mention a concern only when it is meaningful. Give 1-3 notes and at most 3 genuinely distinct alternatives. Do not lecture about culture.`
  }, [tool, target, registerRule])

  const run = async () => {
    const text = input.trim()
    if (!text || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    setCopied(false)
    try {
      const raw = await callAna(text, instructions)
      const parsed = parseJson(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('Ana returned an unexpected response. Please try again.')
      setResult(parsed)
    } catch (err) {
      setError(err.message || 'Ana could not prepare this conversation')
    } finally {
      setLoading(false)
    }
  }

  const copyRecommended = async () => {
    const value = tool === 'prepare' ? phraseText(result?.opening) : String(result?.recommended || '')
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const clear = () => {
    setInput('')
    setResult(null)
    setError('')
    setCopied(false)
  }

  const changeTool = next => {
    setTool(next)
    setResult(null)
    setError('')
    setCopied(false)
  }

  return <section className="ana-prepare-shell">
    <header className="ana-prepare-head">
      <div className="ana-prepare-title"><span><Sparkles size={18}/></span><div><h1>Prepare & coach</h1><p>Get ready before a conversation, or check how your wording may land.</p></div></div>
      <button type="button" className="ana-prepare-clear" onClick={clear}><RotateCcw size={14}/>Clear</button>
    </header>

    <div className="ana-prepare-tabs" role="tablist" aria-label="Prepare and coach tools">
      <button type="button" className={tool === 'prepare' ? 'active' : ''} onClick={() => changeTool('prepare')}><MessagesSquare size={15}/>Conversation prep</button>
      <button type="button" className={tool === 'coach' ? 'active' : ''} onClick={() => changeTool('coach')}><Sparkles size={15}/>Tone & culture check</button>
    </div>

    <div className="ana-prepare-controls">
      <label><span>Communication language</span><div className="ana-prepare-select"><Languages size={15}/><select value={target} onChange={event => { setTarget(event.target.value); setResult(null) }}>{TARGETS.map(language => <option key={language}>{language}</option>)}</select></div></label>
      {german && <label><span>Address</span><div className="ana-prepare-register"><button type="button" className={register === 'formal' ? 'active' : ''} onClick={() => { setRegister('formal'); try { localStorage.setItem(REGISTER_KEY, 'formal') } catch {}; setResult(null) }}>Sie</button><button type="button" className={register === 'informal' ? 'active' : ''} onClick={() => { setRegister('informal'); try { localStorage.setItem(REGISTER_KEY, 'informal') } catch {}; setResult(null) }}>du</button></div></label>}
    </div>

    <div className="ana-prepare-grid">
      <article className="ana-prepare-card ana-prepare-input-card">
        <div className="ana-prepare-card-label">{tool === 'prepare' ? 'What are you preparing for?' : 'What do you want Ana to check?'}</div>
        <textarea value={input} onChange={event => setInput(event.target.value)} placeholder={placeholder} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') run() }}/>
        <div className="ana-prepare-card-foot"><span>{input.length.toLocaleString()} characters</span><span>⌘/Ctrl + Enter</span></div>
      </article>

      <article className="ana-prepare-card ana-prepare-result-card">
        <div className="ana-prepare-card-label">{tool === 'prepare' ? 'Your conversation plan' : 'Ana’s communication check'}</div>
        <div className="ana-prepare-result">
          {loading && <div className="ana-prepare-loading"><LoaderCircle size={17}/>Ana is thinking about the situation…</div>}
          {!loading && !result && !error && <div className="ana-prepare-empty">{tool === 'prepare' ? 'Ana will give you an opening, useful phrases, likely questions and practical cultural notes.' : 'Ana will flag wording that may feel too direct, too casual, overly formal or otherwise unnatural for the situation.'}</div>}
          {error && <div className="ana-prepare-error">{error}</div>}

          {!loading && result && tool === 'prepare' && <div className="ana-prep-sections">
            {result.summary && <p className="ana-prep-summary">{result.summary}</p>}
            {phraseText(result.opening) && <section><div className="ana-prep-section-head"><h3>Suggested opening</h3><button type="button" onClick={copyRecommended}>{copied ? <><Check size={13}/>Copied</> : <><Clipboard size={13}/>Copy</>}</button></div><div className="ana-prep-opening"><strong>{phraseText(result.opening)}</strong>{phraseMeaning(result.opening) && <span>{phraseMeaning(result.opening)}</span>}</div></section>}
            {safeArray(result.phrases).length > 0 && <section><h3>Useful phrases</h3><ul className="ana-prep-phrases">{safeArray(result.phrases).map((item, index) => <PrepPhrase item={item} key={index}/>)}</ul></section>}
            {safeArray(result.likelyQuestions).length > 0 && <section><h3>Likely questions</h3><ul className="ana-prep-phrases">{safeArray(result.likelyQuestions).map((item, index) => <PrepPhrase item={item} key={index}/>)}</ul></section>}
            {safeArray(result.responseIdeas).length > 0 && <section><h3>Useful responses</h3><ul className="ana-prep-phrases">{safeArray(result.responseIdeas).map((item, index) => <PrepPhrase item={item} key={index}/>)}</ul></section>}
            {safeArray(result.culturalNotes).length > 0 && <section className="ana-prep-cultural"><h3>Tone & culture</h3><ul>{safeArray(result.culturalNotes).map((item, index) => <li key={index}>{String(item)}</li>)}</ul></section>}
            {safeArray(result.ready).length > 0 && <section><h3>Have ready</h3><ul className="ana-prep-simple">{safeArray(result.ready).map((item, index) => <li key={index}>{String(item)}</li>)}</ul></section>}
          </div>}

          {!loading && result && tool === 'coach' && <div className="ana-prep-sections">
            {result.summary && <p className="ana-prep-summary">{result.summary}</p>}
            {result.recommended && <section><div className="ana-prep-section-head"><h3>Recommended wording</h3><button type="button" onClick={copyRecommended}>{copied ? <><Check size={13}/>Copied</> : <><Clipboard size={13}/>Copy</>}</button></div><div className="ana-prep-recommended">{result.recommended}</div></section>}
            {safeArray(result.notes).length > 0 && <section className="ana-prep-cultural"><h3>What Ana noticed</h3><ul>{safeArray(result.notes).map((item, index) => <li key={index}>{String(item)}</li>)}</ul></section>}
            {safeArray(result.alternatives).length > 0 && <section><h3>Alternatives</h3><div className="ana-prep-alternatives">{safeArray(result.alternatives).map((item, index) => <div key={index}><span>{String(item?.label || 'Alternative')}</span><p>{String(item?.text || '')}</p></div>)}</div></section>}
          </div>}
        </div>
      </article>
    </div>

    <div className="ana-prepare-action"><button type="button" onClick={run} disabled={!input.trim() || loading}>{loading ? <><LoaderCircle size={16}/>Working…</> : <><Sparkles size={16}/>{buttonLabel}</>}</button></div>
  </section>
}
