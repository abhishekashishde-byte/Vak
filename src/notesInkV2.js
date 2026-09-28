import { getStroke } from 'perfect-freehand'
import RBush from 'rbush'

const TAU = Math.PI * 2
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

export const PEN_PRESETS = {
  ballpoint: { label:'Ballpoint', size:2.1, thinning:.18, smoothing:.65, streamline:.38, alpha:1, taperStart:0, taperEnd:0 },
  fountain: { label:'Fountain', size:2.7, thinning:.62, smoothing:.58, streamline:.34, alpha:1, taperStart:0, taperEnd:0 },
  brush: { label:'Brush', size:4.1, thinning:.88, smoothing:.7, streamline:.28, alpha:1, taperStart:10, taperEnd:14 },
  pencil: { label:'Pencil', size:2.2, thinning:.48, smoothing:.52, streamline:.4, alpha:.62, taperStart:0, taperEnd:0 },
  highlighter: { label:'Highlighter', size:13, thinning:.08, smoothing:.7, streamline:.35, alpha:.24, taperStart:0, taperEnd:0 },
}

export function pointerPoint(event, rect) {
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const pressure = Number.isFinite(event.pressure) && event.pressure > 0 ? clamp(event.pressure, .03, 1) : .5
  const tiltX = Number.isFinite(event.tiltX) ? event.tiltX : 0
  const tiltY = Number.isFinite(event.tiltY) ? event.tiltY : 0
  const altitudeAngle = Number.isFinite(event.altitudeAngle) ? event.altitudeAngle : null
  const azimuthAngle = Number.isFinite(event.azimuthAngle) ? event.azimuthAngle : null
  return {
    x: clamp((event.clientX - rect.left) / width, 0, 1),
    y: clamp((event.clientY - rect.top) / height, 0, 1),
    pressure,
    tiltX,
    tiltY,
    altitudeAngle,
    azimuthAngle,
    time: Number(event.timeStamp) || performance.now(),
  }
}

export function eventPoints(event, rect) {
  const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
  return samples.length ? samples.map(sample => pointerPoint(sample, rect)) : [pointerPoint(event, rect)]
}

export function predictedPoints(event, rect) {
  if (typeof event.getPredictedEvents !== 'function') return []
  try { return event.getPredictedEvents().map(sample => pointerPoint(sample, rect)) } catch { return [] }
}

function tiltPressure(point, kind) {
  const p = clamp(point.pressure || .5, .03, 1)
  if (kind !== 'fountain') return p
  if (Number.isFinite(point.altitudeAngle)) {
    const normalized = clamp(point.altitudeAngle / (Math.PI / 2), .08, 1)
    return clamp(p * .72 + (1 - normalized) * .55, .03, 1)
  }
  const tilt = clamp(Math.hypot(point.tiltX || 0, point.tiltY || 0) / 90, 0, 1)
  return clamp(p * .74 + tilt * .5, .03, 1)
}

function pointsForFreehand(stroke, width, height) {
  const kind = stroke.kind || 'ballpoint'
  return (stroke.points || []).map(p => [p.x * width, p.y * height, tiltPressure(p, kind)])
}

export function strokeOptions(stroke) {
  const preset = PEN_PRESETS[stroke.kind] || PEN_PRESETS.ballpoint
  const size = Math.max(.6, Number(stroke.width) || preset.size)
  return {
    size,
    thinning:preset.thinning,
    smoothing:preset.smoothing,
    streamline:preset.streamline,
    simulatePressure:false,
    start:{ taper:preset.taperStart || 0, cap:true },
    end:{ taper:preset.taperEnd || 0, cap:true },
    easing:t=>t,
  }
}

function polygonPath(ctx, polygon) {
  if (!polygon?.length) return
  ctx.beginPath()
  ctx.moveTo(polygon[0][0], polygon[0][1])
  for (let i=1;i<polygon.length;i+=1) ctx.lineTo(polygon[i][0], polygon[i][1])
  ctx.closePath()
}

function drawPencilTexture(ctx, polygon, stroke) {
  polygonPath(ctx, polygon)
  ctx.fillStyle = stroke.color || '#171717'
  ctx.globalAlpha = .52
  ctx.fill()
  ctx.save()
  polygonPath(ctx, polygon)
  ctx.clip()
  ctx.globalAlpha = .12
  ctx.fillStyle = '#000'
  const box = polygon.reduce((acc,[x,y])=>({
    minX:Math.min(acc.minX,x), minY:Math.min(acc.minY,y),
    maxX:Math.max(acc.maxX,x), maxY:Math.max(acc.maxY,y),
  }),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity})
  const seed = String(stroke.id || '').split('').reduce((a,ch)=>((a*33)^ch.charCodeAt(0))>>>0,5381)
  let v = seed || 1
  const rand = () => ((v = (v * 1664525 + 1013904223) >>> 0) / 4294967296)
  const count = Math.min(220, Math.max(20, Math.floor((box.maxX-box.minX)*(box.maxY-box.minY)/24)))
  for(let i=0;i<count;i+=1){
    const x=box.minX+rand()*(box.maxX-box.minX), y=box.minY+rand()*(box.maxY-box.minY)
    ctx.fillRect(x,y,.55+rand()*.75,.55+rand()*.75)
  }
  ctx.restore()
}

function drawStroke(ctx, stroke, width, height) {
  const points = stroke.points || []
  if (!points.length) return
  const preset = PEN_PRESETS[stroke.kind] || PEN_PRESETS.ballpoint
  const polygon = getStroke(pointsForFreehand(stroke,width,height), strokeOptions(stroke))
  if (!polygon.length) return

  if (stroke.kind === 'pencil') {
    drawPencilTexture(ctx, polygon, stroke)
    ctx.globalAlpha = 1
    return
  }

  polygonPath(ctx, polygon)
  ctx.fillStyle = stroke.color || '#171717'
  ctx.globalAlpha = Number.isFinite(stroke.opacity) ? stroke.opacity : preset.alpha
  ctx.fill()
  ctx.globalAlpha = 1
}

export function setupCanvas(canvas, cssWidth, cssHeight, scale=1, desynchronized=false) {
  if (!canvas) return null
  const ratio = Math.max(1, window.devicePixelRatio || 1) * Math.max(.5, scale)
  const width = Math.max(1, Math.round(cssWidth * ratio))
  const height = Math.max(1, Math.round(cssHeight * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d', desynchronized ? { alpha:true, desynchronized:true } : undefined)
  ctx.setTransform(ratio,0,0,ratio,0,0)
  ctx.clearRect(0,0,cssWidth,cssHeight)
  return ctx
}

export function renderStatic(canvas, strokes, scale=1) {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const ctx = setupCanvas(canvas, rect.width, rect.height, scale, false)
  const highlights = (strokes || []).filter(s=>s.kind==='highlighter')
  const ink = (strokes || []).filter(s=>s.kind!=='highlighter')
  for (const stroke of highlights) drawStroke(ctx,stroke,rect.width,rect.height)
  for (const stroke of ink) drawStroke(ctx,stroke,rect.width,rect.height)
}

export function renderLive(canvas, stroke, predicted=[], scale=1) {
  if (!canvas) return
  const rect=canvas.getBoundingClientRect()
  const ctx=setupCanvas(canvas,rect.width,rect.height,scale,true)
  if (!stroke) return
  drawStroke(ctx,stroke,rect.width,rect.height)
  if (predicted?.length) {
    const preview={...stroke,id:`${stroke.id}-predicted`,opacity:.22,points:[...(stroke.points||[]),...predicted]}
    drawStroke(ctx,preview,rect.width,rect.height)
  }
}

export function strokeBounds(stroke) {
  const pts=stroke?.points||[]
  if(!pts.length) return {minX:0,minY:0,maxX:0,maxY:0}
  let minX=1,minY=1,maxX=0,maxY=0
  for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}
  const pad=Math.min(.08,Math.max(.004,(Number(stroke.width)||2)/600))
  return {minX:minX-pad,minY:minY-pad,maxX:maxX+pad,maxY:maxY+pad}
}

export function makeStrokeIndex(strokes) {
  const tree=new RBush()
  tree.load((strokes||[]).map((stroke,index)=>({...strokeBounds(stroke),stroke,index})))
  return tree
}

function distToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay
  if(!dx&&!dy)return Math.hypot(px-ax,py-ay)
  const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy),0,1)
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy))
}

export function hitStroke(stroke, point, radius=.012) {
  const pts=stroke?.points||[]
  if(!pts.length)return false
  if(pts.length===1)return Math.hypot(point.x-pts[0].x,point.y-pts[0].y)<=radius
  for(let i=1;i<pts.length;i+=1){
    if(distToSegment(point.x,point.y,pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y)<=radius)return true
  }
  return false
}

export function eraseWholeStroke(strokes, point, radius=.015, highlighterOnly=false, index=null) {
  const tree=index||makeStrokeIndex(strokes)
  const candidates=tree.search({minX:point.x-radius,minY:point.y-radius,maxX:point.x+radius,maxY:point.y+radius})
    .filter(item=>!highlighterOnly||item.stroke.kind==='highlighter')
    .sort((a,b)=>b.index-a.index)
  const hit=candidates.find(item=>hitStroke(item.stroke,point,radius))
  if(!hit)return strokes
  return strokes.filter((_,i)=>i!==hit.index)
}

export function erasePrecise(strokes, point, radius=.012, highlighterOnly=false, index=null) {
  const tree=index||makeStrokeIndex(strokes)
  const candidateIds=new Set(tree.search({minX:point.x-radius,minY:point.y-radius,maxX:point.x+radius,maxY:point.y+radius})
    .filter(item=>!highlighterOnly||item.stroke.kind==='highlighter').map(item=>item.stroke.id))
  const next=[]
  for(const stroke of strokes||[]){
    if(!candidateIds.has(stroke.id)){next.push(stroke);continue}
    const pts=stroke.points||[]
    let segment=[]
    for(const p of pts){
      const inside=Math.hypot(p.x-point.x,p.y-point.y)<=radius
      if(inside){
        if(segment.length>1)next.push({...stroke,id:`${stroke.id}-${next.length}`,points:segment})
        segment=[]
      }else segment.push(p)
    }
    if(segment.length>1)next.push({...stroke,id:segment===pts?stroke.id:`${stroke.id}-${next.length}`,points:segment})
  }
  return next
}

function pointInPolygon(point, polygon) {
  let inside=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const xi=polygon[i].x, yi=polygon[i].y, xj=polygon[j].x, yj=polygon[j].y
    const hit=((yi>point.y)!==(yj>point.y))&&(point.x<(xj-xi)*(point.y-yi)/(yj-yi+1e-12)+xi)
    if(hit)inside=!inside
  }
  return inside
}

export function strokesInLasso(strokes, polygon) {
  if(!polygon?.length)return []
  return (strokes||[]).filter(stroke=>{
    const pts=stroke.points||[]
    if(!pts.length)return false
    let inside=0
    for(const p of pts)if(pointInPolygon(p,polygon))inside+=1
    return inside/pts.length>=.55
  }).map(stroke=>stroke.id)
}

export function strokesInRect(strokes, rect) {
  return (strokes||[]).filter(stroke=>{
    const b=strokeBounds(stroke)
    return b.minX>=rect.minX&&b.maxX<=rect.maxX&&b.minY>=rect.minY&&b.maxY<=rect.maxY
  }).map(stroke=>stroke.id)
}

export function transformStrokes(strokes, ids, transform) {
  const selected=new Set(ids||[])
  const {dx=0,dy=0,scaleX=1,scaleY=1,rotation=0,cx=.5,cy=.5,color,widthScale=1}=transform||{}
  const cos=Math.cos(rotation),sin=Math.sin(rotation)
  return (strokes||[]).map(stroke=>{
    if(!selected.has(stroke.id))return stroke
    const points=(stroke.points||[]).map(p=>{
      let x=(p.x-cx)*scaleX,y=(p.y-cy)*scaleY
      const rx=x*cos-y*sin,ry=x*sin+y*cos
      return {...p,x:clamp(cx+rx+dx,-2,3),y:clamp(cy+ry+dy,-2,3)}
    })
    return {...stroke,points,color:color||stroke.color,width:(Number(stroke.width)||2)*widthScale}
  })
}

function closedEnough(points, threshold=.08){
  if(points.length<8)return false
  const a=points[0],b=points[points.length-1]
  return Math.hypot(a.x-b.x,a.y-b.y)<threshold
}
function boundsOfPoints(points){
  let minX=1,minY=1,maxX=0,maxY=0
  for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}
  return {minX,minY,maxX,maxY,w:maxX-minX,h:maxY-minY}
}
function simplify(points, tolerance=.012){
  if(points.length<3)return points
  const out=[points[0]]
  let last=points[0]
  for(let i=1;i<points.length-1;i+=1){
    const p=points[i]
    if(Math.hypot(p.x-last.x,p.y-last.y)>=tolerance){out.push(p);last=p}
  }
  out.push(points[points.length-1])
  return out
}

export function recognizeHeldShape(stroke, holdMs=0){
  const points=stroke?.points||[]
  if(points.length<3||holdMs<350)return null
  const b=boundsOfPoints(points), diag=Math.hypot(b.w,b.h)
  if(diag<.035)return null
  const first=points[0],last=points[points.length-1]
  let maxLineDev=0
  for(const p of points)maxLineDev=Math.max(maxLineDev,distToSegment(p.x,p.y,first.x,first.y,last.x,last.y))
  if(maxLineDev<Math.max(.007,diag*.035))return {type:'line',points:[first,last]}

  if(closedEnough(points,Math.min(.12,diag*.18))){
    const cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2
    const ratio=Math.min(b.w,b.h)/Math.max(b.w,b.h)
    const radii=points.map(p=>Math.hypot(p.x-cx,p.y-cy))
    const avg=radii.reduce((a,v)=>a+v,0)/radii.length
    const variance=Math.sqrt(radii.reduce((a,v)=>a+(v-avg)*(v-avg),0)/radii.length)/(avg||1)
    if(ratio>.65&&variance<.2){
      const clean=[]
      for(let i=0;i<=40;i+=1){const a=i/40*TAU;clean.push({...first,x:cx+Math.cos(a)*b.w/2,y:cy+Math.sin(a)*b.h/2})}
      return {type:'circle',points:clean}
    }
    const s=simplify(points,.035)
    if(s.length>=4&&s.length<=7){
      if(s.length<=5)return {type:'triangle',points:[s[0],s[Math.floor((s.length-1)/3)],s[Math.floor((s.length-1)*2/3)],s[0]]}
      const p1={...first,x:b.minX,y:b.minY},p2={...first,x:b.maxX,y:b.minY},p3={...first,x:b.maxX,y:b.maxY},p4={...first,x:b.minX,y:b.maxY}
      return {type:'rectangle',points:[p1,p2,p3,p4,p1]}
    }
  }

  if(points.length>8){
    const tail=points.slice(-Math.min(8,points.length))
    const base=points[Math.max(0,points.length-9)]
    const tip=last
    const spread=Math.max(...tail.map(p=>Math.hypot(p.x-tip.x,p.y-tip.y)))
    if(spread<diag*.22&&Math.hypot(base.x-tip.x,base.y-tip.y)>spread*1.8){
      const angle=Math.atan2(tip.y-base.y,tip.x-base.x),head=Math.min(.06,diag*.18)
      const left={...tip,x:tip.x-Math.cos(angle-.55)*head,y:tip.y-Math.sin(angle-.55)*head}
      const right={...tip,x:tip.x-Math.cos(angle+.55)*head,y:tip.y-Math.sin(angle+.55)*head}
      return {type:'arrow',points:[first,tip,left,tip,right]}
    }
  }
  return null
}

export function straightenStroke(stroke) {
  const pts=stroke?.points||[]
  if(pts.length<2)return stroke
  const first=pts[0],last=pts[pts.length-1]
  return {...stroke,points:[first,last],shape:'line'}
}

export function straightenWriting(strokes) {
  const rows=[]
  const sorted=[...(strokes||[])].sort((a,b)=>(strokeBounds(a).minY-strokeBounds(b).minY))
  for(const stroke of sorted){
    const b=strokeBounds(stroke)
    let row=rows.find(r=>Math.abs(r.y-(b.minY+b.maxY)/2)<.035)
    if(!row){row={y:(b.minY+b.maxY)/2,items:[]};rows.push(row)}
    row.items.push(stroke)
  }
  const targetRows=rows.map(r=>r.items.reduce((a,s)=>a+(strokeBounds(s).minY+strokeBounds(s).maxY)/2,0)/r.items.length)
  return (strokes||[]).map(stroke=>{
    const b=strokeBounds(stroke),cy=(b.minY+b.maxY)/2
    let best=0
    for(let i=1;i<targetRows.length;i++)if(Math.abs(targetRows[i]-cy)<Math.abs(targetRows[best]-cy))best=i
    const dy=(targetRows[best]-cy)*.42
    return {...stroke,points:(stroke.points||[]).map(p=>({...p,y:p.y+dy}))}
  })
}

export function cloneStrokes(strokes){ return JSON.parse(JSON.stringify(strokes||[])) }
