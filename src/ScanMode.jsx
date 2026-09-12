import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, LoaderCircle, Upload, X } from 'lucide-react'
import { buildTranslatedPdf, downloadBytes, extractPdfLayout } from './lib/pdfLayout.js'

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
    let instructions = `You are Ana translating positioned PDF text blocks into ${target}. Translate ONLY each object's text value. Keep every id exactly unchanged. Preserve numbers, names, dates, references, legal clause numbering and meaning. Do not merge, split, reorder or omit blocks. Return ONLY a valid JSON array in this exact shape: [{"id":"same-id","text":"translated text"}]. No Markdown fences and no commentary.`
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

  const busy = ['preparing', 'translating', 'building'].includes(status)
  const filename = useMemo(() => file?.name || '', [file])

  const reset = () => {
    setFile(null)
    setStatus('idle')
    setError('')
    setResultBytes(null)
    setResultName('')
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  const processPdf = async (selected, language = target) => {
    setFile(selected)
    setError('')
    setResultBytes(null)
    setResultName('')
    setProgress(8)
    setStatus('preparing')

    try {
      const layout = await extractPdfLayout(selected)
      if (layout.emptyPages.length) {
        throw new Error('This PDF contains scanned/image-only pages. Automatic OCR for those pages is not connected yet.')
      }

      setStatus('translating')
      setProgress(18)
      const blocks = await translateLayout(layout, language, (current, total) => {
        const ratio = total ? current / total : 0
        setProgress(Math.round(18 + ratio * 62))
      })

      setStatus('building')
      setProgress(86)
      const bytes = await buildTranslatedPdf(selected, layout, blocks)
      const base = selected.name.replace(/\.pdf$/i, '') || 'document'
      const outputName = `${base}-${language.toLowerCase()}-ana.pdf`

      setResultBytes(bytes)
      setResultName(outputName)
      setProgress(100)
      setStatus('done')
      downloadBytes(bytes, outputName)
    } catch (err) {
      setStatus('error')
      setProgress(0)
      if (err?.code === 'SCANNED_PDF') {
        setError('This PDF is image-only. Ana needs the OCR fallback before it can rebuild this type of document.')
      } else {
        setError(err.message || 'Ana could not create the translated PDF.')
      }
    }
  }

  const chooseFile = selected => {
    if (!selected) return
    const pdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')
    if (!pdf) {
      setError('Please upload a PDF. Image and scanned-document reconstruction will be added through the OCR fallback.')
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

  const downloadAgain = () => {
    if (resultBytes && resultName) downloadBytes(resultBytes, resultName)
  }

  const statusText = status === 'preparing'
    ? 'Preparing your document…'
    : status === 'translating'
      ? `Translating to ${target}…`
      : status === 'building'
        ? 'Creating your translated PDF…'
        : ''

  return <section className="scan-page scan-direct">
    <header className="scan-hero scan-direct-hero">
      <div className="eyebrow">Ana Documents</div>
      <h1>Give Ana a PDF. Get it back translated.</h1>
      <p>Formatting stays on the original document canvas. The reading, layout detection and reconstruction happen automatically.</p>
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
      <span>Up to 20 MB</span>
    </button>}

    {busy && <article className="scan-job-card">
      <div className="scan-job-file">
        <span className="scan-file-icon"><FileText size={20}/></span>
        <div><strong>{filename}</strong><span>{statusText}</span></div>
      </div>
      <LoaderCircle className="spin scan-job-spinner" size={22}/>
      <div className="scan-progress-track"><span style={{ width: `${progress}%` }}/></div>
      <p>You do not need to do anything else. Ana will download the finished PDF when it is ready.</p>
    </article>}

    {status === 'done' && <article className="scan-result-card">
      <CheckCircle2 size={34}/>
      <div>
        <span className="scan-result-kicker">READY</span>
        <h2>Your translated PDF is ready.</h2>
        <p>{resultName}</p>
      </div>
      <button className="scan-download" onClick={downloadAgain}><Download size={18}/> Download PDF</button>
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
