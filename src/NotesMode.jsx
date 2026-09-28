import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignJustify, Check, Download, Eraser, FileText, Languages, Mic, NotebookPen,
  PenLine, Plus, Redo2, Sparkles, Square, Trash2, Type, Undo2, WandSparkles,
} from 'lucide-react'
import { supabase } from './lib/supabase.js'
import { authenticatedHeaders, endTimedUsage, heartbeatTimedUsage, startTimedUsage } from './usageQuota.js'
import { CONSENT_VERSIONS, recordConsentEvent } from './consentEvents.js'
import { cloneInk, drawInk, pointFromPointer, strokeHit, tidyStrokes } from './notesInk.js'
import './notes.css'

const AUDIO_BUCKET = 'ana-meeting-audio'
const SEGMENT_MS = 10 * 60 * 1000
const LANGUAGES = ['English','German','Hindi','Hinglish','Bengali','Tamil','Telugu','Marathi','Gujarati','Punjabi','Malayalam','Kannada','Urdu','French','Spanish','Italian','Dutch','Polish','Portuguese','Turkish','Arabic','Chinese','Japanese','Korean','Russian','Ukrainian']
const emptyAi = { outputText:'', title:'', summary:'', decisions:[], actions:[], openQuestions:[], keyPoints:[], personalNotes:[] }
const clean = value => String(value || '').trim()
const fmtDuration = ms => {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
const uuid = () => globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`

function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported?.(value)) || ''
}
function extensionForMime(mime='') {
  const value=String(mime).toLowerCase()
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a'
  if (value.includes('ogg')) return 'ogg'
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3'
  if (value.includes('wav')) return 'wav'
  return 'webm'
}
async function blobToWhitePng(canvas) {
  if (!canvas) return ''
  const exportCanvas=document.createElement('canvas')
  exportCanvas.width=canvas.width
  exportCanvas.height=canvas.height
  const ctx=exportCanvas.getContext('2d')
  ctx.fillStyle='#fffdf8'
  ctx.fillRect(0,0,exportCanvas.width,exportCanvas.height)
  ctx.drawImage(canvas,0,0)
  return exportCanvas.toDataURL('image/png',.94)
}
async function runBatched(items, size, worker) {
  const out=[]
  for (let i=0;i<items.length;i+=size) {
    const batch=await Promise.all(items.slice(i,i+size).map(worker))
    out.push(...batch)
  }
  return out
}

export default function NotesMode() {
  const [notes,setNotes]=useState([])
  const [currentId,setCurrentId]=useState('')
  const current=useMemo(()=>notes.find(note=>note.id===currentId)||null,[notes,currentId])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [tool,setTool]=useState('pen')
  const [penOnly,setPenOnly]=useState(true)
  const [ink,setInk]=useState([])
  const [activeStroke,setActiveStroke]=useState(null)
  const [typedText,setTypedText]=useState('')
  const [recognizedText,setRecognizedText]=useState('')
  const [language,setLanguage]=useState('English')
  const [ai,setAi]=useState(emptyAi)
  const [aiStyle,setAiStyle]=useState('typed')
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [consent,setConsent]=useState(false)
  const [recording,setRecording]=useState(false)
  const [recordingStarted,setRecordingStarted]=useState(null)
  const [elapsed,setElapsed]=useState(0)
  const [transcript,setTranscript]=useState('')
  const [meetingStatus,setMeetingStatus]=useState('')
  const canvasRef=useRef(null)
  const inkRef=useRef([])
  const activeStrokeRef=useRef(null)
  const undoRef=useRef([])
  const redoRef=useRef([])
  const saveTimerRef=useRef(null)
  const pointerIdRef=useRef(null)
  const erasingRef=useRef(false)
  const streamRef=useRef(null)
  const recorderRef=useRef(null)
  const recorderChunksRef=useRef([])
  const segmentBlobsRef=useRef([])
  const segmentTimerRef=useRef(null)
  const rotatingRef=useRef(false)
  const quotaRef=useRef(null)
  const quotaTimerRef=useRef(null)
  const quotaDeadlineRef=useRef(null)
  const recordingRef=useRef(false)
  const recordingStartedRef=useRef(null)

  const updateCurrentLocal=(patch)=>{
    if (!currentId) return
    setNotes(prev=>prev.map(note=>note.id===currentId?{...note,...patch,updated_at:new Date().toISOString()}:note))
  }

  useEffect(()=>{ inkRef.current=ink },[ink])
  useEffect(()=>{ activeStrokeRef.current=activeStroke },[activeStroke])
  useEffect(()=>{ recordingRef.current=recording },[recording])
  useEffect(()=>{ recordingStartedRef.current=recordingStarted },[recordingStarted])

  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      if (!supabase) { setLoading(false); return }
      try {
        const { data:userData }=await supabase.auth.getUser()
        if (!userData?.user) throw new Error('Please sign in again.')
        const { data,error:loadError }=await supabase.from('ana_notes').select('*').order('updated_at',{ascending:false}).limit(100)
        if (loadError) throw loadError
        if (cancelled) return
        const rows=Array.isArray(data)?data:[]
        setNotes(rows)
        if (rows[0]) setCurrentId(rows[0].id)
      } catch(err) { if(!cancelled) setError(err?.message||'Could not load Ana Notes.') }
      finally { if(!cancelled) setLoading(false) }
    })()
    return ()=>{cancelled=true}
  },[])

  useEffect(()=>{
    if (!current) return
    setInk(Array.isArray(current.ink)?current.ink:[])
    setTypedText(current.typed_text||'')
    setRecognizedText(current.recognized_text||'')
    setLanguage(current.language||'English')
    setAi({...emptyAi,...(current.ai_note||{})})
    setTranscript(current.meeting_transcript||'')
    undoRef.current=[]
    redoRef.current=[]
  },[currentId])

  useEffect(()=>{
    const canvas=canvasRef.current
    if (!canvas) return
    const redraw=()=>drawInk(canvas,inkRef.current,activeStrokeRef.current)
    redraw()
    const observer=new ResizeObserver(redraw)
    observer.observe(canvas)
    return ()=>observer.disconnect()
  },[currentId])

  useEffect(()=>{ drawInk(canvasRef.current,ink,activeStroke) },[ink,activeStroke])

  useEffect(()=>{
    if (!currentId || loading) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current=setTimeout(async()=>{
      if (!supabase) return
      setSaving(true)
      try {
        const patch={
          typed_text:typedText,
          recognized_text:recognizedText,
          ink,
          ai_note:ai,
          language,
          meeting_transcript:transcript,
          updated_at:new Date().toISOString(),
        }
        const { error:saveError }=await supabase.from('ana_notes').update(patch).eq('id',currentId)
        if (saveError) throw saveError
        updateCurrentLocal(patch)
      } catch(err) { setError(err?.message||'Could not save this note.') }
      finally { setSaving(false) }
    },800)
    return ()=>clearTimeout(saveTimerRef.current)
  },[ink,typedText,recognizedText,ai,language,transcript,currentId,loading])

  useEffect(()=>{
    if (!recording || !recordingStarted) return
    const timer=setInterval(()=>setElapsed(Date.now()-recordingStarted),1000)
    return ()=>clearInterval(timer)
  },[recording,recordingStarted])

  useEffect(()=>()=>{ void stopBackgroundRecording(false) },[])

  const createNote=async(type='quick')=>{
    if (!supabase) return
    setError('')
    try {
      const { data:userData }=await supabase.auth.getUser()
      const user=userData?.user
      if (!user) throw new Error('Please sign in again.')
      const title=type==='meeting'?'Meeting note':'New note'
      const row={user_id:user.id,title,note_type:type,typed_text:'',recognized_text:'',ink:[],ai_note:{},language:'English',meeting_transcript:'',metadata:{}}
      const { data,error:createError }=await supabase.from('ana_notes').insert(row).select('*').single()
      if (createError) throw createError
      setNotes(prev=>[data,...prev])
      setCurrentId(data.id)
      setConsent(false)
      setElapsed(0)
    } catch(err) { setError(err?.message||'Could not create a note.') }
  }

  const patchNote=async(patch)=>{
    if (!currentId || !supabase) return
    updateCurrentLocal(patch)
    const { error:updateError }=await supabase.from('ana_notes').update({...patch,updated_at:new Date().toISOString()}).eq('id',currentId)
    if (updateError) throw updateError
  }

  const deleteNote=async()=>{
    if (!current || recording) return
    if (!window.confirm('Delete this Ana note permanently?')) return
    try {
      const { error:deleteError }=await supabase.from('ana_notes').delete().eq('id',current.id)
      if (deleteError) throw deleteError
      const next=notes.filter(note=>note.id!==current.id)
      setNotes(next)
      setCurrentId(next[0]?.id||'')
    } catch(err) { setError(err?.message||'Could not delete this note.') }
  }

  const renameNote=async(value)=>{
    const title=String(value||'').slice(0,160)
    updateCurrentLocal({title})
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current=setTimeout(()=>patchNote({title:title.trim()||'Untitled note'}).catch(err=>setError(err.message)),500)
  }

  const pushHistory=()=>{
    undoRef.current=[...undoRef.current.slice(-29),cloneInk(inkRef.current)]
    redoRef.current=[]
  }
  const undo=()=>{
    const previous=undoRef.current.pop()
    if (!previous) return
    redoRef.current.push(cloneInk(inkRef.current))
    setInk(previous)
  }
  const redo=()=>{
    const next=redoRef.current.pop()
    if (!next) return
    undoRef.current.push(cloneInk(inkRef.current))
    setInk(next)
  }

  const eraseAt=point=>{
    setInk(prev=>{
      const index=prev.findIndex(stroke=>strokeHit(stroke,point,.022))
      if(index<0) return prev
      return prev.filter((_,i)=>i!==index)
    })
  }

  const pointerDown=event=>{
    if (!current || tool==='type') return
    if (penOnly && event.pointerType==='touch') return
    const canvas=canvasRef.current
    if (!canvas) return
    event.preventDefault()
    pointerIdRef.current=event.pointerId
    try { canvas.setPointerCapture(event.pointerId) } catch {}
    const point=pointFromPointer(event,canvas.getBoundingClientRect())
    pushHistory()
    if (tool==='eraser') {
      erasingRef.current=true
      eraseAt(point)
      return
    }
    const stroke={
      id:uuid(),
      color:'#171717',
      width:event.pointerType==='pen'?2.15:2.35,
      at:recordingStartedRef.current?Math.max(0,Date.now()-recordingStartedRef.current):null,
      points:[point],
    }
    setActiveStroke(stroke)
  }
  const pointerMove=event=>{
    if (pointerIdRef.current!==event.pointerId) return
    if (penOnly && event.pointerType==='touch') return
    const canvas=canvasRef.current
    if(!canvas) return
    event.preventDefault()
    const point=pointFromPointer(event,canvas.getBoundingClientRect())
    if (erasingRef.current) { eraseAt(point); return }
    setActiveStroke(stroke=>stroke?{...stroke,points:[...stroke.points,point]}:stroke)
  }
  const pointerUp=event=>{
    if (pointerIdRef.current!==event.pointerId) return
    pointerIdRef.current=null
    erasingRef.current=false
    if (activeStrokeRef.current?.points?.length) setInk(prev=>[...prev,activeStrokeRef.current])
    setActiveStroke(null)
  }

  const tidyInk=()=>{
    if(!ink.length) return
    pushHistory()
    setInk(tidyStrokes(ink))
  }

  const noteImage=()=>blobToWhitePng(canvasRef.current)
  const aiAction=async(action)=>{
    if(!current) return
    setBusy(action); setError('')
    try {
      const imageData=ink.length?await noteImage():''
      const headers=await authenticatedHeaders({'Content-Type':'application/json'})
      const response=await fetch('/api/note-intelligence',{method:'POST',headers,body:JSON.stringify({action,imageData,typedText,recognizedText,targetLanguage:language})})
      const data=await response.json()
      if(!response.ok) throw new Error(data?.error||'Ana could not process this note.')
      if(data?.recognizedText) setRecognizedText(data.recognizedText)
      if(action==='recognize') setAi(prev=>({...prev,outputText:data.recognizedText||''}))
      else setAi(prev=>({...prev,...data,outputText:data.outputText||prev.outputText}))
      if(data?.title && (!current.title || ['New note','Meeting note','Untitled note'].includes(current.title))) await patchNote({title:data.title})
    } catch(err) { setError(err?.message||'Ana could not process this note.') }
    finally { setBusy('') }
  }

  const applyAiToTyped=()=>{
    const value=clean(ai.outputText||ai.summary)
    if(!value) return
    setTypedText(prev=>[clean(prev),value].filter(Boolean).join('\n\n'))
  }

  const exportPng=async()=>{
    const data=await noteImage()
    if(!data) return
    const a=document.createElement('a')
    a.href=data
    a.download=`${clean(current?.title)||'Ana-note'}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }

  const closeQuota=async()=>{
    clearInterval(quotaTimerRef.current); clearTimeout(quotaDeadlineRef.current)
    quotaTimerRef.current=null; quotaDeadlineRef.current=null
    const id=quotaRef.current; quotaRef.current=null
    if(id) try{await endTimedUsage(id)}catch{}
  }
  const startQuota=async()=>{
    const quota=await startTimedUsage('meeting_notes','notes_meeting')
    quotaRef.current=quota.sessionId
    if(!quota.isAdmin){
      quotaDeadlineRef.current=setTimeout(()=>{setError('This week’s meeting-notes allowance has been reached. Ana is ending the recording safely.');void stopBackgroundRecording(true)},Math.max(1000,quota.remainingSeconds*1000))
    }
    quotaTimerRef.current=setInterval(async()=>{
      if(!quotaRef.current||!recordingRef.current) return
      try{
        const state=await heartbeatTimedUsage(quotaRef.current)
        if(state&&!state.allowed){setError('This week’s meeting-notes allowance has been reached.');void stopBackgroundRecording(true)}
      }catch{}
    },15000)
  }

  const stopRecorderSegment=()=>new Promise(resolve=>{
    const recorder=recorderRef.current
    if(!recorder){resolve(null);return}
    const finish=()=>{
      const type=recorder.mimeType||recordingMimeType()||'audio/webm'
      const blob=recorderChunksRef.current.length?new Blob(recorderChunksRef.current,{type}):null
      recorderChunksRef.current=[]
      recorderRef.current=null
      resolve(blob)
    }
    if(recorder.state==='inactive'){finish();return}
    recorder.addEventListener('stop',finish,{once:true})
    try{recorder.requestData()}catch{}
    try{recorder.stop()}catch{finish()}
  })
  const startRecorderSegment=()=>{
    if(!streamRef.current||!recordingRef.current) return
    const tracks=streamRef.current.getAudioTracks?.()||[]
    if(!tracks.length) throw new Error('No microphone audio is available.')
    const mimeType=recordingMimeType()
    const recorder=new MediaRecorder(new MediaStream(tracks),{audioBitsPerSecond:16000,...(mimeType?{mimeType}:{})})
    recorderChunksRef.current=[]
    recorder.addEventListener('dataavailable',event=>{if(event.data?.size) recorderChunksRef.current.push(event.data)})
    recorderRef.current=recorder
    recorder.start(1000)
  }
  const rotateSegment=async()=>{
    if(rotatingRef.current||!recordingRef.current) return
    rotatingRef.current=true
    try{
      const blob=await stopRecorderSegment()
      if(blob?.size) segmentBlobsRef.current.push(blob)
      if(recordingRef.current) startRecorderSegment()
    }finally{rotatingRef.current=false}
  }

  const startMeetingNote=async()=>{
    if(!current||current.note_type!=='meeting') return
    if(!consent){setError('Confirm that all participants agreed to recording, transcription and AI processing first.');return}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Background meeting recording is not supported in this browser.');return}
    setError('');setMeetingStatus('Starting background recording…')
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      streamRef.current=stream
      await startQuota()
      recordingRef.current=true
      setRecording(true)
      const now=Date.now()
      recordingStartedRef.current=now
      setRecordingStarted(now);setElapsed(0);setTranscript('');setAi(emptyAi)
      segmentBlobsRef.current=[]
      startRecorderSegment()
      segmentTimerRef.current=setInterval(()=>{void rotateSegment()},SEGMENT_MS)
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(recordingRef.current) void stopBackgroundRecording(true)},{once:true}))
      await patchNote({meeting_started_at:new Date(now).toISOString(),meeting_transcript:'',ai_note:{}})
      void recordConsentEvent('meeting_recording','confirmed',CONSENT_VERSIONS.meeting,{mode:'ana_notes',keepAudio:false})
      setMeetingStatus('Recording in background — keep writing.')
    }catch(err){
      recordingRef.current=false;setRecording(false)
      streamRef.current?.getTracks?.().forEach(track=>track.stop());streamRef.current=null
      await closeQuota()
      setMeetingStatus('');setError(err?.message||'Could not start Meeting Note.')
    }
  }

  const transcribeBlob=async(blob,index)=>{
    if(!blob?.size||!supabase) return ''
    const { data:userData }=await supabase.auth.getUser()
    const user=userData?.user
    if(!user) throw new Error('Please sign in again.')
    const mimeType=String(blob.type||'audio/webm').split(';')[0]
    const ext=extensionForMime(mimeType)
    const path=`${user.id}/notes-${currentId}-${Date.now()}-${index}.${ext}`
    const { error:uploadError }=await supabase.storage.from(AUDIO_BUCKET).upload(path,blob,{contentType:mimeType,upsert:false})
    if(uploadError) throw uploadError
    try{
      const { data:signed,error:signedError }=await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path,600)
      if(signedError||!signed?.signedUrl) throw new Error(signedError?.message||'Could not prepare meeting audio.')
      const headers=await authenticatedHeaders({'Content-Type':'application/json'})
      const response=await fetch('/api/transcribe',{method:'POST',headers,body:JSON.stringify({audioUrl:signed.signedUrl,mimeType,meeting:true,speakerLabels:true,contextHints:'Ana Meeting Note. Preserve technical terms, names, numbers and multilingual speech faithfully.'})})
      const data=await response.json()
      if(!response.ok) throw new Error(data?.error||'Could not transcribe a meeting segment.')
      return clean(data?.text)
    }finally{
      try{await supabase.storage.from(AUDIO_BUCKET).remove([path])}catch{}
    }
  }

  async function stopBackgroundRecording(process=true){
    if(!recordingRef.current&&!recorderRef.current) return
    recordingRef.current=false
    setRecording(false)
    clearInterval(segmentTimerRef.current);segmentTimerRef.current=null
    setMeetingStatus(process?'Preparing transcript…':'Stopping…')
    try{
      while(rotatingRef.current) await new Promise(resolve=>setTimeout(resolve,50))
      const last=await stopRecorderSegment()
      if(last?.size) segmentBlobsRef.current.push(last)
    }catch{}
    streamRef.current?.getTracks?.().forEach(track=>track.stop());streamRef.current=null
    await closeQuota()
    if(!process){setMeetingStatus('');return}
    try{
      const blobs=[...segmentBlobsRef.current];segmentBlobsRef.current=[]
      if(!blobs.length) throw new Error('No meeting audio was captured.')
      setMeetingStatus(`Transcribing ${blobs.length} recording ${blobs.length===1?'part':'parts'}…`)
      const parts=await runBatched(blobs,3,async(blob,index)=>transcribeBlob(blob,index))
      const full=parts.filter(Boolean).map((text,index)=>`[Part ${index+1}] ${text}`).join('\n\n')
      if(!full) throw new Error('No speech was detected in the meeting recording.')
      setTranscript(full)
      await patchNote({meeting_transcript:full})
      setMeetingStatus('Combining your notes with the meeting…')
      const imageData=inkRef.current.length?await noteImage():''
      let latestRecognized=recognizedText
      if(imageData&&!latestRecognized){
        const headers=await authenticatedHeaders({'Content-Type':'application/json'})
        const recognition=await fetch('/api/note-intelligence',{method:'POST',headers,body:JSON.stringify({action:'recognize',imageData,typedText})})
        const recognitionData=await recognition.json()
        if(recognition.ok&&recognitionData?.recognizedText){latestRecognized=recognitionData.recognizedText;setRecognizedText(latestRecognized)}
      }
      const headers=await authenticatedHeaders({'Content-Type':'application/json'})
      const response=await fetch('/api/note-intelligence',{method:'POST',headers,body:JSON.stringify({action:'meeting_fuse',typedText,recognizedText:latestRecognized,transcript:full})})
      const data=await response.json()
      if(!response.ok) throw new Error(data?.error||'Could not combine the meeting and your notes.')
      const nextAi={...emptyAi,...data}
      setAi(nextAi)
      await patchNote({recognized_text:latestRecognized,meeting_transcript:full,ai_note:nextAi,title:data?.title||current?.title||'Meeting note'})
      setMeetingStatus('Meeting Note ready.')
    }catch(err){setMeetingStatus('');setError(err?.message||'Could not finish this Meeting Note.')}
  }

  if(loading) return <section className="ana-notes-loading"><NotebookPen size={24}/><span>Opening Ana Notes…</span></section>

  return <section className="ana-notes-shell">
    <aside className="ana-notes-sidebar">
      <div className="ana-notes-sidebar-head"><div><small>ANA NOTES</small><strong>Your notebook</strong></div><button onClick={()=>createNote('quick')} title="New note"><Plus size={17}/></button></div>
      <div className="ana-notes-new-row"><button onClick={()=>createNote('quick')}><FileText size={14}/>Quick note</button><button onClick={()=>createNote('meeting')}><Mic size={14}/>Meeting note</button></div>
      <div className="ana-notes-list">
        {notes.map(note=><button key={note.id} className={note.id===currentId?'active':''} onClick={()=>{if(!recording)setCurrentId(note.id)}}>
          <span className="ana-notes-list-icon">{note.note_type==='meeting'?<Mic size={14}/>:<FileText size={14}/>}</span>
          <span><strong>{note.title||'Untitled note'}</strong><small>{note.note_type==='meeting'?'Meeting note':'Quick note'} · {new Date(note.updated_at||note.created_at).toLocaleDateString()}</small></span>
        </button>)}
        {!notes.length&&<div className="ana-notes-empty">Create your first note. Write with a pen, type, or start a Meeting Note.</div>}
      </div>
    </aside>

    <main className="ana-notes-main">
      {!current?<div className="ana-notes-welcome"><NotebookPen size={38}/><h2>Notes that understand what you mean.</h2><p>Use Ana as a normal notebook, or let it listen to a meeting while you write.</p><button onClick={()=>createNote('quick')}><Plus size={16}/>Create a note</button></div>:<>
        <header className="ana-notes-head">
          <div className="ana-notes-title-wrap">
            <input value={current.title||''} onChange={e=>renameNote(e.target.value)} placeholder="Untitled note"/>
            <span>{saving?'Saving…':'Saved'} · {current.note_type==='meeting'?'Meeting Note':'Quick Note'}</span>
          </div>
          <div className="ana-notes-head-actions">
            <button onClick={exportPng}><Download size={15}/>PNG</button>
            <button onClick={deleteNote} disabled={recording}><Trash2 size={15}/></button>
          </div>
        </header>

        {current.note_type==='meeting'&&<section className={`ana-notes-meetingbar ${recording?'recording':''}`}>
          <div className="ana-notes-meeting-copy"><span className="ana-notes-rec-dot"/><div><strong>{recording?`Recording · ${fmtDuration(elapsed)}`:'Meeting Note'}</strong><small>{recording?'Audio is recording in the background. Your pen stays local and instant.':'Write normally while Ana records; after the meeting it combines both.'}</small></div></div>
          {!recording?<div className="ana-notes-meeting-start"><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Everyone has agreed to recording, transcription and AI processing.</span></label><button onClick={startMeetingNote} disabled={!consent}><Mic size={15}/>Start recording</button></div>
          :<button className="ana-notes-stop" onClick={()=>stopBackgroundRecording(true)}><Square size={13}/>End & combine</button>}
          {meetingStatus&&<div className="ana-notes-meeting-status">{meetingStatus}</div>}
        </section>}

        <div className="ana-notes-toolbar">
          <div className="ana-notes-toolgroup">
            <button className={tool==='pen'?'active':''} onClick={()=>setTool('pen')}><PenLine size={15}/>Pen</button>
            <button className={tool==='type'?'active':''} onClick={()=>setTool('type')}><Type size={15}/>Type</button>
            <button className={tool==='eraser'?'active':''} onClick={()=>setTool('eraser')}><Eraser size={15}/>Eraser</button>
          </div>
          <div className="ana-notes-toolgroup">
            <button onClick={undo}><Undo2 size={15}/></button><button onClick={redo}><Redo2 size={15}/></button>
            <button onClick={tidyInk} disabled={!ink.length}><AlignJustify size={15}/>Tidy ink</button>
          </div>
          <label className="ana-notes-penonly"><input type="checkbox" checked={penOnly} onChange={e=>setPenOnly(e.target.checked)}/><span>Pen only</span><small>Ignore finger / palm</small></label>
        </div>

        <div className="ana-notes-workarea">
          <section className="ana-notes-paper">
            <div className="ana-notes-paper-label"><span>{tool==='type'?'Typing mode':'Handwriting canvas'}</span><small>{penOnly?'Palm/finger input ignored':'Touch drawing enabled'}</small></div>
            <div className="ana-notes-canvas-wrap">
              <canvas ref={canvasRef} className={`ana-notes-canvas tool-${tool}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}/>
              {!ink.length&&tool!=='type'&&<div className="ana-notes-canvas-hint"><PenLine size={22}/><span>Write here with your pen.</span></div>}
            </div>
            <textarea className={tool==='type'?'ana-notes-typed active':'ana-notes-typed'} value={typedText} onChange={e=>setTypedText(e.target.value)} placeholder="Type here too — handwritten and typed notes belong to the same page."/>
          </section>

          <aside className="ana-notes-ai">
            <div className="ana-notes-ai-head"><div><Sparkles size={16}/><span><strong>Ana understands this note</strong><small>Your ink remains original. AI changes are suggestions.</small></span></div></div>
            <div className="ana-notes-ai-actions">
              <button onClick={()=>aiAction('recognize')} disabled={!!busy||(!ink.length&&!typedText)}><WandSparkles size={14}/>{busy==='recognize'?'Reading…':'Read handwriting'}</button>
              <button onClick={()=>aiAction('polish')} disabled={!!busy||(!ink.length&&!typedText&&!recognizedText)}><Sparkles size={14}/>{busy==='polish'?'Polishing…':'Polish note'}</button>
              <div className="ana-notes-translate"><select value={language} onChange={e=>setLanguage(e.target.value)}>{LANGUAGES.map(item=><option key={item}>{item}</option>)}</select><button onClick={()=>aiAction('translate')} disabled={!!busy||(!ink.length&&!typedText&&!recognizedText)}><Languages size={14}/>{busy==='translate'?'Translating…':'Translate'}</button></div>
            </div>

            {recognizedText&&<div className="ana-notes-recognized"><label>HANDWRITING ANA READ</label><p>{recognizedText}</p></div>}

            {(ai.outputText||ai.summary||ai.keyPoints?.length||ai.decisions?.length||ai.actions?.length)&&<div className="ana-notes-result">
              <div className="ana-notes-result-head"><strong>{ai.title||'Ana note'}</strong><div><button className={aiStyle==='typed'?'active':''} onClick={()=>setAiStyle('typed')}>Typed</button><button className={aiStyle==='hand'?'active':''} onClick={()=>setAiStyle('hand')}>Handwritten</button></div></div>
              {ai.outputText&&<p className={aiStyle==='hand'?'hand':''}>{ai.outputText}</p>}
              {ai.summary&&<><label>SUMMARY</label><p>{ai.summary}</p></>}
              {!!ai.personalNotes?.length&&<ResultList label="YOUR NOTES" items={ai.personalNotes}/>}
              {!!ai.keyPoints?.length&&<ResultList label="KEY POINTS" items={ai.keyPoints}/>}
              {!!ai.decisions?.length&&<ResultList label="DECISIONS" items={ai.decisions}/>}
              {!!ai.actions?.length&&<div className="ana-notes-result-section"><label>ACTIONS</label>{ai.actions.map((item,index)=><div className="ana-notes-action" key={index}><Check size={13}/><span><b>{item.task}</b>{[item.owner,item.deadline].filter(Boolean).length?<small>{[item.owner,item.deadline].filter(Boolean).join(' · ')}</small>:null}</span></div>)}</div>}
              {!!ai.openQuestions?.length&&<ResultList label="OPEN QUESTIONS" items={ai.openQuestions}/>}
              {(ai.outputText||ai.summary)&&<button className="ana-notes-apply" onClick={applyAiToTyped}>Add to typed note</button>}
            </div>}

            {current.note_type==='meeting'&&transcript&&<details className="ana-notes-transcript"><summary>Meeting transcript</summary><pre>{transcript}</pre></details>}
          </aside>
        </div>
        {error&&<div className="ana-notes-error">{error}<button onClick={()=>setError('')}>×</button></div>}
      </>}
    </main>
  </section>
}

function ResultList({label,items}) {
  return <div className="ana-notes-result-section"><label>{label}</label><ul>{items.map((item,index)=><li key={index}>{typeof item==='string'?item:JSON.stringify(item)}</li>)}</ul></div>
}
