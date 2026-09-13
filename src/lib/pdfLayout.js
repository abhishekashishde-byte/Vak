import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const median = values => {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!nums.length) return 10
  const middle = Math.floor(nums.length / 2)
  return nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2
}

function normaliseItem(item) {
  const transform = item.transform || [1, 0, 0, 1, 0, 0]
  const fontSize = Math.max(5, Math.hypot(transform[2], transform[3]) || item.height || 10)
  return {
    text: String(item.str || '').trim(),
    x: Number(transform[4] || 0),
    y: Number(transform[5] || 0),
    width: Math.max(Number(item.width || 0), 1),
    height: Math.max(Number(item.height || fontSize), fontSize),
    fontSize,
  }
}

function buildLines(items) {
  const sorted = [...items].sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x)
  const lines = []

  for (const item of sorted) {
    if (!item.text) continue
    const tolerance = Math.max(2.5, item.fontSize * 0.34)
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= tolerance)
    if (!line) {
      line = { y: item.y, items: [] }
      lines.push(line)
    }
    line.items.push(item)
    line.y = line.items.reduce((sum, value) => sum + value.y, 0) / line.items.length
  }

  for (const line of lines) line.items.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => b.y - a.y)
}

function splitLineIntoSegments(line) {
  const segments = []
  let current = []
  for (const item of line.items) {
    if (!current.length) {
      current.push(item)
      continue
    }
    const previous = current[current.length - 1]
    const gap = item.x - (previous.x + previous.width)
    const threshold = Math.max(28, Math.max(previous.fontSize, item.fontSize) * 2.2)
    if (gap > threshold) {
      segments.push(current)
      current = [item]
    } else {
      current.push(item)
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function segmentBounds(segment) {
  return {
    minX: Math.min(...segment.map(item => item.x)),
    maxX: Math.max(...segment.map(item => item.x + item.width)),
  }
}

function segmentToBlock(segment, pageIndex, id, type = 'paragraph', widthHint = null) {
  const { minX, maxX } = segmentBounds(segment)
  const fontSize = median(segment.map(item => item.fontSize))
  const baseline = median(segment.map(item => item.y))
  const text = segment.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()
  return {
    id,
    pageIndex,
    type,
    text,
    x: minX,
    y: baseline - fontSize * 0.28,
    width: Math.max(widthHint || 0, maxX - minX, fontSize * 2),
    height: fontSize * 1.32,
    fontSize,
    source: 'embedded',
  }
}

function tableSegmentWidth(segments, index, pageWidth, baseFont) {
  const current = segmentBounds(segments[index])
  const next = segments[index + 1] ? segmentBounds(segments[index + 1]) : null
  const original = current.maxX - current.minX
  if (next) {
    const gap = Math.max(0, next.minX - current.maxX)
    return Math.max(original, next.minX - current.minX - Math.max(3, gap * 0.22))
  }
  const remaining = Math.max(original, pageWidth - current.minX - Math.max(8, baseFont * 0.8))
  return Math.min(remaining, Math.max(original * 1.75, original + baseFont * 3.5))
}

function mergeParagraphLines(singleLineBlocks, pageIndex, baseFont) {
  const result = []
  let current = null

  for (const block of singleLineBlocks) {
    const isHeading = block.fontSize >= baseFont * 1.22 || (block.text.length < 75 && block.fontSize >= baseFont * 1.1)
    block.type = isHeading ? 'heading' : 'paragraph'

    if (!current || isHeading || current.type === 'heading') {
      if (current) result.push(current)
      current = { ...block }
      continue
    }

    const currentTop = current.y + current.height
    const nextTop = block.y + block.height
    const verticalGap = current.y - nextTop
    const aligned = Math.abs(current.x - block.x) <= Math.max(18, baseFont * 1.5)
    const similarSize = Math.abs(current.fontSize - block.fontSize) <= Math.max(1.8, baseFont * 0.18)
    const closeEnough = verticalGap <= Math.max(current.fontSize, block.fontSize) * 1.15

    if (aligned && similarSize && closeEnough) {
      const minX = Math.min(current.x, block.x)
      const maxX = Math.max(current.x + current.width, block.x + block.width)
      const minY = Math.min(current.y, block.y)
      const maxY = Math.max(currentTop, nextTop)
      current.text = `${current.text} ${block.text}`.replace(/\s+/g, ' ').trim()
      current.x = minX
      current.y = minY
      current.width = maxX - minX
      current.height = maxY - minY
      current.fontSize = (current.fontSize + block.fontSize) / 2
    } else {
      result.push(current)
      current = { ...block }
    }
  }

  if (current) result.push(current)
  return result.map((block, index) => ({ ...block, id: `p${pageIndex + 1}-b${index + 1}` }))
}

export async function extractPdfLayout(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjsLib.getDocument({ data })
  const document = await loadingTask.promise
  const pageCount = document.numPages
  const pages = []
  const blocks = []
  const emptyPages = []
  const ocrPages = []

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = await document.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const items = textContent.items.map(normaliseItem).filter(item => item.text)
    const charCount = items.reduce((sum, item) => sum + item.text.length, 0)

    pages.push({ pageIndex, width: viewport.width, height: viewport.height })
    if (!items.length) {
      emptyPages.push(pageIndex)
      ocrPages.push(pageIndex)
      continue
    }
    if (charCount < 12) ocrPages.push(pageIndex)

    const baseFont = median(items.map(item => item.fontSize))
    const lines = buildLines(items)
    const paragraphCandidates = []
    const tableBlocks = []
    let tempId = 0

    for (const line of lines) {
      const segments = splitLineIntoSegments(line)
      if (segments.length > 1) {
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
          tempId += 1
          const widthHint = tableSegmentWidth(segments, segmentIndex, viewport.width, baseFont)
          tableBlocks.push(segmentToBlock(segments[segmentIndex], pageIndex, `temp-${tempId}`, 'cell', widthHint))
        }
      } else if (segments[0]?.length) {
        tempId += 1
        paragraphCandidates.push(segmentToBlock(segments[0], pageIndex, `temp-${tempId}`))
      }
    }

    const paragraphBlocks = mergeParagraphLines(paragraphCandidates, pageIndex, baseFont)
    const ordered = [...paragraphBlocks, ...tableBlocks]
      .sort((a, b) => Math.abs((b.y + b.height) - (a.y + a.height)) > 4 ? (b.y + b.height) - (a.y + a.height) : a.x - b.x)
      .map((block, index) => ({ ...block, id: `p${pageIndex + 1}-b${index + 1}` }))

    blocks.push(...ordered)
  }

  await document.destroy()

  return {
    pageCount,
    pages,
    blocks,
    emptyPages,
    ocrPages,
    embeddedText: blocks.length > 0,
  }
}

function cleanOcrBlock(item, page, pageIndex, index) {
  const text = String(item?.text || '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const xNorm = clamp(Number(item?.x) || 0, 0, 1000)
  const yNorm = clamp(Number(item?.y) || 0, 0, 1000)
  const widthNorm = clamp(Number(item?.width) || 0, 1, 1000 - xNorm)
  const heightNorm = clamp(Number(item?.height) || 0, 1, 1000 - yNorm)
  const x = page.width * xNorm / 1000
  const width = Math.max(6, page.width * widthNorm / 1000)
  const height = Math.max(6, page.height * heightNorm / 1000)
  const y = clamp(page.height - (page.height * yNorm / 1000) - height, 0, page.height - 1)
  const type = ['heading', 'paragraph', 'cell'].includes(item?.type) ? item.type : 'paragraph'
  const fontSize = clamp(height * (type === 'heading' ? 0.7 : 0.62), 6, type === 'heading' ? 30 : 18)
  return {
    id: `p${pageIndex + 1}-ocr${index + 1}`,
    pageIndex,
    type,
    text,
    x,
    y,
    width: Math.min(width, page.width - x),
    height: Math.min(height, page.height - y),
    fontSize,
    source: 'ocr',
  }
}

async function pageToOcrImage(page, maxDimension = 1700) {
  const base = page.getViewport({ scale: 1 })
  const scale = clamp(maxDimension / Math.max(base.width, base.height), 1.25, 2.2)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Your browser could not read this scanned page.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, background: 'white' }).promise
  const imageData = canvas.toDataURL('image/jpeg', 0.76)
  canvas.width = 1
  canvas.height = 1
  return imageData
}

export async function enrichScannedPages(file, layout, readPage, onProgress) {
  const pagesToRead = [...new Set(layout.ocrPages || layout.emptyPages || [])]
  if (!pagesToRead.length) return layout
  if (typeof readPage !== 'function') return layout

  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjsLib.getDocument({ data })
  const documentPdf = await loadingTask.promise
  let nextBlocks = [...layout.blocks]
  const stillEmpty = []

  try {
    for (let index = 0; index < pagesToRead.length; index += 1) {
      const pageIndex = pagesToRead[index]
      const pageMeta = layout.pages[pageIndex]
      const page = await documentPdf.getPage(pageIndex + 1)
      onProgress?.(index + 1, pagesToRead.length)
      const imageData = await pageToOcrImage(page)
      const result = await readPage({ imageData, pageNumber: pageIndex + 1 })
      const rawBlocks = Array.isArray(result?.blocks) ? result.blocks : []
      const ocrBlocks = rawBlocks
        .map((item, blockIndex) => cleanOcrBlock(item, pageMeta, pageIndex, blockIndex))
        .filter(Boolean)

      const existing = nextBlocks.filter(block => block.pageIndex === pageIndex)
      const existingChars = existing.reduce((sum, block) => sum + block.text.length, 0)
      const ocrChars = ocrBlocks.reduce((sum, block) => sum + block.text.length, 0)
      const shouldReplace = ocrBlocks.length && (existingChars < 12 || ocrChars > existingChars * 1.35)

      if (shouldReplace) {
        nextBlocks = nextBlocks.filter(block => block.pageIndex !== pageIndex)
        nextBlocks.push(...ocrBlocks)
      }

      const finalPageBlocks = nextBlocks.filter(block => block.pageIndex === pageIndex)
      if (!finalPageBlocks.length) stillEmpty.push(pageIndex)
    }
  } finally {
    await documentPdf.destroy()
  }

  nextBlocks.sort((a, b) => a.pageIndex - b.pageIndex || Math.abs((b.y + b.height) - (a.y + a.height)) > 4
    ? a.pageIndex - b.pageIndex || (b.y + b.height) - (a.y + a.height)
    : a.x - b.x)

  return {
    ...layout,
    blocks: nextBlocks,
    emptyPages: stillEmpty,
    ocrPages: [],
    embeddedText: nextBlocks.some(block => block.source === 'embedded'),
    hasOcr: nextBlocks.some(block => block.source === 'ocr'),
  }
}

export function layoutToPlainText(layout, translated = null) {
  const translations = translated instanceof Map ? translated : new Map((translated || []).map(item => [item.id, item.text]))
  return layout.pages.map(page => {
    const pageBlocks = layout.blocks.filter(block => block.pageIndex === page.pageIndex)
    return pageBlocks.map(block => translations.get(block.id) || block.text).join('\n\n')
  }).join('\n\n')
}

function canvasFont(size, bold = false) {
  return `${bold ? 700 : 400} ${size}px Arial, "Noto Sans", "Noto Sans Devanagari", sans-serif`
}

function graphemes(value) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(item => item.segment)
    }
  } catch {}
  return Array.from(value)
}

function splitLongToken(ctx, token, maxWidth) {
  if (ctx.measureText(token).width <= maxWidth) return [token]
  const pieces = []
  let current = ''
  for (const char of graphemes(token)) {
    const candidate = current + char
    if (current && ctx.measureText(candidate).width > maxWidth) {
      pieces.push(current)
      current = char
    } else {
      current = candidate
    }
  }
  if (current) pieces.push(current)
  return pieces
}

function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split(/\n+/)
  const lines = []

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const words = paragraphs[paragraphIndex].trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const rawWord of words) {
      const tokens = splitLongToken(ctx, rawWord, maxWidth)
      for (const word of tokens) {
        const candidate = line ? `${line} ${word}` : word
        if (!line || ctx.measureText(candidate).width <= maxWidth) {
          line = candidate
        } else {
          lines.push(line)
          line = word
        }
      }
    }
    if (line) lines.push(line)
    if (paragraphIndex < paragraphs.length - 1 && lines.length) lines.push('')
  }

  return lines
}

function paddedRect(block, pageWidth, pageHeight, padding) {
  const x = clamp(block.x - padding, 0, pageWidth)
  const y = clamp(block.y - padding, 0, pageHeight)
  const right = clamp(block.x + block.width + padding, 0, pageWidth)
  const top = clamp(block.y + block.height + padding, 0, pageHeight)
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, top - y), right, top }
}

function overlapsVertically(a, b, slack = 0) {
  return a.y < b.y + b.height + slack && a.y + a.height + slack > b.y
}

function overlapsHorizontally(a, b, slack = 0) {
  return a.x < b.x + b.width + slack && a.x + a.width + slack > b.x
}

function planTextRect(block, pageBlocks, pageWidth, pageHeight) {
  const padding = Math.max(1.4, block.fontSize * 0.08)
  const cover = paddedRect(block, pageWidth, pageHeight, padding)
  const margin = Math.max(5, block.fontSize * 0.45)
  const gap = Math.max(3, block.fontSize * 0.3)

  let right = block.type === 'cell'
    ? Math.min(pageWidth - margin, cover.right + Math.max(block.fontSize * 2, cover.width * 0.22))
    : pageWidth - margin

  for (const other of pageBlocks) {
    if (other.id === block.id) continue
    const otherRect = paddedRect(other, pageWidth, pageHeight, 1)
    if (otherRect.x <= cover.x + 1) continue
    if (!overlapsVertically(cover, otherRect, block.fontSize * 0.2)) continue
    right = Math.min(right, otherRect.x - gap)
  }
  right = Math.max(cover.right, right)

  const proposed = { x: cover.x, y: cover.y, width: right - cover.x, height: cover.height }
  let bottom = margin
  for (const other of pageBlocks) {
    if (other.id === block.id) continue
    const otherRect = paddedRect(other, pageWidth, pageHeight, 1)
    const otherTop = otherRect.y + otherRect.height
    if (otherTop > cover.y + 1) continue
    if (!overlapsHorizontally(proposed, otherRect, gap)) continue
    bottom = Math.max(bottom, otherTop + gap)
  }

  let maxHeight = Math.max(cover.height, cover.top - bottom)
  if (block.type === 'cell') maxHeight = Math.min(maxHeight, Math.max(cover.height * 1.55, block.fontSize * 2.2))
  if (block.type === 'heading') maxHeight = Math.min(maxHeight, Math.max(cover.height * 2.6, block.fontSize * 3.2))
  const y = Math.max(margin, cover.top - maxHeight)

  return {
    cover,
    preferred: { ...cover },
    maximum: {
      x: cover.x,
      y,
      width: Math.max(cover.width, right - cover.x),
      height: Math.max(cover.height, cover.top - y),
      top: cover.top,
      right,
    },
  }
}

function tryFit(ctx, text, size, rect, scale, bold, lineFactor) {
  ctx.font = canvasFont(size * scale, bold)
  const usableWidth = Math.max((rect.width - 2) * scale, 12)
  const lines = wrapCanvasText(ctx, text, usableWidth)
  const lineHeight = size * lineFactor
  const required = Math.max(lineHeight, lines.length * lineHeight)
  return { size, lineHeight, lines, required, fits: required <= Math.max(rect.height - 1, lineHeight) }
}

function fitCanvasText(ctx, text, preferredSize, preferredRect, maximumRect, scale, bold, type) {
  const startSize = Math.min(Math.max(preferredSize, 6), type === 'heading' ? 26 : 20)
  const minPreferred = Math.max(type === 'cell' ? 5 : 5.4, startSize * 0.76)
  const lineFactor = type === 'cell' ? 1.08 : type === 'heading' ? 1.12 : 1.16

  for (let size = startSize; size >= minPreferred; size -= 0.35) {
    const result = tryFit(ctx, text, size, preferredRect, scale, bold, lineFactor)
    if (result.fits) return { ...result, rect: preferredRect, clipped: false }
  }

  const hardMin = type === 'cell' ? 3.8 : 4.3
  for (let size = startSize; size >= hardMin; size -= 0.3) {
    const result = tryFit(ctx, text, size, maximumRect, scale, bold, lineFactor)
    if (result.fits) return { ...result, rect: maximumRect, clipped: false }
  }

  const final = tryFit(ctx, text, hardMin, maximumRect, scale, bold, 1.04)
  return { ...final, rect: maximumRect, clipped: !final.fits }
}

function sampleBackgroundColor(ctx, x, y, width, height) {
  const maxX = ctx.canvas.width - 1
  const maxY = ctx.canvas.height - 1
  const points = []
  const push = (px, py) => {
    const sx = clamp(Math.round(px), 0, maxX)
    const sy = clamp(Math.round(py), 0, maxY)
    try {
      const data = ctx.getImageData(sx, sy, 1, 1).data
      points.push([data[0], data[1], data[2]])
    } catch {}
  }

  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    push(x + width * fraction, y - 2)
    push(x + width * fraction, y + height + 2)
    push(x - 2, y + height * fraction)
    push(x + width + 2, y + height * fraction)
  }
  if (!points.length) return 'rgb(255,255,255)'
  const r = Math.round(median(points.map(point => point[0])))
  const g = Math.round(median(points.map(point => point[1])))
  const b = Math.round(median(points.map(point => point[2])))
  return `rgb(${r},${g},${b})`
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(new Error('Could not render the translated page.'))
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

export async function buildTranslatedPdf(file, layout, translatedBlocks) {
  const translations = new Map(translatedBlocks.map(item => [item.id, String(item.text || '')]))
  const fileBuffer = await file.arrayBuffer()
  const pdf = await PDFDocument.load(fileBuffer.slice(0), { updateMetadata: false })
  const pages = pdf.getPages()
  const sourceTask = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) })
  const sourcePdf = await sourceTask.promise
  const scale = 2

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready } catch {}
  }

  try {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex]
      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const pageBlocks = layout.blocks.filter(block => block.pageIndex === pageIndex && translations.has(block.id))
      if (!pageBlocks.length) continue

      const overlay = document.createElement('canvas')
      overlay.width = Math.ceil(pageWidth * scale)
      overlay.height = Math.ceil(pageHeight * scale)
      const ctx = overlay.getContext('2d')
      if (!ctx) throw new Error('Your browser could not create the translated PDF canvas.')
      ctx.textBaseline = 'top'

      const sourcePage = await sourcePdf.getPage(pageIndex + 1)
      const sourceViewport = sourcePage.getViewport({ scale })
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = Math.ceil(sourceViewport.width)
      sourceCanvas.height = Math.ceil(sourceViewport.height)
      const sourceCtx = sourceCanvas.getContext('2d', { alpha: false })
      if (!sourceCtx) throw new Error('Your browser could not inspect the document background.')
      sourceCtx.fillStyle = '#fff'
      sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height)
      await sourcePage.render({ canvasContext: sourceCtx, viewport: sourceViewport, background: 'white' }).promise

      for (const block of pageBlocks) {
        const translated = translations.get(block.id)
        if (!translated) continue
        const plan = planTextRect(block, pageBlocks, pageWidth, pageHeight)
        const cover = plan.cover
        const coverX = cover.x * scale
        const coverY = (pageHeight - (cover.y + cover.height)) * scale
        const coverW = cover.width * scale
        const coverH = cover.height * scale

        ctx.fillStyle = sampleBackgroundColor(sourceCtx, coverX, coverY, coverW, coverH)
        ctx.fillRect(coverX, coverY, coverW, coverH)

        const bold = block.type === 'heading'
        const fitted = fitCanvasText(
          ctx,
          translated,
          block.fontSize * (bold ? 1 : 0.96),
          plan.preferred,
          plan.maximum,
          scale,
          bold,
          block.type,
        )

        const textRect = fitted.rect
        const textX = textRect.x * scale + scale
        const textY = (pageHeight - (textRect.y + textRect.height)) * scale + scale
        const textW = Math.max(1, textRect.width * scale - scale * 2)
        const textH = Math.max(1, textRect.height * scale - scale * 2)

        ctx.save()
        ctx.beginPath()
        ctx.rect(textX, textY, textW, textH)
        ctx.clip()
        ctx.font = canvasFont(fitted.size * scale, bold)
        ctx.fillStyle = '#141414'
        let cursorY = textY
        const maxY = textY + textH
        const lines = [...fitted.lines]

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          if (cursorY + fitted.size * scale > maxY + 1) break
          let line = lines[lineIndex]
          const isLastVisible = cursorY + (fitted.lineHeight + fitted.size) * scale > maxY && lineIndex < lines.length - 1
          if (isLastVisible && fitted.clipped) line = `${line.replace(/[.…]+$/u, '')}…`
          ctx.fillText(line, textX, cursorY)
          cursorY += fitted.lineHeight * scale
        }
        ctx.restore()
      }

      const png = await pdf.embedPng(await canvasToPngBytes(overlay))
      page.drawImage(png, { x: 0, y: 0, width: pageWidth, height: pageHeight })
      overlay.width = 1
      overlay.height = 1
      sourceCanvas.width = 1
      sourceCanvas.height = 1
    }
  } finally {
    await sourcePdf.destroy()
  }

  return pdf.save({
    updateFieldAppearances: false,
    useObjectStreams: false,
  })
}

export function downloadBytes(bytes, filename, type = 'application/pdf') {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
