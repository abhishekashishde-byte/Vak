import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, LoaderCircle, Upload, X } from 'lucide-react'
import { buildTranslatedPdf, downloadBytes, enrichScannedPages, extractPdfLayout, layoutToPlainText } from './lib/pdfLayout.js'
import { assessDocumentLayout, combineDocumentQuality } from './lib/documentQuality.js'
import { buildTranslatedDocx, docxLayoutToPlainText, extractDocxLayout } from './lib/docxLayout.js'

const TARGETS = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const MAX_FILE_BYTES = 20 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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
  if (!response.ok) throw new Error(data.error || 'Ana could not read page ' + pageNumber + '.')
  return data
}

function fileKind(selected) {
  const name = selected?.name?.toLowerCase?.() || ''
  if (selected?.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (selected?.type === DOCX_MIME || name.endsWith('.docx')) return 'docx'
  return ''
}

function chunkBlocks(blocks, maxChars = 9500, maxBlocks = 22) {
  const chunks = []
  let current = []
  let chars = 0
  for (const block of blocks) {
    const size = String(block.text || '').length + String(block.context || '').slice(0, 400).length + 120
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

async function buildDocumentGuide(layout, target, kind) {
  const source = (kind === 'docx' ? docxLayoutToPlainText(layout) : layoutToPlainText(layout)).slice(0, 14000)
  if (!source.trim()) return ''
  try {
    let instructions = 'You are preparing a compact internal translation guide for a ' + (kind === 'docx' ? 'Word document' : 'PDF') + ' that will be translated into ' + target + '. Identify the document domain, register and recurring terminology that should stay consistent across separate chunks. Preserve product names, acronyms, names, numbers and official terminology. Return no more than 450 characters of plain text. Do not translate the document itself.'
    if (target === 'Hinglish') instructions += ' Hinglish means natural conversational Hindi written entirely in Roman/Latin letters. Never use Devanagari.'
    return await callAna(source, instructions)
  } catch {
    return ''
  }
}

async function translateLayout(layout, target, onProgress, kind) {
  const chunks = chunkBlocks(layout.blocks)
  const translated = []
  const guide = chunks.length > 1 ? await buildDocumentGuide(layout, target, kind) : ''

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    onProgress?.(index + 1, chunks.length)

    const payload = chunk.map(block => ({
      id: block.id,
      page: kind === 'pdf' ? block.pageIndex + 1 : undefined,
      type: block.type,
      text: block.text,
      context: kind === 'docx' ? block.context : undefined,
    }))

    let instructions
    if (kind === 'docx') {
      instructions = 'You are Ana translating formatting-preserving text segments from a Microsoft Word document into ' + target + '. Translate ONLY each object\'s text value. Keep every id exactly unchanged. The optional context field is the full paragraph and is ONLY for understanding meaning; never translate or return context. Do not move words or meaning between ids. Preserve leading and trailing spaces, punctuation, numbers, names, dates, references, legal clause numbering, technical meaning and document register. Keep repeated terminology consistent. Return ONLY a valid JSON array in this exact shape: [{"id":"same-id","text":"translated text"}]. No Markdown fences and no commentary.'
    } else {
      instructions = 'You are Ana translating positioned PDF text blocks into ' + target + '. Translate ONLY each object\'s text value. Keep every id exactly unchanged. Preserve numbers, names, dates, references, legal clause numbering, technical meaning and document register. Keep repeated terminology consistent across the document. Do not merge, split, reorder or omit blocks. For short form fields, labels, headings and table cells, prefer the shortest natural translation that preserves the full meaning because the available space is limited. Preserve deliberate line breaks when useful. Return ONLY a valid JSON array in this exact shape: [{"id":"same-id","text":"translated text"}]. No Markdown fences and no commentary.'
    }

    if (guide) instructions += '\nDOCUMENT TRANSLATION GUIDE: ' + guide
    if (target === 'Hinglish') instructions += ' Hinglish means natural spoken Hindi written entirely in Roman/Latin letters. Never use Devanagari. Keep names, brands, numbers and unavoidable English terms naturally.'

    const raw = await callAna(JSON.stringify(payload), instructions)
    const parsed = parseJson(raw)
    if (!Array.isArray(parsed)) throw new Error('Ana could not keep the document structure intact. Please try again.')

    const byId = new Map(parsed.filter(item => item?.id).map(item => [String(item.id), String(item.text || '')]))
    for (const block of chunk) {
      const value = byId.get(block.id)
      if (value == null) throw new Error('A section of the document was missing after translation. Please try again.')
      translated.push({ id: block.id, text: value })
    }
  }

  return translated
}

async function rescueDenseTranslations(layout, translated, target, rescueIds) {
  if (!rescueIds?.length) return translated
  const wanted = new Set(rescueIds)
  const translations = new Map(translated.map(item => [item.id, item.text]))
  const payload = layout.blocks.filter(block => wanted.has(block.id)).map(block => ({
    id: block.id,
    page: block.pageIndex + 1,
    type: block.type,
    source: block.text,
    currentTranslation: translations.get(block.id) || '',
  }))
  if (!payload.length) return translated

  let instructions = 'You are doing a layout-rescue pass on a translated PDF. Rewrite ONLY currentTranslation into a more compact natural ' + target + ' version when this can be done WITHOUT losing any factual, legal, medical, technical or procedural meaning. Preserve every number, date, name, reference, condition, negation, obligation, permission and qualifier exactly in meaning. Do not use unexplained abbreviations. For labels, headings and table cells, prefer conventional short wording. If shortening would lose meaning, return the current translation unchanged. Keep every id unchanged. Return ONLY JSON: [{"id":"same-id","text":"compact translation"}].'
  if (target === 'Hinglish') instructions += ' Hinglish must remain Roman/Latin-script Hindi only.'

  try {
    const parsed = parseJson(await callAna(JSON.stringify(payload), instructions))
    if (!Array.isArray(parsed)) return translated
    const replacements = new Map(parsed.filter(item => item?.id).map(item => [String(item.id), String(item.text || '').trim()]))
    return translated.map(item => replacements.get(item.id) ? { ...item, text: replacements.get(item.id) } : item)
  } catch {
    return translated
  }
}

function qualityMessage(quality) {
  if (!quality?.review) return ''
  const parts = []
  if (quality.layoutIssues) parts.push(quality.layoutIssues + ' very dense text area' + (quality.layoutIssues === 1 ? '' : 's'))
  if (quality.handwritten) parts.push(quality.handwritten + ' handwritten area' + (quality.handwritten === 1 ? '' : 's'))
  if (quality.lowConfidence) parts.push(quality.lowConfidence + ' hard-to-read area' + (quality.lowConfidence === 1 ? '' : 's'))
  const pages = quality.pages?.length ? ' Page' + (quality.pages.length === 1 ? '' : 's') + ' ' + quality.pages.join(', ') + '.' : ''
  return (parts.join(', ') || 'A few areas') + ' may need a quick visual check.' + pages
}

function translatedPdfPlainText(layout, translations) {
  const map = new Map(translations.map(item => [item.id, item.text]))
  return (layout.blocks || []).map(block => map.get(block.id) || '').filter(Boolean).join('\n\n')
}

function previewText(value) {
  const text = String(value || '').trim()
  return text.length > 24000
    ? text.slice(0, 24000) + '\n\n… Preview shortened. The exported document contains the complete translation.'
    : text
}

export default function ScanMode() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState('')
  const [target, setTarget] = useState('German')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [resultBytes, setResultBytes] = useState(null)
  const [resultName, setResultName] = useState('')
  const [resultMime, setResultMime] = useState('application/pdf')
  const [progress, setProgress] = useState(0)
  const [downloaded, setDownloaded] = useState(false)
  const [quality, setQuality] = useState(null)
  const [sourcePreview, setSourcePreview] = useState('')
  const [translatedPreview, setTranslatedPreview] = useState('')
  const [previewMode, setPreviewMode] = useState('compare')

  const busy = ['preparing', 'reading', 'translating', 'checking', 'optimizing', 'building'].includes(status)
  const filename = useMemo(() => file?.name || '', [file])

  const reset = () => {
    setFile(null)
    setKind('')
    setStatus('idle')
    setError('')
    setResultBytes(null)
    setResultName('')
    setResultMime('application/pdf')
    setProgress(0)
    setDownloaded(false)
    setQuality(null)
    setSourcePreview('')
    setTranslatedPreview('')
    setPreviewMode('compare')
    if (inputRef.current) inputRef.current.value = ''
  }

  const processPdf = async (selected, language) => {
    let layout = await extractPdfLayout(selected)
    const scanSignals = []

    if (layout.ocrPages?.length) {
      setStatus('reading')
      setProgress(10)
      layout = await enrichScannedPages(selected, layout, async args => {
        const result = await readScannedPage(args)
        scanSignals.push({
          pageNumber: args.pageNumber,
          lowConfidenceCount: Number(result.lowConfidenceCount || 0),
          handwrittenCount: Number(result.handwrittenCount || 0),
        })
        return result
      }, (current, total) => {
        const ratio = total ? current / total : 0
        setProgress(Math.round(10 + ratio * 18))
      })
    }

    if (!layout.blocks.length) throw new Error('Ana could not find readable text in this PDF.')
    setSourcePreview(previewText(layoutToPlainText(layout)))

    setStatus('translating')
    setProgress(30)
    let blocks = await translateLayout(layout, language, (current, total) => {
      const ratio = total ? current / total : 0
      setProgress(Math.round(30 + ratio * 48))
    }, 'pdf')

    setStatus('checking')
    setProgress(80)
    let layoutReport = assessDocumentLayout(layout, blocks)

    if (layoutReport.rescueIds?.length) {
      setStatus('optimizing')
      setProgress(84)
      blocks = await rescueDenseTranslations(layout, blocks, language, layoutReport.rescueIds)
      layoutReport = assessDocumentLayout(layout, blocks)
    }

    setStatus('building')
    setProgress(90)
    const bytes = await buildTranslatedPdf(selected, layout, blocks)
    const finalQuality = combineDocumentQuality(layoutReport, scanSignals)
    const base = selected.name.replace(/\.pdf$/i, '') || 'document'

    setTranslatedPreview(previewText(translatedPdfPlainText(layout, blocks)))
    setQuality(finalQuality)
    setResultBytes(bytes)
    setResultName(base + '-' + language.toLowerCase() + '-ana.pdf')
    setResultMime('application/pdf')
  }

  const processDocx = async (selected, language) => {
    const layout = await extractDocxLayout(selected)
    if (!layout.blocks.length) throw new Error('Ana could not find translatable text in this Word document.')

    setSourcePreview(previewText(docxLayoutToPlainText(layout)))
    setStatus('translating')
    setProgress(28)

    const blocks = await translateLayout(layout, language, (current, total) => {
      const ratio = total ? current / total : 0
      setProgress(Math.round(28 + ratio * 56))
    }, 'docx')

    setStatus('building')
    setProgress(90)

    const bytes = await buildTranslatedDocx(selected, layout, blocks)
    const base = selected.name.replace(/\.docx$/i, '') || 'document'

    setTranslatedPreview(previewText(docxLayoutToPlainText(layout, blocks)))
    setQuality({ review: false, wordFormattingPreserved: true })
    setResultBytes(bytes)
    setResultName(base + '-' + language.toLowerCase() + '-ana.docx')
    setResultMime(DOCX_MIME)
  }

  const processFile = async (selected, language = target) => {
    const detected = fileKind(selected)
    setFile(selected)
    setKind(detected)
    setError('')
    setResultBytes(null)
    setResultName('')
    setDownloaded(false)
    setQuality(null)
    setSourcePreview('')
    setTranslatedPreview('')
    setProgress(6)
    setStatus('preparing')

    try {
      if (detected === 'pdf') await processPdf(selected, language)
      else if (detected === 'docx') await processDocx(selected, language)
      else throw new Error('Please choose a PDF or Word (.docx) file.')

      setProgress(100)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setProgress(0)
      setError(err.message || 'Ana could not create the translated document.')
    }
  }

  const chooseFile = selected => {
    if (!selected) return
    const detected = fileKind(selected)

    if (!detected) {
      setError('Please choose a PDF or Word (.docx) file.')
      return
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError('Please use a document smaller than 20 MB for now.')
      return
    }

    processFile(selected)
  }

  const changeTarget = language => {
    setTarget(language)
    if (file && !busy) processFile(file, language)
  }

  const downloadResult = () => {
    if (!resultBytes || !resultName) return
    downloadBytes(resultBytes, resultName, resultMime)
    setDownloaded(true)
  }

  const statusText = status === 'preparing'
    ? 'Understanding the document…'
    : status === 'reading'
      ? 'Reading scanned pages…'
      : status === 'translating'
        ? 'Translating to ' + target + '…'
        : status === 'checking'
          ? 'Checking the translated layout…'
          : status === 'optimizing'
            ? 'Making dense areas fit naturally…'
            : status === 'building'
              ? 'Rebuilding the translated document…'
              : ''

  const formatLabel = kind === 'docx' ? 'Word' : 'PDF'

  return <section className="scan-page scan-direct">
    <header className="scan-hero scan-direct-hero">
      <div className="eyebrow">Ana Documents</div>
      <h1>Translate the document. Keep the document.</h1>
      <p>PDF or Word. Ana preserves structure, formatting, tables, images, headers and the document’s visual hierarchy while translating the text.</p>
    </header>

    <div className="scan-language-row">
      <span>Translate to</span>
      <select value={target} disabled={busy} onChange={e => changeTarget(e.target.value)}>
        {TARGETS.map(lang => <option key={lang}>{lang}</option>)}
      </select>
    </div>

    {status === 'idle' && <button className="scan-direct-drop" onClick={() => inputRef.current?.click()}>
      <span className="scan-direct-icon"><Upload size={25}/></span>
      <strong>Choose PDF or Word</strong>
      <span>PDF, scanned PDF or .docx · up to 20 MB</span>
    </button>}

    {busy && <article className="scan-job-card">
      <div className="scan-job-file">
        <span className="scan-file-icon"><FileText size={20}/></span>
        <div><strong>{filename}</strong><span>{statusText}</span></div>
      </div>
      <LoaderCircle className="spin scan-job-spinner" size={22}/>
      <div className="scan-progress-track"><span style={{ width: progress + '%' }}/></div>
      <p>{kind === 'docx'
        ? 'Ana is translating inside the Word structure so editable formatting is retained.'
        : 'Ana is preserving the page structure while making room for the translated text.'}</p>
    </article>}

    {status === 'done' && <article className="scan-result-card">
      {quality?.review ? <AlertTriangle size={34}/> : <CheckCircle2 size={34}/>}
      <div>
        <span className="scan-result-kicker">READY · {formatLabel.toUpperCase()}</span>
        <h2>{quality?.review
          ? 'Your translated PDF is ready — with a quick-check note.'
          : 'Your translated ' + formatLabel + ' document is ready.'}</h2>
        <p>{resultName}</p>
      </div>

      {quality?.review && <p className="scan-download-hint"><strong>Quick visual check recommended.</strong> {qualityMessage(quality)}</p>}
      {kind === 'docx' && <p className="scan-download-hint"><strong>Editable Word output.</strong> Ana keeps the existing DOCX structure, including tables, headers, footers, images and text styling. Word can naturally reflow translated text when it is longer than the source.</p>}

      <div className="scan-preview-tabs" role="tablist" aria-label="Document preview">
        <button className={previewMode === 'original' ? 'active' : ''} onClick={() => setPreviewMode('original')}>Original</button>
        <button className={previewMode === 'translated' ? 'active' : ''} onClick={() => setPreviewMode('translated')}>Translated</button>
        <button className={previewMode === 'compare' ? 'active' : ''} onClick={() => setPreviewMode('compare')}>Compare</button>
      </div>

      <div className={'scan-text-preview ' + previewMode}>
        {(previewMode === 'original' || previewMode === 'compare') && <section>
          <span>ORIGINAL</span>
          <pre>{sourcePreview || 'No text preview available.'}</pre>
        </section>}
        {(previewMode === 'translated' || previewMode === 'compare') && <section>
          <span>TRANSLATED</span>
          <pre>{translatedPreview || 'No translated preview available.'}</pre>
        </section>}
      </div>

      <button className="scan-download" onClick={downloadResult}><Download size={18}/> {downloaded ? 'Download again' : 'Download ' + formatLabel}</button>
      {downloaded && <p className="scan-download-hint">The exported file contains the complete translated document, not the shortened on-screen text preview.</p>}
      <button className="scan-again" onClick={reset}>Translate another document</button>
    </article>}

    {status === 'error' && <article className="scan-result-card scan-failed">
      <button className="scan-close" onClick={reset} title="Start again"><X size={18}/></button>
      <h2>This document could not be completed.</h2>
      <p>{error}</p>
      <button className="scan-download" onClick={() => inputRef.current?.click()}>Choose another document</button>
    </article>}

    {status === 'idle' && error && <div className="scan-error">{error}</div>}

    <input
      ref={inputRef}
      className="scan-file-input"
      type="file"
      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
      onChange={e => chooseFile(e.target.files?.[0])}
    />
  </section>
}
