export const NOTE_CANVAS_ASPECT = 1.414

export function pointFromPointer(event, rect) {
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    p: Number.isFinite(event.pressure) && event.pressure > 0 ? Math.max(.15, Math.min(1, event.pressure)) : .5,
    t: Date.now(),
  }
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  if (!dx && !dy) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function strokeHit(stroke, point, radius = .018) {
  const pts = Array.isArray(stroke?.points) ? stroke.points : []
  if (!pts.length) return false
  if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= radius
  for (let i = 1; i < pts.length; i += 1) {
    if (distToSegment(point.x, point.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= radius) return true
  }
  return false
}

function smoothPoints(points) {
  if (!Array.isArray(points) || points.length < 4) return points || []
  return points.map((point, index) => {
    if (index < 2 || index > points.length - 3) return point
    const group = points.slice(index - 2, index + 3)
    const weight = [1, 2, 3, 2, 1]
    const total = 9
    return {
      ...point,
      x: group.reduce((sum, item, i) => sum + item.x * weight[i], 0) / total,
      y: group.reduce((sum, item, i) => sum + item.y * weight[i], 0) / total,
      p: group.reduce((sum, item, i) => sum + (item.p || .5) * weight[i], 0) / total,
    }
  })
}

function lineDeviation(points) {
  if (!Array.isArray(points) || points.length < 3) return Infinity
  const first = points[0], last = points[points.length - 1]
  const length = Math.hypot(last.x - first.x, last.y - first.y)
  if (length < .035) return Infinity
  let max = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    max = Math.max(max, distToSegment(points[i].x, points[i].y, first.x, first.y, last.x, last.y))
  }
  return max
}

export function tidyStrokes(strokes) {
  return (Array.isArray(strokes) ? strokes : []).map(stroke => {
    const points = smoothPoints(stroke.points || [])
    if (points.length >= 3 && lineDeviation(points) < .0065) {
      const first = points[0], last = points[points.length - 1]
      return { ...stroke, points: [first, { ...last, p: (first.p + last.p) / 2 }] }
    }
    return { ...stroke, points }
  })
}

export function drawInk(canvas, strokes, activeStroke = null) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.scale(ratio, ratio)
  const cssW = rect.width, cssH = rect.height

  const render = stroke => {
    const points = Array.isArray(stroke?.points) ? stroke.points : []
    if (!points.length) return
    const base = Math.max(.8, Number(stroke.width) || 2.2)
    ctx.strokeStyle = stroke.color || '#171717'
    ctx.fillStyle = stroke.color || '#171717'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (points.length === 1) {
      ctx.beginPath()
      ctx.arc(points[0].x * cssW, points[0].y * cssH, base * (.45 + (points[0].p || .5) * .45), 0, Math.PI * 2)
      ctx.fill()
      return
    }

    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i]
      const pressure = Math.max(.2, Math.min(1, ((a.p || .5) + (b.p || .5)) / 2))
      ctx.lineWidth = base * (.72 + pressure * .58)
      ctx.beginPath()
      ctx.moveTo(a.x * cssW, a.y * cssH)
      if (i < points.length - 1) {
        const next = points[i + 1]
        ctx.quadraticCurveTo(b.x * cssW, b.y * cssH, ((b.x + next.x) / 2) * cssW, ((b.y + next.y) / 2) * cssH)
      } else {
        ctx.lineTo(b.x * cssW, b.y * cssH)
      }
      ctx.stroke()
    }
  }

  ;(Array.isArray(strokes) ? strokes : []).forEach(render)
  if (activeStroke) render(activeStroke)
  ctx.restore()
}

export function cloneInk(strokes) {
  return JSON.parse(JSON.stringify(Array.isArray(strokes) ? strokes : []))
}
