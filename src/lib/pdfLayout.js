import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

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
  const pages = []
  const blocks = []
  const emptyPages = []

  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
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
    const error = new Error('This PDF has no embedded text. It appears to be scanned and needs the OCR layout fallback.')
    error.code = 'SCANNED_PDF'
    throw error
  }

  return {
    pageCount: document.numPages,
    pages,
    blocks,
    emptyPages,
    embeddedText: true,
  }
}

export function layoutToPlainText(layout, translated = null) {
  const translations = translated instanceof Map ? translated : new Map((translated || []).map(item => [item.id, item.text]))
  return layout.pages.map(page => {
    const pageBlocks = layout.blocks.filter(block => block.pageIndex === page.pageIndex)
    const lines = pageBlocks.map(block => translations.get(block.id) || block.text)
    return `Page ${page.pageIndex + 1}\n\n${lines.join('\n\n')}`
  }).join('\n\n──────────\n\n')
}

function cleanForStandardFont(text) {
  return String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/\u00a0/g, ' ')
}

function wrapText(text, font, size, maxWidth) {
  const words = cleanForStandardFont(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function fitText(text, font, preferredSize, width, height) {
  let size = Math.min(Math.max(preferredSize, 6), 18)
  while (size >= 5.5) {
    const lineHeight = size * 1.14
    const lines = wrapText(text, font, size, Math.max(width, 20))
    if (lines.length * lineHeight <= Math.max(height, lineHeight)) return { size, lineHeight, lines }
    size -= 0.4
  }
  const lineHeight = 5.5 * 1.12
  return { size: 5.5, lineHeight, lines: wrapText(text, font, 5.5, Math.max(width, 20)) }
}

export async function buildTranslatedPdf(file, layout, translatedBlocks, targetLanguage) {
  if (targetLanguage === 'Hindi') {
    throw new Error('PDF export for Hindi needs the Unicode font layer. Translation works now; Hindi PDF export is the next font-support step.')
  }

  const translations = new Map(translatedBlocks.map(item => [item.id, String(item.text || '')]))
  const pdf = await PDFDocument.load(await file.arrayBuffer())
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pages = pdf.getPages()

  for (const block of layout.blocks) {
    const translated = translations.get(block.id)
    if (!translated) continue
    const page = pages[block.pageIndex]
    if (!page) continue

    const padding = 1.5
    const x = Math.max(0, block.x - padding)
    const y = Math.max(0, block.y - padding)
    const width = Math.min(page.getWidth() - x, block.width + padding * 2)
    const height = Math.min(page.getHeight() - y, block.height + padding * 2)
    const font = block.type === 'heading' ? bold : regular

    page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), opacity: 0.97 })

    const fitted = fitText(translated, font, block.fontSize * (block.type === 'heading' ? 1 : 0.95), width - 2, height - 2)
    let cursorY = y + height - fitted.size
    for (const line of fitted.lines) {
      if (cursorY < y - 1) break
      page.drawText(cleanForStandardFont(line), {
        x: x + 1,
        y: cursorY,
        size: fitted.size,
        font,
        color: rgb(0.08, 0.08, 0.08),
      })
      cursorY -= fitted.lineHeight
    }
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
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
