import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, CameraOff, Check, ImagePlus, Languages, LoaderCircle, RefreshCcw, ScanLine, X } from 'lucide-react'
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

function blockStyle(block) {
  const x = Math.max(0, Math.min(1000, Number(block.x) || 0))
  const y = Math.max(0, Math.min(1000, Number(block.y) || 0))
  const width = Math.max(12, Math.min(1000 - x, Number(block.width) || 120))
  const height = Math.max(18, Math.min(1000 - y, Number(block.height) || 50))
  return {
    left: `${x / 10}%`,
    top: `${y / 10}%`,
    width: `${width / 10}%`,
    minHeight: `${height / 10}%`,
  }
}

export default function CameraMode() {
  const [target, setTarget] = useState(initialTarget)
  const [stage, setStage] = useState('ready')
  const [imageData, setImageData] = useState('')
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')
  const [overlay, setOverlay] = useState(true)
  const [copiedId, setCopiedId] = useState('')
  const [quality, setQuality] = useState({ low: 0, handwritten: 0 })

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const inputRef = useRef(null)

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
    setStage('ready')
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
        <button className={overlay ? 'active' : ''} onClick={() => setOverlay(true)}>Translated overlay</button>
        <button className={!overlay ? 'active' : ''} onClick={() => setOverlay(false)}>Original photo</button>
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
      <div className={`camera-result-image ${overlay ? 'with-overlay' : ''}`}>
        <img src={imageData} alt="Captured scene"/>
        {overlay && blocks.map(block => <button
          key={block.id}
          className={`camera-visual-block ${block.confidence === 'low' || block.handwritten ? 'review' : ''}`}
          style={blockStyle(block)}
          onClick={() => document.getElementById(`camera-detail-${block.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })}
          title={block.confidence === 'low' ? 'This text was hard to read — check the original.' : block.translation}
        >
          <span>{block.translation || block.text}</span>
          {(block.confidence === 'low' || block.handwritten) && <AlertTriangle size={11}/>} 
        </button>)}
      </div>

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
        <button className="camera-primary" onClick={startCamera}><RefreshCcw size={17}/> Capture another</button>
        <button className="camera-secondary" onClick={() => inputRef.current?.click()}><ImagePlus size={17}/> Choose another photo</button>
        <button className="camera-secondary" onClick={reset}><CameraOff size={17}/> Finish</button>
      </div>
    </>}

    {stage === 'result' && !imageData && error && <div className="camera-ready-card"><CameraOff size={28}/><h2>Visual translation could not start.</h2><p>{error}</p><button className="camera-primary" onClick={reset}>Try again</button></div>}

    <input ref={inputRef} className="camera-file-input" type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])}/>
  </section>
}
