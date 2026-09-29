import { useEffect, useRef, useState } from 'react'
import { Check, CheckSquare, ChevronDown, ChevronUp, FileText, Keyboard, Pencil, Sparkles, Trash2 } from 'lucide-react'
import './meeting-scribble.css'

const STORAGE_KEY = 'ana-meeting-scribble-v1'

function readSaved() {
  try { const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function latestLine(text='') {
  const end=text.length, start=Math.max(0,text.lastIndexOf('\n',Math.max(0,end-1))+1), raw=text.slice(start,end), lead=raw.length-raw.trimStart().length
  return raw.trim() ? {start:start+lead,end,text:raw.trim()} : null
}

export default function MeetingScribble() {
  const saved=readSaved()
  const [text,setText]=useState(String(saved.text||''))
  const [layout,setLayout]=useState(['sentence','lined','todo'].includes(saved.layout)?saved.layout:'lined')
  const [autoFix,setAutoFix]=useState(saved.autoFix!==false)
  const [meetingActive,setMeetingActive]=useState(Boolean(saved.meetingActive))
  const [open,setOpen]=useState(Boolean(saved.meetingActive))
  const [status,setStatus]=useState('')
  const [error,setError]=useState('')
  const ref=useRef(null), timer=useRef(null), request=useRef(0), processed=useRef(new Set())

  useEffect(()=>{ try{localStorage.setItem(STORAGE_KEY,JSON.stringify({text,layout,autoFix,meetingActive}))}catch{} },[text,layout,autoFix,meetingActive])
  useEffect(()=>{
    const start=()=>{clearTimeout(timer.current);request.current+=1;processed.current.clear();setText('');setMeetingActive(true);setOpen(true);setError('');setStatus('New meeting notes')}
    const end=()=>{clearTimeout(timer.current);setMeetingActive(false);setStatus('Notes saved with meeting')}
    window.addEventListener('ana:meeting-started',start); window.addEventListener('ana:meeting-ended',end)
    return()=>{clearTimeout(timer.current);window.removeEventListener('ana:meeting-started',start);window.removeEventListener('ana:meeting-ended',end)}
  },[])

  const runAI=async(candidate,instruction,label='Updated')=>{
    if(!candidate?.text)return
    const id=++request.current; setStatus('Ana is working…'); setError('')
    try{
      const res=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:candidate.text,instructions:instruction})})
      const raw=await res.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{}
      if(!res.ok)throw new Error(data?.error||'Ana could not update the note.')
      const out=String(data?.content||'').trim(); if(!out||id!==request.current)return
      setText(current=>current.slice(candidate.start,candidate.end)===candidate.text?current.slice(0,candidate.start)+out+current.slice(candidate.end):current)
      setStatus(label); setTimeout(()=>setStatus(''),1100)
    }catch(e){if(id===request.current){setStatus('');setError(e?.message||'Ana could not update the note.')}}
  }
  const correctionInstruction="Correct only obvious handwriting recognition, spelling, grammar, duplicated or missing-word errors. Preserve meaning, language, tone, names, numbers, abbreviations and technical terms. Do not translate or add information. Return only the corrected text."
  const schedule=value=>{
    clearTimeout(timer.current); if(!autoFix)return
    const c=latestLine(value); if(!c||c.text.length<2)return
    const sig=`${c.start}:${c.end}:${c.text}`; if(processed.current.has(sig))return
    timer.current=setTimeout(()=>{processed.current.add(sig);void runAI(c,correctionInstruction,'Auto-corrected')},950)
  }
  const change=e=>{const v=e.target.value;setText(v);setError('');schedule(v)}
  const selection=()=>{
    const n=ref.current;if(!n)return null
    const start=n.selectionStart||0,end=n.selectionEnd||0
    if(end>start&&text.slice(start,end).trim())return{start,end,text:text.slice(start,end)}
    return latestLine(text)
  }
  const selectedAction=(kind)=>{
    const c=selection(); if(!c){setError('Select some text first.');return}
    const prompts={
      correct:correctionInstruction,
      rewrite:"Rewrite this note clearly and naturally while preserving its exact meaning, language, names, numbers and technical terms. Keep it concise. Return only the rewritten text.",
      shorten:"Shorten this note without losing any important meaning, names, numbers, decisions or technical terms. Return only the shortened text.",
      clarify:"Make this note clearer without inventing information or changing its meaning. Preserve its language and technical terms. Return only the improved text.",
      translate:"Translate this note into the meeting output language if it is evident from context; otherwise translate to English. Preserve names, numbers and technical terms. Return only the translation."
    }
    void runAI(c,prompts[kind],kind==='correct'?'Corrected':'Updated')
  }
  const focusType=()=>{setOpen(true);requestAnimationFrame(()=>ref.current?.focus?.())}
  const clear=()=>{clearTimeout(timer.current);request.current+=1;processed.current.clear();setText('');setError('');setStatus('')}

  return <section className={`meeting-scribble ${meetingActive?'active-meeting':''} ${open?'open':'collapsed'}`}>
    <button type="button" className="meeting-notes-toggle" onClick={()=>setOpen(v=>!v)}>
      <span><Pencil size={15}/><strong>Meeting Notes</strong>{meetingActive&&<em>live</em>}{text.trim()&&<small>{text.trim().split(/\s+/).length} words</small>}</span>
      {open?<ChevronUp size={17}/>:<ChevronDown size={17}/>}
    </button>
    {open&&<div className="meeting-notes-inner">
      <div className="meeting-notes-toolbar">
        <div className="meeting-scribble-layout">
          <button type="button" className={layout==='sentence'?'active':''} onClick={()=>setLayout('sentence')}><FileText size={14}/> Plain</button>
          <button type="button" className={layout==='lined'?'active':''} onClick={()=>setLayout('lined')}><Pencil size={14}/> Lined</button>
          <button type="button" className={layout==='todo'?'active':''} onClick={()=>setLayout('todo')}><CheckSquare size={14}/> To-do</button>
        </div>
        <div className="meeting-scribble-actions">
          <button type="button" onClick={focusType}><Keyboard size={14}/> Type</button>
          <label className="meeting-autofix"><input type="checkbox" checked={autoFix} onChange={e=>{setAutoFix(e.target.checked);if(e.target.checked)schedule(text)}}/> Auto-correct</label>
          <button type="button" onClick={clear} disabled={!text}><Trash2 size={14}/> Clear</button>
        </div>
      </div>
      <div className="meeting-selection-actions">
        <span>Selected text:</span>
        <button onClick={()=>selectedAction('correct')}>Correct</button><button onClick={()=>selectedAction('rewrite')}>Rewrite</button><button onClick={()=>selectedAction('shorten')}>Shorten</button><button onClick={()=>selectedAction('clarify')}>Clarify</button><button onClick={()=>selectedAction('translate')}>Translate</button>
      </div>
      <div className={`meeting-scribble-pad ${layout}`}>
        {layout==='todo'&&<div className="meeting-scribble-todo-gutter" aria-hidden="true">{Array.from({length:18},(_,i)=><span key={i}/>)}</div>}
        <textarea ref={ref} value={text} onChange={change} inputMode="text" autoCapitalize="sentences" autoCorrect="on" spellCheck placeholder={layout==='todo'?'Type or write the first action…':'Type or write with Apple Pencil…'} aria-label="Meeting notes"/>
      </div>
      {(status||error)&&<div className={error?'meeting-scribble-error':'meeting-scribble-status'}>{error||<><Check size={13}/>{status}</>}</div>}
    </div>}
  </section>
}
