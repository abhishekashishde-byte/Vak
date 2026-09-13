const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function font(size, bold = false) {
  return `${bold ? 700 : 400} ${size}px Arial, "Noto Sans", "Noto Sans Devanagari", sans-serif`
}

function graphemes(value) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(value || ''))].map(item => item.segment)
    }
  } catch {}
  return Array.from(String(value || ''))
}

function splitToken(ctx, token, maxWidth) {
  if (ctx.measureText(token).width <= maxWidth) return [token]
  const result = []
  let current = ''
  for (const char of graphemes(token)) {
    const next = current + char
    if (current && ctx.measureText(next).width > maxWidth) {
      result.push(current)
      current = char
    } else current = next
  }
  if (current) result.push(current)
  return result
}

function wrap(ctx, text, maxWidth) {
  const lines = []
  for (const paragraph of String(text || '').split(/\n+/)) {
    let line = ''
    for (const raw of paragraph.trim().split(/\s+/).filter(Boolean)) {
      for (const word of splitToken(ctx, raw, maxWidth)) {
        const candidate = line ? `${line} ${word}` : word
        if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate
        else {
          lines.push(line)
          line = word
        }
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function overlapsX(a, b, slack = 0) {
  return a.x < b.x + b.width + slack && a.x + a.width + slack > b.x
}

function overlapsY(a, b, slack = 0) {
  return a.y < b.y + b.height + slack && a.y + a.height + slack > b.y
}

function maximumRect(block, pageBlocks, page) {
  const pad = Math.max(1.4, block.fontSize * 0.08)
  const margin = Math.max(5, block.fontSize * 0.45)
  const gap = Math.max(3, block.fontSize * 0.3)
  const x = clamp(block.x - pad, 0, page.width)
  const y = clamp(block.y - pad, 0, page.height)
  const right0 = clamp(block.x + block.width + pad, 0, page.width)
  const top = clamp(block.y + block.height + pad, 0, page.height)
  const cover = { x, y, width: Math.max(1, right0 - x), height: Math.max(1, top - y) }

  let right = block.type === 'cell'
    ? Math.min(page.width - margin, right0 + Math.max(block.fontSize * 2, cover.width * 0.22))
    : page.width - margin

  for (const other of pageBlocks) {
    if (other.id === block.id) continue
    const rect = { x: other.x, y: other.y, width: other.width, height: other.height }
    if (rect.x <= x + 1 || !overlapsY(cover, rect, block.fontSize * 0.2)) continue
    right = Math.min(right, rect.x - gap)
  }
  right = Math.max(right0, right)

  const proposed = { x, y, width: right - x, height: cover.height }
  let bottom = margin
  for (const other of pageBlocks) {
    if (other.id === block.id) continue
    const rect = { x: other.x, y: other.y, width: other.width, height: other.height }
    const otherTop = rect.y + rect.height
    if (otherTop > y + 1 || !overlapsX(proposed, rect, gap)) continue
    bottom = Math.max(bottom, otherTop + gap)
  }

  let height = Math.max(cover.height, top - bottom)
  if (block.type === 'cell') height = Math.min(height, Math.max(cover.height * 1.55, block.fontSize * 2.2))
  if (block.type === 'heading') height = Math.min(height, Math.max(cover.height * 2.6, block.fontSize * 3.2))
  return { x, y: Math.max(margin, top - height), width: Math.max(cover.width, right - x), height }
}

function fitBlock(ctx, block, text, rect) {
  const bold = block.type === 'heading'
  const start = Math.min(Math.max(block.fontSize * (bold ? 1 : 0.96), 6), bold ? 26 : 20)
  const hardMin = block.type === 'cell' ? 3.8 : 4.3
  const lineFactor = block.type === 'cell' ? 1.08 : bold ? 1.12 : 1.16

  for (let size = start; size >= hardMin; size -= 0.3) {
    ctx.font = font(size, bold)
    const lines = wrap(ctx, text, Math.max(rect.width - 2, 8))
    const needed = Math.max(size * lineFactor, lines.length * size * lineFactor)
    if (needed <= Math.max(rect.height - 1, size * lineFactor)) {
      return { fits: true, size, ratio: size / start, lines: lines.length }
    }
  }
  ctx.font = font(hardMin, bold)
  return { fits: false, size: hardMin, ratio: hardMin / start, lines: wrap(ctx, text, Math.max(rect.width - 2, 8)).length }
}

export function assessDocumentLayout(layout, translatedBlocks) {
  if (typeof document === 'undefined') return { review: false, issues: [], rescueIds: [], pages: [] }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return { review: false, issues: [], rescueIds: [], pages: [] }
  const translations = new Map((translatedBlocks || []).map(item => [item.id, String(item.text || '')]))
  const issues = []

  for (const page of layout.pages || []) {
    const pageBlocks = (layout.blocks || []).filter(block => block.pageIndex === page.pageIndex)
    for (const block of pageBlocks) {
      const text = translations.get(block.id)
      if (!text) continue
      const rect = maximumRect(block, pageBlocks, page)
      const fit = fitBlock(ctx, block, text, rect)
      const severeShrink = fit.ratio < (block.type === 'cell' ? 0.58 : 0.52)
      if (!fit.fits || severeShrink) {
        issues.push({ id: block.id, page: page.pageIndex + 1, type: block.type, reason: !fit.fits ? 'overflow' : 'very-small-text', ratio: Number(fit.ratio.toFixed(2)) })
      }
    }
  }

  canvas.width = 1
  canvas.height = 1
  const pages = [...new Set(issues.map(issue => issue.page))]
  const rescueIds = issues.filter(issue => issue.type === 'cell' || issue.type === 'heading' || issue.reason === 'overflow').map(issue => issue.id)
  return { review: issues.length > 0, issues, rescueIds: [...new Set(rescueIds)].slice(0, 18), pages }
}

export function combineDocumentQuality(layoutReport, scanSignals = []) {
  const scanPages = scanSignals
    .filter(item => Number(item.lowConfidenceCount || 0) > 0 || Number(item.handwrittenCount || 0) > 0)
    .map(item => Number(item.pageNumber))
    .filter(Number.isFinite)
  const pages = [...new Set([...(layoutReport?.pages || []), ...scanPages])].sort((a, b) => a - b)
  const lowConfidence = scanSignals.reduce((sum, item) => sum + Number(item.lowConfidenceCount || 0), 0)
  const handwritten = scanSignals.reduce((sum, item) => sum + Number(item.handwrittenCount || 0), 0)
  return { review: Boolean(layoutReport?.review || lowConfidence || handwritten), pages, lowConfidence, handwritten, layoutIssues: layoutReport?.issues?.length || 0 }
}
