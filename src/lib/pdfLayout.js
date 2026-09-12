import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

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

function segmentToBlock(segment, pageIndex, id, type = 'paragraph') {
  const minX = Math.min(...segment.map(item => item.x))
  const maxX = Math.max(...segment.map(item => item.x + item.width))
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
    width: Math.max(maxX - minX, fontSize * 2),
    height: fontSize * 1.32,
    fontSize,
  }
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

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = await document.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const items = textContent.items.map(normaliseItem).filter(item => item.text)

    pages.push({ pageIndex, width: viewport.width, height: viewport.height })
    if (!items.length) {
      emptyPages.push(pageIndex)
      continue
    }

    const baseFont = median(items.map(item => item.fontSize))
    const lines = buildLines(items)
    const paragraphCandidates = []
    const tableBlocks = []
    let tempId = 0

    for (const line of lines) {
      const segments = splitLineIntoSegments(line)
      if (segments.length > 1) {
        for (const segment of segments) {
          tempId += 1
          tableBlocks.push(segmentToBlock(segment, pageIndex, `temp-${tempId}`, 'cell'))
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

  if (!blocks.length) {
    const error = new Error('This PDF is image-only and needs OCR before Ana can rebuild it.')
    error.code = 'SCANNED_PDF'
    throw error
  }

  return { pageCount, pages, blocks, emptyPages, embeddedText: true }
}

export function layoutToPlainText(layout, translated = null) {
  const translations = translated instanceof Map ? translated : new Map((translated || []).map(item => [item.id, item.text]))
  return layout.pages.map(page => {
    const pageBlocks = layout.blocks.filter(block => block.pageIndex === page.pageIndex)
    return pageBlocks.map(block => translations.get(block.id) || block.text).join('\n\n')
  }).join('\n\n')
}

function canvasFont(size, bold = false) {
  return `${bold ? 700 : 400} ${size}px Arial, "Noto Sans", sans-serif`
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return []
  const lines = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

function fitCanvasText(ctx, text, preferredSize, width, height, scale, bold) {
  let size = Math.min(Math.max(preferredSize, 6), 20)
  while (size >= 5.2) {
    ctx.font = canvasFont(size * scale, bold)
    const lineHeight = size * 1.18
    const lines = wrapCanvasText(ctx, text, Math.max(width * scale, 20))
    if (lines.length * lineHeight <= Math.max(height, lineHeight)) {
      return { size, lineHeight, lines }
    }
    size -= 0.35
  }
  const sizeFinal = 5.2
  ctx.font = canvasFont(sizeFinal * scale, bold)
  return {
    size: sizeFinal,
    lineHeight: sizeFinal * 1.16,
    lines: wrapCanvasText(ctx, text, Math.max(width * scale, 20)),
  }
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
  const pdf = await PDFDocument.load(await file.arrayBuffer())
  const pages = pdf.getPages()
  const scale = 2

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready } catch {}
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]
    const pageWidth = page.getWidth()
    const pageHeight = page.getHeight()
    const pageBlocks = layout.blocks.filter(block => block.pageIndex === pageIndex && translations.has(block.id))
    if (!pageBlocks.length) continue

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(pageWidth * scale)
    canvas.height = Math.ceil(pageHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not create the translated PDF canvas.')
    ctx.textBaseline = 'top'

    for (const block of pageBlocks) {
      const translated = translations.get(block.id)
      if (!translated) continue

      const padding = Math.max(1.5, block.fontSize * 0.08)
      const x = Math.max(0, block.x - padding)
      const y = Math.max(0, block.y - padding)
      const width = Math.min(pageWidth - x, block.width + padding * 2)
      const height = Math.min(pageHeight - y, block.height + padding * 2)
      const canvasX = x * scale
      const canvasY = (pageHeight - (y + height)) * scale
      const canvasW = width * scale
      const canvasH = height * scale

      ctx.fillStyle = 'rgba(255,255,255,0.985)'
      ctx.fillRect(canvasX, canvasY, canvasW, canvasH)

      const bold = block.type === 'heading'
      const fitted = fitCanvasText(ctx, translated, block.fontSize * (bold ? 1 : 0.96), width - 2, height - 2, scale, bold)
      ctx.font = canvasFont(fitted.size * scale, bold)
      ctx.fillStyle = '#141414'
      let cursorY = canvasY + scale

      for (const line of fitted.lines) {
        if (cursorY + fitted.size * scale > canvasY + canvasH + 1) break
        ctx.fillText(line, canvasX + scale, cursorY)
        cursorY += fitted.lineHeight * scale
      }
    }

    const png = await pdf.embedPng(await canvasToPngBytes(canvas))
    page.drawImage(png, { x: 0, y: 0, width: pageWidth, height: pageHeight })
    canvas.width = 1
    canvas.height = 1
  }

  return pdf.save()
}

export function downloadBytes(bytes, filename, type = 'application/pdf') {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
