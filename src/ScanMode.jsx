import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Download, FileImage, FileText, Languages, LayoutTemplate, LoaderCircle, ScanText, Upload, X } from 'lucide-react'
import { buildTranslatedPdf, downloadBytes, extractPdfLayout, layoutToPlainText } from './lib/pdfLayout.js'

const TARGETS = ['German', 'English', 'Hindi', 'French', 'Spanish', 'Italian']
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read this file.'))
    reader.readAsDataURL(file)
  })
}

function parseJson(text = '') {
  const cleaned = String(text).replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const firstArray = cleaned.indexOf('[')
  const lastArray = cleaned.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) {
    try { return JSON.parse(cleaned.slice(firstArray, lastArray + 1)) } catch {}
  }
  return null
}

async function callAna(text, instructions) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instructions }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not process this document.')
  return String(data.content || '').trim()
}

async function translateDocument(text, target) {
  const instructions = `You are Ana. Translate the parsed document into ${target}. Preserve headings, paragraphs, bullets, numbering, tables, labels, dates, numbers, names and line breaks. Translate naturally and idiomatically, not word-for-word. Do not add explanations or commentary. Return only the translated document.`
  return callAna(text, instructions)
}

function chunkBlocks(blocks, maxChars = 9500, maxBlocks = 20) {
  const chunks = []
  let current = []
  let chars = 0
  for (const block of blocks) {
    const size = block.text.length + 80
    if (current.length && (current.length >= maxBlocks || chars + size > maxChars)) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(block)
    chars += size
  }
  if (current.length) chunks.push(current)
  return chunks
}

async function translateLayout(layout, target, onProgress) {
  const chunks = chunkBlocks(layout.blocks)
  const translated = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    onProgress?.(index + 1, chunks.length)
    const payload = chunk.map(block => ({ id: block.id, type: block.type, text: block.text }))
    const instructions = `You are Ana translating positioned PDF text blocks into ${target}. Translate ONLY each object's text value. Keep every id exactly unchanged. Preserve numbers, names, dates, references, legal clause numbering and meaning. Do not merge, split, reorder or omit blocks. Return ONLY a valid JSON array in this exact shape: [{"id":"same-id","text":"translated text"}]. No Markdown fences and no commentary.`
    const raw = await callAna(JSON.stringify(payload), instructions)
    const parsed = parseJson(raw)
    if (!Array.isArray(parsed)) throw new Error(`Ana returned an invalid structured translation for part ${index + 1}.`)

    const byId = new Map(parsed.filter(item => item?.id).map(item => [String(item.id), String(item.text || '')]))
    for (const block of chunk) {
      const value = byId.get(block.id)
      if (!value) throw new Error(`A translated block was missing on page ${block.pageIndex + 1}. Please try again.`)
      translated.push({ id: block.id, text: value })
    }
  }

  return translated
}

export default function ScanMode() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [fileKind, setFileKind] = useState('')
  const [preview, setPreview] = useState('')
  const [layout, setLayout] = useState(null)
  const [parsed, setParsed] = useState('')
  const [translated, setTranslated] = useState('')
  const [translatedBlocks, setTranslatedBlocks] = useState([])
  const [target, setTarget] = useState('German')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')
  const [progress, setProgress] = useState('')

  const busy = ['parsing', 'translating', 'exporting'].includes(status)
  const filename = useMemo(() => file?.name || '', [file])
  const isPdf = fileKind === 'pdf'
  const canExport = isPdf && layout && translatedBlocks.length > 0 && target !== 'Hindi'

  useEffect(() => () => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
  }, [preview])

  const resetResults = () => {
    setLayout(null)
    setParsed('')
    setTranslated('')
    setTranslatedBlocks([])
    setNotice('')
    setProgress('')
  }

  const chooseFile = async selected => {
    if (!selected) return
    setError('')
    resetResults()
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)

    const pdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')
    const image = selected.type?.startsWith('image/')

    if (!pdf && !image) {
      setError('Upload a PDF or document image (JPG, PNG or WEBP).')
      return
    }
    if (pdf && selected.size > MAX_PDF_BYTES) {
      setError('Please use a PDF smaller than 20 MB for this first layout-preserving version.')
      return
    }
    if (image && selected.size > MAX_IMAGE_BYTES) {
      setError('Please use an image smaller than 4 MB for now.')
      return
    }

    try {
      setFile(selected)
      setFileKind(pdf ? 'pdf' : 'image')
      setPreview(pdf ? URL.createObjectURL(selected) : await readAsDataUrl(selected))
      setStatus('idle')
    } catch (err) {
      setError(err.message || 'Could not load this document.')
    }
  }

  const parse = async () => {
    if (!file || busy) return
    setStatus('parsing')
    setError('')
    resetResults()

    try {
      if (isPdf) {
        const found = await extractPdfLayout(file)
        setLayout(found)
        setParsed(layoutToPlainText(found))
        if (found.emptyPages.length) {
          setNotice(`${found.emptyPages.length} page${found.emptyPages.length === 1 ? '' : 's'} had no embedded text. Ana preserved the readable PDF pages; scanned-page OCR fallback still needs to be added for those pages.`)
        } else {
          setNotice('Original PDF canvas retained. Ana found positioned text blocks instead of flattening the document.')
        }
      } else {
        const response = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: preview }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Document parsing failed.')
        setParsed(String(data.parsed || '').trim())
        setNotice('Image OCR currently preserves logical structure. Exact position-preserving reconstruction is being built for scanned pages next.')
      }
      setStatus('parsed')
    } catch (err) {
      setStatus('idle')
      if (err?.code === 'SCANNED_PDF') {
        setError('This PDF appears to be image-only. The new layout engine detected that correctly; scanned-PDF layout OCR is the next fallback we need to connect.')
      } else {
        setError(err.message || 'Document parsing failed.')
      }
    }
  }

  const translate = async () => {
    if (!parsed || busy) return
    setStatus('translating')
    setError('')
    setProgress('')

    try {
      if (layout) {
        const blocks = await translateLayout(layout, target, (current, total) => setProgress(`Translating section ${current} of ${total}`))
        setTranslatedBlocks(blocks)
        setTranslated(layoutToPlainText(layout, blocks))
      } else {
        setTranslated(await translateDocument(parsed, target))
      }
      setStatus('done')
      setProgress('')
    } catch (err) {
      setStatus('parsed')
      setProgress('')
      setError(err.message || 'Translation failed.')
    }
  }

  const exportPdf = async () => {
    if (!canExport || busy) return
    setStatus('exporting')
    setError('')
    try {
      const bytes = await buildTranslatedPdf(file, layout, translatedBlocks, target)
      const base = filename.replace(/\.pdf$/i, '') || 'document'
      downloadBytes(bytes, `${base}-${target.toLowerCase()}-ana.pdf`)
      setStatus('done')
    } catch (err) {
      setStatus('done')
      setError(err.message || 'Could not create the translated PDF.')
    }
  }

  const reset = () => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    setFile(null)
    setFileKind('')
    setPreview('')
    resetResults()
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
      <div className="eyebrow"><LayoutTemplate size={14}/> Ana Documents</div>
      <h1>Translate the document. Keep the layout.</h1>
      <p>Ana reads text together with its position on the page, translates it block by block, and can place it back onto the original PDF canvas.</p>
    </header>

    {!preview ? <button className="scan-drop" onClick={() => inputRef.current?.click()}>
      <span className="scan-drop-icon"><Upload size={24}/></span>
      <strong>Upload a PDF or document photo</strong>
      <span>PDF up to 20 MB · JPG, PNG, WEBP up to 4 MB</span>
    </button> : <section className="scan-layout">
      <article className="scan-source-card">
        <div className="scan-card-head">
          <div><span className="scan-kicker">ORIGINAL DOCUMENT</span><strong>{isPdf ? <FileText size={15}/> : <FileImage size={15}/>} {filename}</strong></div>
          <button className="scan-icon-btn" onClick={reset} title="Remove document"><X size={17}/></button>
        </div>
        <div className={`scan-preview ${isPdf ? 'pdf' : ''}`}>
          {isPdf ? <iframe src={`${preview}#toolbar=0&navpanes=0`} title="Original PDF"/> : <img src={preview} alt="Uploaded document"/>}
        </div>
        <button className="scan-primary" disabled={busy} onClick={parse}>
          {status === 'parsing' ? <><LoaderCircle className="spin" size={17}/> Reading document…</> : isPdf ? <><LayoutTemplate size={17}/> Read PDF layout</> : <><ScanText size={17}/> Parse document</>}
        </button>
        {layout && <div className="scan-layout-stats">
          <span>{layout.pageCount} page{layout.pageCount === 1 ? '' : 's'}</span>
          <span>{layout.blocks.length} positioned blocks</span>
          <span>Canvas retained</span>
        </div>}
      </article>

      <div className="scan-results">
        <article className={`scan-text-card ${parsed ? 'ready' : ''}`}>
          <div className="scan-card-head">
            <div><span className="scan-kicker">DOCUMENT MAP</span><strong>{layout ? 'Positioned content' : 'Parsed content'}</strong></div>
            <button className="scan-copy" disabled={!parsed} onClick={() => copy(parsed, 'parsed')}>{copied === 'parsed' ? <Check size={15}/> : <Clipboard size={15}/>} {copied === 'parsed' ? 'Copied' : 'Copy'}</button>
          </div>
          {layout ? <div className="scan-block-list">{layout.blocks.slice(0, 40).map(block => <div className="scan-block" key={block.id}><span>{block.type}</span><p>{block.text}</p><small>Page {block.pageIndex + 1}</small></div>)}{layout.blocks.length > 40 && <div className="scan-more">+ {layout.blocks.length - 40} more positioned blocks</div>}</div> : <div className="scan-document">{parsed || <span className="scan-empty">Ana will reconstruct the readable text and document structure here.</span>}</div>}
        </article>

        <article className={`scan-text-card translated ${translated ? 'ready' : ''}`}>
          <div className="scan-card-head scan-translate-head">
            <div><span className="scan-kicker">ANA TRANSLATION</span><strong><Languages size={15}/> Translate document</strong></div>
            <div className="scan-head-actions">
              <select value={target} onChange={e => { setTarget(e.target.value); setTranslated(''); setTranslatedBlocks([]); if (parsed) setStatus('parsed') }}>{TARGETS.map(lang => <option key={lang}>{lang}</option>)}</select>
              <button className="scan-copy" disabled={!translated} onClick={() => copy(translated, 'translated')}>{copied === 'translated' ? <Check size={15}/> : <Clipboard size={15}/>}</button>
            </div>
          </div>
          <div className="scan-document">{status === 'translating' ? <span className="scan-loading"><LoaderCircle className="spin" size={16}/> {progress || 'Translating positioned blocks…'}</span> : translated || <span className="scan-empty">Ana translates each positioned block without collapsing the document into one text stream.</span>}</div>
          <div className="scan-translate-action">
            <button className="scan-secondary" disabled={!parsed || busy} onClick={translate}>Translate to {target}</button>
            {isPdf && <button className="scan-export" disabled={!canExport || busy} onClick={exportPdf}>{status === 'exporting' ? <><LoaderCircle className="spin" size={15}/> Building PDF…</> : <><Download size={15}/> Export translated PDF</>}</button>}
          </div>
          {target === 'Hindi' && translatedBlocks.length > 0 && <div className="scan-inline-note">Hindi translation works, but Hindi PDF export needs the Unicode font layer before we enable it.</div>}
        </article>
      </div>
    </section>}

    <input ref={inputRef} className="scan-file-input" type="file" accept="application/pdf,image/*" onChange={e => chooseFile(e.target.files?.[0])}/>
    {notice && <div className="scan-notice">{notice}</div>}
    {error && <div className="scan-error">{error}</div>}
    <p className="scan-note">Digital PDFs now use Ana's layout-preserving path. Scanned PDFs/images still use OCR as a fallback; exact bounding-box OCR reconstruction is the next layer.</p>
  </section>
}
