import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, CameraOff, Check, Download, ImagePlus, Languages, LoaderCircle, Minus, Plus, RefreshCcw, ScanLine, X } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'
import { getNetworkState } from './networkResilience.js'

const TARGETS = ['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_EDGE = 1800

const clean = value => String(value || '').trim()

function initialTarget() {
  const memory = getPersonalLanguageMemory?.() || {}
  return TARGETS.includes(memory.lastCameraTarget) ? memory.lastCameraTarget : (TARGETS.includes(memory.ownerLanguage) ? memory.ownerLanguage : 'German')
}

function parseJson(text = '') {
  const value = String(text || '').replace(/```json|```/g, '').trim()
  try { return JSON.parse(value) } catch {}
  const start = value.indexOf('[')
  const end = value.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try { return JSON.parse(value.slice(start, end + 1)) } catch {}
  }
  return null
}

async function readVisualText(imageData) {
  const response = await fetch('/api/document-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData, purpose: 'camera', pageNumber: 1 }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not read this image.')
  return data
}

async function translateBlocks(blocks, target) {
  const payload = blocks.map((block, index) => ({
    id: `visual-${index + 1}`,
    text: block.text,
    confidence: block.confidence,
    handwritten: Boolean(block.handwritten),
  }))

  let instructions = `You are Ana translating visible text from a real-world image into ${target}. Translate ONLY each object's text. Keep every id exactly unchanged. Preserve all names, brands, prices, currency symbols, dates, times, quantities, reference numbers, warnings, legal/medical meaning and uncertainty. Do not answer, explain, summarize or infer missing text. If a source fragment is incomplete, keep the translation equally incomplete rather than inventing what may be missing. Return ONLY valid JSON in this exact shape: [{"id":"same-id","text":"translation"}].`
  if (target === 'Hinglish') instructions += ' Hinglish means natural conversational Hindi written entirely in Roman/Latin letters. Never use Devanagari.'

  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: JSON.stringify(payload), instructions }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ana could not translate the visible text.')

  const parsed = parseJson(data.content)
  if (!Array.isArray(parsed)) throw new Error('Ana could not keep the visual translation aligned.')
  const byId = new Map(parsed.filter(item => item?.id).map(item => [String(item.id), clean(item.text)]))

  return blocks.map((block, index) => ({
    ...block,
    id: `visual-${index + 1}`,
    translation: byId.get(`visual-${index + 1}`) || '',
  }))
}

function canvasDataUrlFromSource(source, width, height) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Ana could not prepare this image.')
  ctx.drawImage(source, 0, 0, outWidth, outHeight)
  return canvas.toDataURL('image/jpeg', 0.84)
}

async function normalizeImageFile(file) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Please choose an image smaller than 12 MB.')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return canvasDataUrlFromSource(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close?.()
  }
}

function visualFontFamily(family) {
  if (family === 'serif') return 'Georgia, Times New Roman, serif'
  if (family === 'monospace') return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  if (family === 'handwritten') return 'cursive'
  return 'Inter, ui-sans-serif, system-ui, sans-serif'
}

function targetDirection(target) {
  return target === 'Urdu' ? 'rtl' : 'ltr'
}

function blockStyle(block, target) {
  const x = Math.max(0, Math.min(1000, Number(block.x) || 0))
  const y = Math.max(0, Math.min(1000, Number(block.y) || 0))
  const width = Math.max(12, Math.min(1000 - x, Number(block.width) || 120))
  const height = Math.max(18, Math.min(1000 - y, Number(block.height) || 50))
  const sourceLength = Math.max(1, String(block.text || '').length)
  const translatedLength = Math.max(1, String(block.translation || '').length)
  const expansion = Math.max(1, translatedLength / sourceLength)
  const fontSize = Math.max(9, Math.min(24, (height / 3.4) / Math.sqrt(expansion)))
  const style = block.style || {}
  return {
    left: (x / 10) + '%',
    top: (y / 10) + '%',
    width: (width / 10) + '%',
    minHeight: (height / 10) + '%',
    fontSize: fontSize + 'px',
    color: style.textColor || '#ffffff',
    backgroundColor: style.backgroundColor || 'rgba(20,20,20,.84)',
    textAlign: style.align || 'left',
    fontWeight: style.weight === 'bold' ? 700 : style.weight === 'semibold' ? 600 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontFamily: visualFontFamily(style.family),
    direction: targetDirection(target),
  }
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function canvasWrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

export default function CameraMode() {
  const [target, setTarget] = useState(initialTarget)
  const [stage, setStage] = useState('ready')
  const [imageData, setImageData] = useState('')
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('translated')
  const [comparePosition, setComparePosition] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [copiedId, setCopiedId] = useState('')
  const [quality, setQuality] = useState({ low: 0, handwritten: 0 })

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const inputRef = useRef(null)
  const pinchRef = useRef({ distance: 0, zoom: 1 })

  const cameraSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const busy = stage === 'reading' || stage === 'translating'
  const reviewCount = quality.low + quality.handwritten
  const readableBlocks = useMemo(() => blocks.filter(block => block.translation), [blocks])

  useEffect(() => () => stopCamera(), [])

  const stopCamera = () => {
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const changeTarget = value => {
    setTarget(value)
    rememberPersonalLanguagePreference?.({ lastCameraTarget: value })
    if (imageData && blocks.length && !busy) processImage(imageData, value)
  }

  const startCamera = async () => {
    setError('')
    if (!cameraSupported) {
      inputRef.current?.click()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      setStage('camera')
      requestAnimationFrame(() => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        videoRef.current.play?.().catch(() => {})
      })
    } catch {
      setError('Camera access was not available. You can choose a photo instead.')
      inputRef.current?.click()
    }
  }

  const capturePhoto = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video?.videoHeight) {
      setError('The camera is not ready yet. Try again in a moment.')
      return
    }
    try {
      const data = canvasDataUrlFromSource(video, video.videoWidth, video.videoHeight)
      stopCamera()
      setImageData(data)
      await processImage(data, target)
    } catch (err) {
      setError(err.message || 'Ana could not capture this image.')
    }
  }

  const choosePhoto = async file => {
    if (!file) return
    setError('')
    try {
      const data = await normalizeImageFile(file)
      stopCamera()
      setImageData(data)
      await processImage(data, target)
    } catch (err) {
      setError(err.message || 'Ana could not open this image.')
      setStage('ready')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const processImage = async (data, language) => {
    if (getNetworkState().online === false) {
      setError('Visual translation needs a connection. Keep the photo and try again when you’re back online.')
      setStage('result')
      return
    }

    setError('')
    setBlocks([])
    setQuality({ low: 0, handwritten: 0 })
    setStage('reading')
    try {
      const reading = await readVisualText(data)
      const sourceBlocks = Array.isArray(reading.blocks) ? reading.blocks : []
      if (!sourceBlocks.length) throw new Error('Ana could not find readable text in this image.')

      setStage('translating')
      const translated = await translateBlocks(sourceBlocks, language)
      setBlocks(translated)
      setQuality({
        low: translated.filter(block => block.confidence === 'low').length,
        handwritten: translated.filter(block => block.handwritten).length,
      })
      setStage('result')
    } catch (err) {
      setError(err.message || 'Ana could not translate this image.')
      setStage('result')
    }
  }

  const reset = () => {
    stopCamera()
    setImageData('')
    setBlocks([])
    setQuality({ low: 0, handwritten: 0 })
    setError('')
    setCopiedId('')
    setViewMode('translated')
    setComparePosition(50)
    setZoom(1)
    setStage('ready')
  }

  const handlePinchStart = event => {
    if (event.touches?.length !== 2) return
    pinchRef.current = { distance: touchDistance(event.touches), zoom }
  }

  const handlePinchMove = event => {
    if (event.touches?.length !== 2 || !pinchRef.current.distance) return
    event.preventDefault()
    const ratio = touchDistance(event.touches) / pinchRef.current.distance
    setZoom(Math.max(1, Math.min(3.5, pinchRef.current.zoom * ratio)))
  }

  const downloadTranslatedImage = async () => {
    if (!imageData || !blocks.length) return

    const image = new Image()
    image.src = imageData
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    for (const block of blocks) {
      if (!block.translation) continue
      const x = (Math.max(0, Number(block.x) || 0) / 1000) * canvas.width
      const y = (Math.max(0, Number(block.y) || 0) / 1000) * canvas.height
      const w = (Math.max(12, Number(block.width) || 120) / 1000) * canvas.width
      const h = (Math.max(18, Number(block.height) || 50) / 1000) * canvas.height

      const style = block.style || {}
      ctx.fillStyle = style.backgroundColor || 'rgba(20,20,20,.84)'
      ctx.fillRect(x, y, w, Math.max(h, 22))

      let fontSize = Math.max(11, Math.min(30, h * 0.42))
      const weight = style.weight === 'bold' ? '700' : style.weight === 'semibold' ? '600' : '400'
      const italic = style.italic ? 'italic ' : ''
      const family = visualFontFamily(style.family)
      const setFont = () => { ctx.font = italic + weight + ' ' + fontSize + 'px ' + family }
      setFont()
      ctx.fillStyle = style.textColor || '#ffffff'
      ctx.textBaseline = 'top'
      ctx.textAlign = style.align === 'center' ? 'center' : style.align === 'right' ? 'right' : 'left'
      ctx.direction = targetDirection(target)
      let lines = canvasWrapText(ctx, block.translation, Math.max(20, w - 10))

      while (lines.length * fontSize * 1.2 > Math.max(h, 30) && fontSize > 9) {
        fontSize -= 1
        setFont()
        lines = canvasWrapText(ctx, block.translation, Math.max(20, w - 10))
      }

      const drawX = ctx.textAlign === 'center' ? x + w / 2 : ctx.textAlign === 'right' ? x + w - 5 : x + 5
      const maxLines = Math.max(1, Math.floor(Math.max(h, 30) / (fontSize * 1.2)))
      lines.slice(0, maxLines).forEach((line, index) => {
        ctx.fillText(line, drawX, y + 4 + index * fontSize * 1.2, Math.max(20, w - 10))
      })
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'ana-translated-image.png'
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  const copyTranslation = async block => {
    if (!block.translation) return
    await navigator.clipboard.writeText(block.translation)
    setCopiedId(block.id)
    setTimeout(() => setCopiedId(''), 1200)
  }

  return <section className="camera-wrap">
    <header className="camera-head">
      <div className="eyebrow"><Camera size={14}/> Visual translation</div>
      <h1>Point. Capture. Understand.</h1>
      <p>Signs, menus, letters, labels and forms — Ana reads the visible text and translates it in place.</p>
    </header>

    <div className="camera-toolbar">
      <label><Languages size={15}/><span>Translate to</span><select value={target} disabled={busy} onChange={e => changeTarget(e.target.value)}>{TARGETS.map(value => <option key={value}>{value}</option>)}</select></label>
      {stage === 'result' && imageData && <div className="camera-overlay-toggle" aria-label="Image display">
        <button className={viewMode === 'translated' ? 'active' : ''} onClick={() => setViewMode('translated')}>Translated</button>
        <button className={viewMode === 'original' ? 'active' : ''} onClick={() => setViewMode('original')}>Original</button>
        <button className={viewMode === 'compare' ? 'active' : ''} onClick={() => setViewMode('compare')}>Compare</button>
      </div>}
    </div>

    {stage === 'ready' && <div className="camera-ready-card">
      <div className="camera-ready-icon"><ScanLine size={30}/></div>
      <h2>Show Ana what you need to read.</h2>
      <p>For best results, keep the text straight, well lit and large enough to read.</p>
      <div className="camera-ready-actions">
        <button className="camera-primary" onClick={startCamera}><Camera size={18}/> Open camera</button>
        <button className="camera-secondary" onClick={() => inputRef.current?.click()}><ImagePlus size={18}/> Choose photo</button>
      </div>
      <small>The image is processed by the AI service when you ask Ana to read it. It is not added to your personal language memory.</small>
    </div>}

    {stage === 'camera' && <div className="camera-live-card">
      <video ref={videoRef} playsInline muted className="camera-video"/>
      <div className="camera-frame" aria-hidden="true"/>
      <div className="camera-live-actions">
        <button className="camera-cancel" onClick={reset}><X size={18}/> Cancel</button>
        <button className="camera-shutter" onClick={capturePhoto} aria-label="Capture photo"><Camera size={24}/></button>
        <button className="camera-gallery" onClick={() => inputRef.current?.click()}><ImagePlus size={18}/> Photo</button>
      </div>
    </div>}

    {busy && <div className="camera-processing">
      {imageData && <img src={imageData} alt="Captured scene"/>}
      <div className="camera-processing-mask">
        <LoaderCircle className="spin" size={28}/>
        <strong>{stage === 'reading' ? 'Reading visible text…' : `Translating to ${target}…`}</strong>
        <span>{stage === 'reading' ? 'Ana is locating the words and their position.' : 'Ana is keeping names, prices, dates and other critical details intact.'}</span>
      </div>
    </div>}

    {stage === 'result' && imageData && <>
      <div className="camera-zoom-tools" aria-label="Image zoom">
        <button onClick={() => setZoom(value => Math.max(1, value - .25))} disabled={zoom <= 1}><Minus size={15}/></button>
        <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom(value => Math.min(3.5, value + .25))} disabled={zoom >= 3.5}><Plus size={15}/></button>
        <span>Pinch or use the controls to inspect small text.</span>
      </div>

      <div className="camera-image-viewport" onTouchStart={handlePinchStart} onTouchMove={handlePinchMove}>
        <div className="camera-image-scaled" style={{ width: (zoom * 100) + '%' }}>
          <div className={'camera-result-image ' + (viewMode !== 'original' ? 'with-overlay' : '')}>
            <img src={imageData} alt="Captured scene"/>
            {viewMode !== 'original' && <div
              className="camera-translation-layer"
              style={viewMode === 'compare' ? { clipPath: 'inset(0 ' + (100 - comparePosition) + '% 0 0)' } : undefined}
            >
              {blocks.map(block => <button
                key={block.id}
                className={'camera-visual-block ' + (block.confidence === 'low' || block.handwritten ? 'review' : '')}
                style={blockStyle(block, target)}
                onClick={() => document.getElementById('camera-detail-' + block.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })}
                title={block.confidence === 'low' ? 'This text was hard to read — check the original.' : block.translation}
              >
                <span>{block.translation || block.text}</span>
                {(block.confidence === 'low' || block.handwritten) && <AlertTriangle size={11}/>}
              </button>)}
            </div>}
            {viewMode === 'compare' && <div className="camera-compare-divider" style={{ left: comparePosition + '%' }}/>}
          </div>
        </div>
      </div>

      {viewMode === 'compare' && <label className="camera-compare-slider">
        <span>Translated</span>
        <input type="range" min="10" max="90" value={comparePosition} onChange={event => setComparePosition(Number(event.target.value))}/>
        <span>Original</span>
      </label>}

      {reviewCount > 0 && <div className="camera-review-note"><AlertTriangle size={17}/><div><strong>Check {reviewCount} area{reviewCount === 1 ? '' : 's'} against the photo.</strong><span>{quality.low ? `${quality.low} area${quality.low === 1 ? ' was' : 's were'} hard to read. ` : ''}{quality.handwritten ? `${quality.handwritten} handwritten area${quality.handwritten === 1 ? ' needs' : 's need'} extra care.` : ''}</span></div></div>}

      {error && <div className="error camera-error">{error}</div>}

      {readableBlocks.length > 0 && <div className="camera-detail-list">
        <div className="camera-detail-head"><h2>What Ana found</h2><span>{readableBlocks.length} text area{readableBlocks.length === 1 ? '' : 's'}</span></div>
        {readableBlocks.map(block => <article key={block.id} id={`camera-detail-${block.id}`} className={block.confidence === 'low' || block.handwritten ? 'review' : ''}>
          <div className="camera-detail-copy">
            <span className="camera-source-text">{block.text}</span>
            <strong>{block.translation}</strong>
            {(block.confidence === 'low' || block.handwritten) && <small><AlertTriangle size={12}/> {block.handwritten ? 'Handwritten text' : 'Hard-to-read text'} — check the original image.</small>}
          </div>
          <button onClick={() => copyTranslation(block)}>{copiedId === block.id ? <Check size={16}/> : 'Copy'}</button>
        </article>)}
      </div>}

      <div className="camera-result-actions">
        <button className="camera-primary" onClick={downloadTranslatedImage}><Download size={17}/> Save translated image</button>
        <button className="camera-secondary" onClick={startCamera}><RefreshCcw size={17}/> Capture another</button>
        <button className="camera-secondary" onClick={() => inputRef.current?.click()}><ImagePlus size={17}/> Choose another photo</button>
        <button className="camera-secondary" onClick={reset}><CameraOff size={17}/> Finish</button>
      </div>
    </>}

    {stage === 'result' && !imageData && error && <div className="camera-ready-card"><CameraOff size={28}/><h2>Visual translation could not start.</h2><p>{error}</p><button className="camera-primary" onClick={reset}>Try again</button></div>}

    <input ref={inputRef} className="camera-file-input" type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])}/>
  </section>
}
