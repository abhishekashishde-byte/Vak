import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, LoaderCircle, Upload, X } from 'lucide-react'
import { buildTranslatedPdf, downloadBytes, enrichScannedPages, extractPdfLayout, layoutToPlainText } from './lib/pdfLayout.js'

const TARGETS = ['German', 'English', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']
const MAX_PDF_BYTES = 20 * 1024 * 1024

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

async function readScannedPage({ imageData, pageNumber }) {
  const response = await fetch('/api/document-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData, pageNumber }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Ana could not read page ${pageNumber}.`)
  return data
}

function chunkBlocks(blocks, maxChars = 9500, maxBlocks = 20) {
  const chunks = []
  let current = []
  let chars = 0
  for (const block of blocks) {
    const size = block.text.length + 100
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

async function buildDocumentGuide(layout, target) {
  const source = layoutToPlainText(layout).slice(0, 14000)
  if (!source.trim()) return ''
  try {
    let instructions = `You are preparing a compact internal translation guide for a PDF that will be translated into ${target}. Identify the document's domain, register and recurring terminology that should stay consistent across separate chunks. Preserve product names, acronyms, names, numbers and official terminology. Return no more than 450 characters of plain text. Do not translate the document itself.`
    if (target === 'Hinglish') instructions += ' Hinglish means natural Hindi written in Roman/Latin letters only.'
    return await callAna(source, instructions)
  } catch {
    return ''
  }
}

async function translateLayout(layout, target, onProgress) {
  const chunks = chunkBlocks(layout.blocks)
  const translated = []
  const guide = chunks.length > 1 ? await buildDocumentGuide(layout, target) : ''

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    onProgress?.(index + 1, chunks.length)
    const payload = chunk.map(block => ({
      id: block.id,
      page: block.pageIndex + 1,
      type: block.type,
      text: block.text,
    }))
    let instructions = `You are Ana translating positioned PDF text blocks into ${target}. Translate ONLY each object's text value. Keep every id exactly unchanged. Preserve numbers, names, dates, references, legal clause numbering, technical meaning and document register. Keep repeated terminology consistent across the document. Do not merge, split, reorder or omit blocks. Preserve deliberate line breaks when useful. Return ONLY a valid JSON array in this exact shape: [{"id":"same-id","text":"translated text"}]. No Markdown fences and no commentary.`
    if (guide) instructions += `\nDOCUMENT TRANSLATION GUIDE: ${guide}`
    if (target === 'Hinglish') instructions += ' Hinglish means natural spoken Hindi written entirely in Roman/Latin letters. Never use Devanagari. Keep names, brands, numbers and unavoidable English terms naturally.'
    const raw = await callAna(JSON.stringify(payload), instructions)
    const parsed = parseJson(raw)
    if (!Array.isArray(parsed)) throw new Error('Ana could not keep the document structure intact. Please try again.')

    const byId = new Map(parsed.filter(item => item?.id).map(item => [String(item.id), String(item.text || '')]))
    for (const block of chunk) {
      const value = byId.get(block.id)
      if (!value) throw new Error('A section of the document was missing after translation. Please try again.')
      translated.push({ id: block.id, text: value })
    }
  }

  return translated
}

export default function ScanMode() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [target, setTarget] = useState('German')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [resultBytes, setResultBytes] = useState(null)
  const [resultName, setResultName] = useState('')
  const [progress, setProgress] = useState(0)
  const [downloaded, setDownloaded] = useState(false)

  const busy = ['preparing', 'reading', 'translating', 'building'].includes(status)
  const filename = useMemo(() => file?.name || '', [file])

  const reset = () => {
    setFile(null)
    setStatus('idle')
    setError('')
    setResultBytes(null)
    setResultName('')
    setProgress(0)
    setDownloaded(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const processPdf = async (selected, language = target) => {
    setFile(selected)
    setError('')
    setResultBytes(null)
    setResultName('')
    setDownloaded(false)
    setProgress(6)
    setStatus('preparing')

    try {
      let layout = await extractPdfLayout(selected)

      if (layout.ocrPages?.length) {
        setStatus('reading')
        setProgress(10)
        layout = await enrichScannedPages(selected, layout, readScannedPage, (current, total) => {
          const ratio = total ? current / total : 0
          setProgress(Math.round(10 + ratio * 18))
        })
      }

      if (!layout.blocks.length) {
        throw new Error('Ana could not find readable text in this PDF.')
      }

      setStatus('translating')
      setProgress(30)
      const blocks = await translateLayout(layout, language, (current, total) => {
        const ratio = total ? current / total : 0
        setProgress(Math.round(30 + ratio * 50))
      })

      setStatus('building')
      setProgress(84)
      const bytes = await buildTranslatedPdf(selected, layout, blocks)
      const base = selected.name.replace(/\.pdf$/i, '') || 'document'
      const outputName = `${base}-${language.toLowerCase()}-ana.pdf`

      setResultBytes(bytes)
      setResultName(outputName)
      setProgress(100)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setProgress(0)
      setError(err.message || 'Ana could not create the translated PDF.')
    }
  }

  const chooseFile = selected => {
    if (!selected) return
    const pdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')
    if (!pdf) {
      setError('Please choose a PDF file.')
      return
    }
    if (selected.size > MAX_PDF_BYTES) {
      setError('Please use a PDF smaller than 20 MB for now.')
      return
    }
    processPdf(selected)
  }

  const changeTarget = language => {
    setTarget(language)
    if (file && !busy) processPdf(file, language)
  }

  const downloadResult = () => {
    if (!resultBytes || !resultName) return
    downloadBytes(resultBytes, resultName)
    setDownloaded(true)
  }

  const statusText = status === 'preparing'
    ? 'Understanding the document…'
    : status === 'reading'
      ? 'Reading scanned pages…'
      : status === 'translating'
        ? `Translating to ${target}…`
        : status === 'building'
          ? 'Rebuilding the translated layout…'
          : ''

  return <section className="scan-page scan-direct">
    <header className="scan-hero scan-direct-hero">
      <div className="eyebrow">Ana Documents</div>
      <h1>Give Ana a PDF. Get it back translated.</h1>
      <p>Digital or scanned. Ana reads the layout, translates the document and fits the result back onto the original pages.</p>
    </header>

    <div className="scan-language-row">
      <span>Translate to</span>
      <select value={target} disabled={busy} onChange={e => changeTarget(e.target.value)}>
        {TARGETS.map(lang => <option key={lang}>{lang}</option>)}
      </select>
    </div>

    {status === 'idle' && <button className="scan-direct-drop" onClick={() => inputRef.current?.click()}>
      <span className="scan-direct-icon"><Upload size={25}/></span>
      <strong>Choose PDF</strong>
      <span>Digital or scanned · up to 20 MB</span>
    </button>}

    {busy && <article className="scan-job-card">
      <div className="scan-job-file">
        <span className="scan-file-icon"><FileText size={20}/></span>
        <div><strong>{filename}</strong><span>{statusText}</span></div>
      </div>
      <LoaderCircle className="spin scan-job-spinner" size={22}/>
      <div className="scan-progress-track"><span style={{ width: `${progress}%` }}/></div>
      <p>Ana is preserving the page structure while making room for the translated text.</p>
    </article>}

    {status === 'done' && <article className="scan-result-card">
      <CheckCircle2 size={34}/>
      <div>
        <span className="scan-result-kicker">READY</span>
        <h2>Your translated PDF is ready.</h2>
        <p>{resultName}</p>
      </div>
      <button className="scan-download" onClick={downloadResult}><Download size={18}/> {downloaded ? 'Download again' : 'Download PDF'}</button>
      {downloaded && <p className="scan-download-hint">If your browser opens the PDF instead of saving it, use the browser download icon.</p>}
      <button className="scan-again" onClick={reset}>Translate another PDF</button>
    </article>}

    {status === 'error' && <article className="scan-result-card scan-failed">
      <button className="scan-close" onClick={reset} title="Start again"><X size={18}/></button>
      <h2>This PDF could not be completed.</h2>
      <p>{error}</p>
      <button className="scan-download" onClick={() => inputRef.current?.click()}>Choose another PDF</button>
    </article>}

    {status === 'idle' && error && <div className="scan-error">{error}</div>}

    <input ref={inputRef} className="scan-file-input" type="file" accept="application/pdf,.pdf" onChange={e => chooseFile(e.target.files?.[0])}/>
  </section>
}
