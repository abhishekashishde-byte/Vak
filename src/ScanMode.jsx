import { useMemo, useRef, useState } from 'react'
import { Check, Clipboard, FileImage, Languages, LoaderCircle, ScanText, Upload, X } from 'lucide-react'

const TARGETS = ['German', 'English', 'Hindi', 'French', 'Spanish', 'Italian']
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read this image.'))
    reader.readAsDataURL(file)
  })
}

async function translateDocument(text, target) {
  const instructions = `You are Ana. Translate the parsed document into ${target}. Preserve the document structure exactly as far as possible: headings, paragraphs, bullets, numbering, Markdown tables, labels, dates, numbers, names and line breaks. Translate naturally and idiomatically, not word-for-word. Do not add explanations or commentary. Return only the translated document.`
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Translation failed.')
  return String(data.content || '').trim()
}

export default function ScanMode() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [parsed, setParsed] = useState('')
  const [translated, setTranslated] = useState('')
  const [target, setTarget] = useState('German')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const busy = status === 'parsing' || status === 'translating'
  const filename = useMemo(() => file?.name || '', [file])

  const chooseFile = async selected => {
    if (!selected) return
    setError('')
    setParsed('')
    setTranslated('')

    if (!selected.type?.startsWith('image/')) {
      setError('For the first Ana Scan version, upload an image (JPG, PNG, WEBP or HEIC where supported).')
      return
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setError('Please use an image smaller than 4 MB for now.')
      return
    }

    try {
      const dataUrl = await readAsDataUrl(selected)
      setFile(selected)
      setPreview(dataUrl)
    } catch (err) {
      setError(err.message || 'Could not load this image.')
    }
  }

  const parse = async () => {
    if (!preview || busy) return
    setStatus('parsing')
    setError('')
    setParsed('')
    setTranslated('')
    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: preview }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Document parsing failed.')
      setParsed(String(data.parsed || '').trim())
      setStatus('parsed')
    } catch (err) {
      setStatus('idle')
      setError(err.message || 'Document parsing failed.')
    }
  }

  const translate = async () => {
    if (!parsed || busy) return
    setStatus('translating')
    setError('')
    try {
      setTranslated(await translateDocument(parsed, target))
      setStatus('done')
    } catch (err) {
      setStatus('parsed')
      setError(err.message || 'Translation failed.')
    }
  }

  const reset = () => {
    setFile(null)
    setPreview('')
    setParsed('')
    setTranslated('')
    setError('')
    setStatus('idle')
    if (inputRef.current) inputRef.current.value = ''
  }

  const copy = async (text, type) => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(''), 1200)
  }

  return <section className="scan-page">
    <header className="scan-hero">
      <div className="eyebrow"><ScanText size={14}/> Ana Scan</div>
      <h1>Read it. Understand it.</h1>
      <p>Turn a document photo into structured text, then translate it without losing its meaning or layout.</p>
    </header>

    {!preview ? <button className="scan-drop" onClick={() => inputRef.current?.click()}>
      <span className="scan-drop-icon"><Upload size={24}/></span>
      <strong>Upload a document photo</strong>
      <span>JPG, PNG, WEBP · up to 4 MB</span>
    </button> : <section className="scan-layout">
      <article className="scan-source-card">
        <div className="scan-card-head">
          <div><span className="scan-kicker">SOURCE</span><strong><FileImage size={15}/>{filename}</strong></div>
          <button className="scan-icon-btn" onClick={reset} title="Remove image"><X size={17}/></button>
        </div>
        <div className="scan-preview"><img src={preview} alt="Uploaded document"/></div>
        <button className="scan-primary" disabled={busy} onClick={parse}>
          {status === 'parsing' ? <><LoaderCircle className="spin" size={17}/> Ana is reading…</> : <><ScanText size={17}/> Parse document</>}
        </button>
      </article>

      <div className="scan-results">
        <article className={`scan-text-card ${parsed ? 'ready' : ''}`}>
          <div className="scan-card-head">
            <div><span className="scan-kicker">PARSED</span><strong>Document text</strong></div>
            <button className="scan-copy" disabled={!parsed} onClick={() => copy(parsed, 'parsed')}>{copied === 'parsed' ? <Check size={15}/> : <Clipboard size={15}/>} {copied === 'parsed' ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="scan-document">{parsed || <span className="scan-empty">Ana will reconstruct the readable text and document structure here.</span>}</div>
        </article>

        <article className={`scan-text-card translated ${translated ? 'ready' : ''}`}>
          <div className="scan-card-head scan-translate-head">
            <div><span className="scan-kicker">ANA TRANSLATION</span><strong><Languages size={15}/> Translate document</strong></div>
            <div className="scan-head-actions">
              <select value={target} onChange={e => { setTarget(e.target.value); setTranslated(''); if (parsed) setStatus('parsed') }}>{TARGETS.map(lang => <option key={lang}>{lang}</option>)}</select>
              <button className="scan-copy" disabled={!translated} onClick={() => copy(translated, 'translated')}>{copied === 'translated' ? <Check size={15}/> : <Clipboard size={15}/>}</button>
            </div>
          </div>
          <div className="scan-document">{status === 'translating' ? <span className="scan-loading"><LoaderCircle className="spin" size={16}/> Translating while preserving structure…</span> : translated || <span className="scan-empty">Choose a language and Ana will translate the parsed document.</span>}</div>
          <div className="scan-translate-action"><button className="scan-secondary" disabled={!parsed || busy} onClick={translate}>Translate to {target}</button></div>
        </article>
      </div>
    </section>}

    <input ref={inputRef} className="scan-file-input" type="file" accept="image/*" onChange={e => chooseFile(e.target.files?.[0])}/>
    {error && <div className="scan-error">{error}</div>}
    <p className="scan-note">PDF export comes next. The parsed and translated document structure is already kept separate so we can render either version into a clean PDF.</p>
  </section>
}
