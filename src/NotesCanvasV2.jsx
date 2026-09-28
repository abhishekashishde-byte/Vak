import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Brush, CheckSquare, Circle, Copy, Eraser, FilePlus2, Grid3X3,
  Highlighter, Lasso, Maximize2, Minus, MousePointer2, Move, Palette, PenLine, Pencil,
  Plus, Redo2, RotateCw, Ruler, ScanLine, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import {
  PEN_PRESETS, cloneStrokes, erasePrecise, eraseWholeStroke, eventPoints, makeStrokeIndex,
  predictedPoints, recognizeHeldShape, renderLive, renderStatic, straightenStroke,
  straightenWriting, strokeBounds, strokesInLasso, strokesInRect, transformStrokes,
} from './notesInkV2.js'
import './notesCanvasV2.css'

const uid = () => globalThis.crypto?.randomUUID?.() || `ana-${Date.now()}-${Math.random().toString(16).slice(2)}`
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v))
const PAPER_TEMPLATES=[
  ['blank','Blank'],['ruled','Lined'],['grid','Grid'],['dotted','Dotted'],
  ['bullets','Bullets'],['cornell','Cornell'],['meeting','Meeting'],
]
const PAPER_COLORS=[['white','#fff'],['cream','#fffaf0'],['dark','#202124']]
const PAGE_SIZES={
  a4:{label:'A4',w:720,h:1018},
  letter:{label:'Letter',w:720,h:932},
  endless:{label:'Endless',w:720,h:1800},
}
const FONTS=['Inter','Georgia','Arial','Courier New']
const COLORS=['#171717','#1E4E8C','#A33B3B','#2F6B4F','#6A4E8A','#B86B2E','#E4C441','#EF84AC']
const WIDTHS=[1.2,2.2,3.8,5.8]
const PEN_TOOLS=['ballpoint','fountain','brush','pencil','highlighter']

function emptyPage(overrides={}){
  return {
    id:uid(), name:'Page 1', size:'a4', orientation:'portrait', endlessHeight:1800,
    template:'ruled', paperColor:'cream', strokes:[], textBlocks:[], ...overrides,
  }
}
export function normalizeNotesDocument(input, legacy={}) {
  if(input?.version===2&&Array.isArray(input.pages)&&input.pages.length){
    const pages=input.pages.map((p,i)=>({...emptyPage(),...p,id:p.id||uid(),name:p.name||`Page ${i+1}`,strokes:Array.isArray(p.strokes)?p.strokes:[],textBlocks:Array.isArray(p.textBlocks)?p.textBlocks:[]}))
    const currentPageId=pages.some(p=>p.id===input.currentPageId)?input.currentPageId:pages[0].id
    return {...input,version:2,pages,currentPageId}
  }
  const page=emptyPage({
    template:legacy.paperTemplate||'ruled',
    strokes:Array.isArray(legacy.strokes)?legacy.strokes:[],
    textBlocks:Array.isArray(legacy.textBlocks)?legacy.textBlocks:[],
  })
  return {version:2,currentPageId:page.id,pages:[page]}
}
function pageDims(page){
  const base=PAGE_SIZES[page.size]||PAGE_SIZES.a4
  let w=base.w,h=page.size==='endless'?(page.endlessHeight||base.h):base.h
  if(page.orientation==='landscape'&&page.size!=='endless')[w,h]=[h,w]
  return {w,h}
}
function selectionBounds(strokes, ids, textBlocks=[], textIds=[]){
  const sid=new Set(ids||[]),tid=new Set(textIds||[])
  let minX=1,minY=1,maxX=0,maxY=0,has=false
  for(const stroke of strokes||[]){
    if(!sid.has(stroke.id))continue
    const b=strokeBounds(stroke);minX=Math.min(minX,b.minX);minY=Math.min(minY,b.minY);maxX=Math.max(maxX,b.maxX);maxY=Math.max(maxY,b.maxY);has=true
  }
  for(const block of textBlocks||[]){
    if(!tid.has(block.id))continue
    minX=Math.min(minX,block.x);minY=Math.min(minY,block.y);maxX=Math.max(maxX,block.x+(block.w||.3));maxY=Math.max(maxY,block.y+(block.h||.08));has=true
  }
  return has?{minX,minY,maxX,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2}:null
}
function pointInPolygon(point,poly){
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j]
    if(((a.y>point.y)!==(b.y>point.y))&&(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y+1e-12)+a.x))inside=!inside
  }
  return inside
}

const NotesCanvasV2=forwardRef(function NotesCanvasV2({document,onChange,onTextChange},ref){
  const [doc,setDoc]=useState(()=>normalizeNotesDocument(document))
  const [tool,setTool]=useState('ballpoint')
  const [color,setColor]=useState('#171717')
  const [width,setWidth]=useState(2.2)
  const [eraserMode,setEraserMode]=useState('stroke')
  const [highlighterOnly,setHighlighterOnly]=useState(false)
  const [lassoMode,setLassoMode]=useState('free')
  const [selected,setSelected]=useState({strokeIds:[],textIds:[]})
  const [shapeSnap,setShapeSnap]=useState(true)
  const [rulerOn,setRulerOn]=useState(false)
  const [rulerAngle,setRulerAngle]=useState(0)
  const [zoom,setZoom]=useState(1)
  const [history,setHistory]=useState([])
  const [future,setFuture]=useState([])
  const [clipboard,setClipboard]=useState(null)
  const [activeTextId,setActiveTextId]=useState('')
  const staticRef=useRef(null),liveRef=useRef(null),overlayRef=useRef(null),viewportRef=useRef(null),pageRef=useRef(null)
  const strokesRef=useRef([]),activeRef=useRef(null),rafRef=useRef(null),pointerRef=useRef(null)
  const downAtRef=useRef(0),lassoRef=useRef([]),eraseChangedRef=useRef(false),indexRef=useRef(null)
  const touchesRef=useRef(new Map()),gestureRef=useRef(null),stylusUntilRef=useRef(0)
  const dragSelectionRef=useRef(null),textDragRef=useRef(null)

  useEffect(()=>{setDoc(normalizeNotesDocument(document))},[document?.currentPageId,document?.pages?.length])
  const page=useMemo(()=>doc.pages.find(p=>p.id===doc.currentPageId)||doc.pages[0],[doc])
  const dims=pageDims(page)
  const displayW=dims.w*zoom,displayH=dims.h*zoom
  useEffect(()=>{strokesRef.current=page.strokes||[];indexRef.current=makeStrokeIndex(strokesRef.current)},[page.id,page.strokes])
  useEffect(()=>{renderStatic(staticRef.current,page.strokes||[],1)},[page.id,page.strokes,zoom,displayW,displayH])
  useEffect(()=>{drawOverlay()},[selected,page.id,zoom])

  useImperativeHandle(ref,()=>({
    exportCurrentPage(){
      const canvas=staticRef.current
      if(!canvas)return ''
      const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height
      const ctx=out.getContext('2d')
      ctx.fillStyle=page.paperColor==='dark'?'#202124':page.paperColor==='white'?'#fff':'#fffaf0'
      ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0)
      return out.toDataURL('image/png',.94)
    },
    getDocument(){return doc},
    getAllText(){return doc.pages.flatMap(p=>p.textBlocks||[]).map(b=>b.text||'').filter(Boolean).join('\n\n')},
    getAllStrokes(){return doc.pages.flatMap(p=>p.strokes||[])},
  }),[doc,page])

  function emit(next){
    setDoc(next);onChange?.(next)
    onTextChange?.(next.pages.flatMap(p=>p.textBlocks||[]).map(b=>String(b.text||'').trim()).filter(Boolean).join('\n\n'))
  }
  function updatePage(patch,record=true){
    if(record)pushHistory()
    const next={...doc,pages:doc.pages.map(p=>p.id===page.id?{...p,...patch}:p)}
    emit(next)
  }
  function pushHistory(){
    setHistory(prev=>[...prev.slice(-39),JSON.parse(JSON.stringify(doc))]);setFuture([])
  }
  function undo(){
    const prev=history[history.length-1];if(!prev)return
    setFuture(f=>[JSON.parse(JSON.stringify(doc)),...f].slice(0,40));setHistory(h=>h.slice(0,-1));emit(prev);setSelected({strokeIds:[],textIds:[]})
  }
  function redo(){
    const next=future[0];if(!next)return
    setHistory(h=>[...h,JSON.parse(JSON.stringify(doc))].slice(-40));setFuture(f=>f.slice(1));emit(next);setSelected({strokeIds:[],textIds:[]})
  }
  function commitStrokes(strokes,record=true){
    updatePage({strokes},record)
    strokesRef.current=strokes;indexRef.current=makeStrokeIndex(strokes)
  }
  function frameLive(pred=[]){
    if(rafRef.current)cancelAnimationFrame(rafRef.current)
    rafRef.current=requestAnimationFrame(()=>renderLive(liveRef.current,activeRef.current,pred,1))
  }
  function normalizedPoint(event){
    const rect=liveRef.current.getBoundingClientRect()
    const pts=eventPoints(event,rect)
    return pts[pts.length-1]
  }
  function pointerDown(event){
    if(event.pointerType==='pen')stylusUntilRef.current=Date.now()+1400
    if(event.pointerType==='touch'){
      touchesRef.current.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(touchesRef.current.size>=2){
        const vals=[...touchesRef.current.values()]
        const dist=Math.hypot(vals[1].x-vals[0].x,vals[1].y-vals[0].y)
        const mid={x:(vals[0].x+vals[1].x)/2,y:(vals[0].y+vals[1].y)/2}
        gestureRef.current={dist,zoom,mid,scrollLeft:viewportRef.current?.scrollLeft||0,scrollTop:viewportRef.current?.scrollTop||0,angle:Math.atan2(vals[1].y-vals[0].y,vals[1].x-vals[0].x),rulerAngle}
        return
      }
      if(Date.now()<stylusUntilRef.current||PEN_TOOLS.includes(tool)||tool==='eraser'||tool==='lasso')return
    }
    if(pointerRef.current!==null)return
    const p=normalizedPoint(event)
    if(tool==='type'){addText(p);return}
    const b=selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)
    if(tool==='lasso'&&b&&p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY){
      pointerRef.current=event.pointerId;dragSelectionRef.current={start:p,last:p};event.preventDefault();return
    }
    pointerRef.current=event.pointerId;downAtRef.current=performance.now();event.preventDefault()
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    if(tool==='eraser'){
      pushHistory();eraseChangedRef.current=false;eraseAt(p);return
    }
    if(tool==='lasso'){
      lassoRef.current=[p];drawOverlay();return
    }
    if(!PEN_TOOLS.includes(tool))return
    const rect=liveRef.current.getBoundingClientRect()
    const points=eventPoints(event,rect)
    activeRef.current={id:uid(),kind:tool,color:tool==='highlighter'?(color==='#171717'?'#E4C441':color):color,width:tool==='highlighter'?Math.max(10,width*4.5):width,points,startedAt:performance.now()}
    frameLive(predictedPoints(event,rect))
  }
  function pointerMove(event){
    if(event.pointerType==='pen')stylusUntilRef.current=Date.now()+1400
    if(event.pointerType==='touch'){
      if(touchesRef.current.has(event.pointerId))touchesRef.current.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(gestureRef.current&&touchesRef.current.size>=2){
        const vals=[...touchesRef.current.values()],g=gestureRef.current
        const dist=Math.hypot(vals[1].x-vals[0].x,vals[1].y-vals[0].y)
        const mid={x:(vals[0].x+vals[1].x)/2,y:(vals[0].y+vals[1].y)/2}
        if(rulerOn){
          const angle=Math.atan2(vals[1].y-vals[0].y,vals[1].x-vals[0].x)
          setRulerAngle(g.rulerAngle+(angle-g.angle)*180/Math.PI)
        }else{
          setZoom(clamp(g.zoom*(dist/Math.max(20,g.dist)),.45,3.5))
          if(viewportRef.current){viewportRef.current.scrollLeft=g.scrollLeft-(mid.x-g.mid.x);viewportRef.current.scrollTop=g.scrollTop-(mid.y-g.mid.y)}
        }
        event.preventDefault();return
      }
      if(Date.now()<stylusUntilRef.current||PEN_TOOLS.includes(tool)||tool==='eraser'||tool==='lasso')return
    }
    if(pointerRef.current!==event.pointerId)return
    const p=normalizedPoint(event)
    if(dragSelectionRef.current){
      const last=dragSelectionRef.current.last,dx=p.x-last.x,dy=p.y-last.y
      dragSelectionRef.current.last=p
      const strokes=transformStrokes(strokesRef.current,selected.strokeIds,{dx,dy})
      const tids=new Set(selected.textIds)
      const textBlocks=(page.textBlocks||[]).map(b=>tids.has(b.id)?{...b,x:b.x+dx,y:b.y+dy}:b)
      strokesRef.current=strokes
      const next={...doc,pages:doc.pages.map(pg=>pg.id===page.id?{...pg,strokes,textBlocks}:pg)}
      setDoc(next);renderStatic(staticRef.current,strokes,1);drawOverlay(strokes,textBlocks);return
    }
    if(tool==='eraser'){eraseAt(p);return}
    if(tool==='lasso'){
      lassoRef.current.push(p);drawOverlay();return
    }
    if(!activeRef.current)return
    const rect=liveRef.current.getBoundingClientRect()
    activeRef.current.points.push(...eventPoints(event,rect))
    frameLive(predictedPoints(event,rect))
  }
  function pointerUp(event){
    if(event.pointerType==='touch'){
      touchesRef.current.delete(event.pointerId)
      if(touchesRef.current.size<2)gestureRef.current=null
    }
    if(pointerRef.current!==event.pointerId)return
    pointerRef.current=null
    if(dragSelectionRef.current){
      dragSelectionRef.current=null;pushHistory()
      const next={...doc,pages:doc.pages.map(pg=>pg.id===page.id?{...pg,strokes:strokesRef.current,textBlocks:page.textBlocks}:pg)}
      emit(next);indexRef.current=makeStrokeIndex(strokesRef.current);return
    }
    if(tool==='eraser'){if(eraseChangedRef.current)commitStrokes(strokesRef.current,false);return}
    if(tool==='lasso'){
      const poly=lassoRef.current;lassoRef.current=[]
      let strokeIds=[]
      if(lassoMode==='rect'&&poly.length>1){
        const a=poly[0],b=poly[poly.length-1],r={minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)}
        strokeIds=strokesInRect(page.strokes,r)
      }else strokeIds=strokesInLasso(page.strokes,poly)
      const textIds=(page.textBlocks||[]).filter(b=>{
        const center={x:b.x+(b.w||.3)/2,y:b.y+(b.h||.08)/2}
        return lassoMode==='rect'&&poly.length>1?center.x>=Math.min(poly[0].x,poly.at(-1).x)&&center.x<=Math.max(poly[0].x,poly.at(-1).x)&&center.y>=Math.min(poly[0].y,poly.at(-1).y)&&center.y<=Math.max(poly[0].y,poly.at(-1).y):pointInPolygon(center,poly)
      }).map(b=>b.id)
      setSelected({strokeIds,textIds});drawOverlay();return
    }
    const stroke=activeRef.current;activeRef.current=null;renderLive(liveRef.current,null,[],1)
    if(!stroke?.points?.length)return
    const held=performance.now()-downAtRef.current
    let finalStroke=stroke
    if(rulerOn){
      const first=stroke.points[0],rad=rulerAngle*Math.PI/180
      const last=stroke.points.at(-1),len=(last.x-first.x)*Math.cos(rad)+(last.y-first.y)*Math.sin(rad)
      finalStroke={...stroke,points:[first,{...last,x:first.x+Math.cos(rad)*len,y:first.y+Math.sin(rad)*len}],shape:'ruler-line'}
    }else if(stroke.kind==='highlighter'&&held>350)finalStroke=straightenStroke(stroke)
    else if(shapeSnap){
      const shape=recognizeHeldShape(stroke,held)
      if(shape)finalStroke={...stroke,...shape,points:shape.points}
    }
    const strokes=[...strokesRef.current,finalStroke]
    if(page.size==='endless'){
      const b=strokeBounds(finalStroke)
      if(b.maxY>.9)updatePage({strokes,endlessHeight:(page.endlessHeight||1800)+700},true)
      else commitStrokes(strokes,true)
    }else commitStrokes(strokes,true)
  }
  function pointerCancel(event){if(pointerRef.current===event.pointerId){activeRef.current=null;pointerRef.current=null;renderLive(liveRef.current,null,[],1)}if(event.pointerType==='touch')touchesRef.current.delete(event.pointerId)}
  function eraseAt(p){
    const radius=clamp(.006+width/300,.009,.04)
    const before=strokesRef.current
    const next=eraserMode==='precise'?erasePrecise(before,p,radius,highlighterOnly,indexRef.current):eraseWholeStroke(before,p,radius,highlighterOnly,indexRef.current)
    if(next!==before){strokesRef.current=next;indexRef.current=makeStrokeIndex(next);eraseChangedRef.current=true;renderStatic(staticRef.current,next,1)}
  }
  function drawOverlay(strokes=page.strokes,textBlocks=page.textBlocks){
    const canvas=overlayRef.current;if(!canvas)return
    const rect=canvas.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1)
    if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height)
    if(lassoRef.current.length){
      const poly=lassoRef.current;ctx.strokeStyle='#4f74a9';ctx.lineWidth=1.4;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(poly[0].x*rect.width,poly[0].y*rect.height)
      for(const p of poly.slice(1))ctx.lineTo(p.x*rect.width,p.y*rect.height);ctx.stroke();ctx.setLineDash([])
    }
    const b=selectionBounds(strokes,selected.strokeIds,textBlocks,selected.textIds)
    if(b){ctx.strokeStyle='#315f9c';ctx.lineWidth=1.3;ctx.setLineDash([5,3]);ctx.strokeRect(b.minX*rect.width,b.minY*rect.height,(b.maxX-b.minX)*rect.width,(b.maxY-b.minY)*rect.height);ctx.setLineDash([])}
  }
  function transformSelection(transform){
    if(!selected.strokeIds.length&&!selected.textIds.length)return
    pushHistory()
    const strokes=transformStrokes(page.strokes,selected.strokeIds,transform)
    const tids=new Set(selected.textIds)
    const b=selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)||{cx:.5,cy:.5}
    const cos=Math.cos(transform.rotation||0),sin=Math.sin(transform.rotation||0)
    const textBlocks=(page.textBlocks||[]).map(block=>{
      if(!tids.has(block.id))return block
      let x=(block.x-b.cx)*(transform.scaleX||1),y=(block.y-b.cy)*(transform.scaleY||1)
      return {...block,x:b.cx+x*cos-y*sin+(transform.dx||0),y:b.cy+x*sin+y*cos+(transform.dy||0),w:(block.w||.3)*(transform.scaleX||1),h:(block.h||.08)*(transform.scaleY||1),style:{...(block.style||{}),color:transform.color||block.style?.color,fontSize:(block.style?.fontSize||15)*(transform.widthScale||1)}}
    })
    updatePage({strokes,textBlocks},false)
  }
  function duplicateSelection(){
    const sids=new Set(selected.strokeIds),tids=new Set(selected.textIds)
    const newStrokes=page.strokes.filter(s=>sids.has(s.id)).map(s=>({...cloneStrokes([s])[0],id:uid(),points:s.points.map(p=>({...p,x:p.x+.035,y:p.y+.035}))}))
    const newText=(page.textBlocks||[]).filter(b=>tids.has(b.id)).map(b=>({...JSON.parse(JSON.stringify(b)),id:uid(),x:b.x+.035,y:b.y+.035}))
    pushHistory();updatePage({strokes:[...page.strokes,...newStrokes],textBlocks:[...(page.textBlocks||[]),...newText]},false)
    setSelected({strokeIds:newStrokes.map(s=>s.id),textIds:newText.map(b=>b.id)})
  }
  function deleteSelection(){
    const sids=new Set(selected.strokeIds),tids=new Set(selected.textIds);pushHistory()
    updatePage({strokes:page.strokes.filter(s=>!sids.has(s.id)),textBlocks:(page.textBlocks||[]).filter(b=>!tids.has(b.id))},false)
    setSelected({strokeIds:[],textIds:[]})
  }
  function copySelection(){
    const sids=new Set(selected.strokeIds),tids=new Set(selected.textIds)
    setClipboard({strokes:cloneStrokes(page.strokes.filter(s=>sids.has(s.id))),textBlocks:JSON.parse(JSON.stringify((page.textBlocks||[]).filter(b=>tids.has(b.id))))})
  }
  function pasteSelection(){
    if(!clipboard)return
    const strokes=(clipboard.strokes||[]).map(s=>({...s,id:uid(),points:s.points.map(p=>({...p,x:p.x+.025,y:p.y+.025}))}))
    const text=(clipboard.textBlocks||[]).map(b=>({...b,id:uid(),x:b.x+.025,y:b.y+.025}))
    pushHistory();updatePage({strokes:[...page.strokes,...strokes],textBlocks:[...(page.textBlocks||[]),...text]},false)
    setSelected({strokeIds:strokes.map(s=>s.id),textIds:text.map(b=>b.id)})
  }
  function convertSelectionToText(){
    const sids=new Set(selected.strokeIds);if(!sids.size)return
    const b=selectionBounds(page.strokes,selected.strokeIds,[],[])
    const block={id:uid(),x:b?.minX||.1,y:b?.minY||.1,w:Math.max(.25,(b?.maxX||.6)-(b?.minX||.1)),h:.1,text:'',style:{fontSize:15,font:'Inter',color:'#171717'},needsRecognition:true}
    pushHistory();updatePage({textBlocks:[...(page.textBlocks||[]),block]},false);setActiveTextId(block.id);setTool('type')
  }
  function addText(p){
    pushHistory()
    const block={id:uid(),x:clamp(p.x,.02,.78),y:clamp(p.y,.02,.92),w:.32,h:.08,text:'',style:{fontSize:15,font:'Inter',color:page.paperColor==='dark'?'#f5f5f5':'#171717',bold:false,italic:false,underline:false,list:'none'}}
    updatePage({textBlocks:[...(page.textBlocks||[]),block]},false);setActiveTextId(block.id)
  }
  function updateText(id,patch){
    const blocks=(page.textBlocks||[]).map(b=>b.id===id?{...b,...patch,style:{...(b.style||{}),...(patch.style||{})}}:b)
    updatePage({textBlocks:blocks},false)
  }
  function startTextDrag(event,block){
    if(tool!=='type')return
    event.preventDefault();event.stopPropagation();textDragRef.current={id:block.id,startX:event.clientX,startY:event.clientY,x:block.x,y:block.y}
    const move=e=>{const r=pageRef.current.getBoundingClientRect(),g=textDragRef.current;if(!g)return;updateText(g.id,{x:clamp(g.x+(e.clientX-g.startX)/r.width,0,.94),y:clamp(g.y+(e.clientY-g.startY)/r.height,0,.96)})}
    const up=()=>{textDragRef.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  }
  function addPage(){
    pushHistory();const p=emptyPage({name:`Page ${doc.pages.length+1}`,template:page.template,paperColor:page.paperColor,size:page.size,orientation:page.orientation})
    emit({...doc,pages:[...doc.pages,p],currentPageId:p.id});setSelected({strokeIds:[],textIds:[]})
  }
  function duplicatePage(){
    pushHistory();const p={...JSON.parse(JSON.stringify(page)),id:uid(),name:`${page.name} copy`,strokes:cloneStrokes(page.strokes).map(s=>({...s,id:uid()})),textBlocks:(page.textBlocks||[]).map(b=>({...b,id:uid()}))}
    const idx=doc.pages.findIndex(p=>p.id===page.id),pages=[...doc.pages];pages.splice(idx+1,0,p);emit({...doc,pages,currentPageId:p.id})
  }
  function movePage(dir){
    const idx=doc.pages.findIndex(p=>p.id===page.id),next=idx+dir;if(next<0||next>=doc.pages.length)return
    pushHistory();const pages=[...doc.pages];[pages[idx],pages[next]]=[pages[next],pages[idx]];emit({...doc,pages})
  }
  function deletePage(){
    if(doc.pages.length<=1){updatePage({strokes:[],textBlocks:[]});return}
    pushHistory();const idx=doc.pages.findIndex(p=>p.id===page.id),pages=doc.pages.filter(p=>p.id!==page.id);emit({...doc,pages,currentPageId:pages[Math.max(0,idx-1)].id})
  }
  function fitPage(){
    const vp=viewportRef.current;if(!vp)return
    const target=clamp((vp.clientWidth-44)/dims.w,.45,1.5);setZoom(target);requestAnimationFrame(()=>{vp.scrollLeft=Math.max(0,(dims.w*target-vp.clientWidth)/2);vp.scrollTop=0})
  }
  function straightenAll(){pushHistory();updatePage({strokes:straightenWriting(page.strokes)},false)}

  const activeText=(page.textBlocks||[]).find(b=>b.id===activeTextId)
  const paperHex=PAPER_COLORS.find(([id])=>id===page.paperColor)?.[1]||'#fffaf0'
  const textColor=page.paperColor==='dark'?'#f4f4f4':'#222'

  return <div className="ana-v2">
    <aside className="ana-v2-pages">
      <div className="ana-v2-pages-head"><strong>Pages</strong><button onClick={addPage}><Plus size={14}/></button></div>
      <div className="ana-v2-thumbs">{doc.pages.map((p,i)=><button className={p.id===page.id?'active':''} key={p.id} onClick={()=>emit({...doc,currentPageId:p.id})}>
        <span className={`ana-v2-thumb paper-${p.template} paper-color-${p.paperColor}`}><small>{i+1}</small></span><b>{p.name||`Page ${i+1}`}</b>
      </button>)}</div>
      <div className="ana-v2-page-actions"><button onClick={duplicatePage} title="Duplicate page"><Copy size={13}/></button><button onClick={()=>movePage(-1)}><ArrowUp size={13}/></button><button onClick={()=>movePage(1)}><ArrowDown size={13}/></button><button onClick={deletePage}><Trash2 size={13}/></button></div>
    </aside>

    <section className="ana-v2-editor">
      <div className="ana-v2-toolbar">
        <div className="ana-v2-tools">
          <button className={tool==='ballpoint'?'active':''} onClick={()=>{setTool('ballpoint');setWidth(PEN_PRESETS.ballpoint.size)}} title="Ballpoint"><PenLine size={15}/></button>
          <button className={tool==='fountain'?'active':''} onClick={()=>{setTool('fountain');setWidth(PEN_PRESETS.fountain.size)}} title="Fountain pen"><PenLine size={17}/></button>
          <button className={tool==='brush'?'active':''} onClick={()=>{setTool('brush');setWidth(PEN_PRESETS.brush.size)}} title="Brush pen"><Brush size={15}/></button>
          <button className={tool==='pencil'?'active':''} onClick={()=>{setTool('pencil');setWidth(PEN_PRESETS.pencil.size)}} title="Pencil"><Pencil size={15}/></button>
          <button className={tool==='highlighter'?'active':''} onClick={()=>{setTool('highlighter');setWidth(PEN_PRESETS.highlighter.size)}} title="Highlighter"><Highlighter size={15}/></button>
          <button className={tool==='eraser'?'active':''} onClick={()=>setTool('eraser')}><Eraser size={15}/></button>
          <button className={tool==='lasso'?'active':''} onClick={()=>setTool('lasso')}><Lasso size={15}/></button>
          <button className={tool==='type'?'active':''} onClick={()=>setTool('type')}><Type size={15}/></button>
        </div>
        {PEN_TOOLS.includes(tool)&&<div className="ana-v2-palette">{COLORS.map(c=><button key={c} className={color===c?'active':''} style={{'--c':c}} onClick={()=>setColor(c)}/>)}<input type="color" value={color} onChange={e=>setColor(e.target.value)}/>{WIDTHS.map(v=><button className={Math.abs(width-v)<.05?'active':''} key={v} onClick={()=>setWidth(v)}><span style={{height:Math.min(8,Math.max(2,v))}}/></button>)}</div>}
        {tool==='eraser'&&<div className="ana-v2-options"><select value={eraserMode} onChange={e=>setEraserMode(e.target.value)}><option value="stroke">Stroke eraser</option><option value="precise">Precise eraser</option></select><label><input type="checkbox" checked={highlighterOnly} onChange={e=>setHighlighterOnly(e.target.checked)}/> Highlights only</label></div>}
        {tool==='lasso'&&<div className="ana-v2-options"><button className={lassoMode==='free'?'active':''} onClick={()=>setLassoMode('free')}>Freeform</button><button className={lassoMode==='rect'?'active':''} onClick={()=>setLassoMode('rect')}>Rectangle</button></div>}
        <div className="ana-v2-tools secondary"><button onClick={undo}><Undo2 size={14}/></button><button onClick={redo}><Redo2 size={14}/></button><button className={shapeSnap?'active':''} onClick={()=>setShapeSnap(v=>!v)} title="Hold to perfect shapes"><Circle size={14}/></button><button className={rulerOn?'active':''} onClick={()=>setRulerOn(v=>!v)} title="Ruler"><Ruler size={14}/></button><button onClick={straightenAll} title="Straighten handwriting"><ScanLine size={14}/></button></div>
      </div>

      <div className="ana-v2-pagebar">
        <select value={page.size} onChange={e=>updatePage({size:e.target.value})}>{Object.entries(PAGE_SIZES).map(([id,v])=><option key={id} value={id}>{v.label}</option>)}</select>
        <select value={page.orientation} disabled={page.size==='endless'} onChange={e=>updatePage({orientation:e.target.value})}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
        <select value={page.template} onChange={e=>updatePage({template:e.target.value})}>{PAPER_TEMPLATES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
        <select value={page.paperColor} onChange={e=>updatePage({paperColor:e.target.value})}>{PAPER_COLORS.map(([id])=><option key={id} value={id}>{id[0].toUpperCase()+id.slice(1)}</option>)}</select>
        <div className="ana-v2-zoom"><button onClick={()=>setZoom(z=>clamp(z-.1,.45,3.5))}><ZoomOut size={13}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>clamp(z+.1,.45,3.5))}><ZoomIn size={13}/></button><button onClick={fitPage}><Maximize2 size={13}/></button></div>
      </div>

      <div ref={viewportRef} className="ana-v2-viewport" onDoubleClick={fitPage}>
        <div ref={pageRef} className={`ana-v2-page paper-${page.template} paper-color-${page.paperColor}`} style={{width:displayW,height:displayH,'--paper':paperHex,'--inkText':textColor}}>
          <canvas ref={staticRef} className="ana-v2-canvas static"/>
          <div className={`ana-v2-text-layer ${tool==='type'?'editing':''}`}>
            {(page.textBlocks||[]).map(block=><TextBlock key={block.id} block={block} active={activeTextId===block.id} zoom={zoom} editing={tool==='type'} onFocus={()=>setActiveTextId(block.id)} onChange={patch=>updateText(block.id,patch)} onDragStart={e=>startTextDrag(e,block)}/>)}
          </div>
          <canvas ref={liveRef} className="ana-v2-canvas live" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}/>
          <canvas ref={overlayRef} className="ana-v2-canvas overlay"/>
          {rulerOn&&<div className="ana-v2-ruler" style={{transform:`translate(-50%,-50%) rotate(${rulerAngle}deg)`}}><span>0</span><i/><span>20</span></div>}
          {!!(selected.strokeIds.length||selected.textIds.length)&&<SelectionMenu bounds={selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)} onDelete={deleteSelection} onDuplicate={duplicateSelection} onCopy={copySelection} onPaste={pasteSelection} canPaste={!!clipboard} onText={convertSelectionToText} onMove={(x,y)=>transformSelection({dx:x,dy:y})} onScale={s=>transformSelection({scaleX:s,scaleY:s,cx:selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)?.cx,cy:selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)?.cy})} onRotate={r=>transformSelection({rotation:r,cx:selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)?.cx,cy:selectionBounds(page.strokes,selected.strokeIds,page.textBlocks,selected.textIds)?.cy})} onColor={c=>transformSelection({color:c})} onWidth={s=>transformSelection({widthScale:s})}/>}
        </div>
      </div>
      {activeText&&tool==='type'&&<TextToolbar block={activeText} onChange={patch=>updateText(activeText.id,patch)}/>}
    </section>
  </div>
})

function TextBlock({block,active,zoom,editing,onFocus,onChange,onDragStart}){
  const st=block.style||{}
  return <div className={`ana-v2-text ${active?'active':''}`} style={{left:`${block.x*100}%`,top:`${block.y*100}%`,width:`${(block.w||.3)*100}%`,height:`${(block.h||.08)*100}%`}}>
    {editing&&<button className="ana-v2-text-drag" onPointerDown={onDragStart}><Move size={11}/></button>}
    <textarea value={block.text||''} onFocus={onFocus} readOnly={!editing} onChange={e=>onChange({text:e.target.value})} onPointerDown={e=>{if(editing)e.stopPropagation()}} placeholder={block.needsRecognition?'Use “Convert to text” from Ana AI to recognise this selection…':'Type…'} style={{fontFamily:st.font||'Inter',fontSize:`${(st.fontSize||15)*zoom}px`,fontWeight:st.bold?700:400,fontStyle:st.italic?'italic':'normal',textDecoration:st.underline?'underline':'none',color:st.color||'var(--inkText)',lineHeight:1.45}}/>
    {editing&&<span className="ana-v2-resize" onPointerDown={e=>{
      e.preventDefault();e.stopPropagation();const start={x:e.clientX,y:e.clientY,w:block.w||.3,h:block.h||.08}
      const move=ev=>{const page=e.currentTarget.closest('.ana-v2-page')?.getBoundingClientRect();if(!page)return;onChange({w:clamp(start.w+(ev.clientX-start.x)/page.width,.12,.9),h:clamp(start.h+(ev.clientY-start.y)/page.height,.04,.7)})}
      const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)}
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
    }}/>}
  </div>
}
function TextToolbar({block,onChange}){
  const s=block.style||{}
  return <div className="ana-v2-textbar">
    <button className={s.bold?'active':''} onClick={()=>onChange({style:{bold:!s.bold}})}><b>B</b></button>
    <button className={s.italic?'active':''} onClick={()=>onChange({style:{italic:!s.italic}})}><i>I</i></button>
    <button className={s.underline?'active':''} onClick={()=>onChange({style:{underline:!s.underline}})}><u>U</u></button>
    <input type="color" value={s.color||'#171717'} onChange={e=>onChange({style:{color:e.target.value}})}/>
    <select value={s.fontSize||15} onChange={e=>onChange({style:{fontSize:Number(e.target.value)}})}>{[11,13,15,18,22,28,36].map(v=><option key={v}>{v}</option>)}</select>
    <select value={s.font||'Inter'} onChange={e=>onChange({style:{font:e.target.value}})}>{FONTS.map(v=><option key={v}>{v}</option>)}</select>
    <select value={s.list||'none'} onChange={e=>onChange({style:{list:e.target.value}})}><option value="none">Text</option><option value="bullet">Bullets</option><option value="number">Numbered</option><option value="checkbox">Checkboxes</option></select>
  </div>
}
function SelectionMenu({bounds,onDelete,onDuplicate,onCopy,onPaste,canPaste,onText,onMove,onScale,onRotate,onColor,onWidth}){
  if(!bounds)return null
  return <div className="ana-v2-selection-menu" style={{left:`${clamp(bounds.cx,0.12,.88)*100}%`,top:`${clamp(bounds.minY-.045,.02,.92)*100}%`}}>
    <button onClick={()=>onMove(-.015,0)}>←</button><button onClick={()=>onMove(.015,0)}>→</button><button onClick={()=>onMove(0,-.015)}>↑</button><button onClick={()=>onMove(0,.015)}>↓</button>
    <button onClick={()=>onScale(.9)}>-size</button><button onClick={()=>onScale(1.1)}>+size</button><button onClick={()=>onRotate(Math.PI/18)}><RotateCw size={12}/></button>
    <input type="color" onChange={e=>onColor(e.target.value)}/><button onClick={()=>onWidth(.85)}><Minus size={12}/></button><button onClick={()=>onWidth(1.15)}><Plus size={12}/></button>
    <button onClick={onDuplicate}><Copy size={12}/></button><button onClick={onCopy}>Copy</button><button disabled={!canPaste} onClick={onPaste}>Paste</button><button onClick={onText}>Text</button><button onClick={onDelete}><Trash2 size={12}/></button>
  </div>
}
export default NotesCanvasV2
