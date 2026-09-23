import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, Clipboard, Download, FileAudio, Headphones, History, Languages, Mic, MonitorUp, Pause, Play, RefreshCw, Sparkles, Square, Trash2, Upload } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'
import { supabase } from './lib/supabase.js'
import './meeting-notes.css'
import './meeting-modes.css'

const TARGETS = ['English', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const STORAGE_KEY = 'ana-meeting-transcript-v2'
const HISTORY_KEY = 'ana-meeting-history-v1'
const MODE_KEY = 'ana-meeting-mode-v1'
const GLOSSARY_KEY = 'ana-glossary-v1'
const AUDIO_BUCKET = 'ana-meeting-audio'
const MAX_FINAL_AUDIO_BYTES = 24 * 1024 * 1024
const MOM_PREFS_KEY = 'ana-mom-template-prefs-v1'

const MEETING_TYPES = ['Customer meeting', 'Project / status', 'Workshop / technical', 'Internal meeting', 'Other']
const MOM_TEMPLATES = [
  { id: 'standard', title: 'Standard Meeting', description: 'A clean general-purpose MOM.', sections: ['Summary', 'Decisions', 'Action Items', 'Open Points', 'Next Steps'] },
  { id: 'customer', title: 'Customer Meeting', description: 'Separates customer and internal commitments.', sections: ['Customer Requirements', 'Discussion', 'Decisions', 'Customer Actions', 'Internal Actions', 'Open Questions'] },
  { id: 'project', title: 'Project / Status Meeting', description: 'Built for recurring project governance.', sections: ['Progress', 'Risks / Issues', 'Decisions', 'Actions', 'Dependencies', 'Upcoming Milestones'] },
  { id: 'technical', title: 'Workshop / Technical', description: 'Keeps technical choices and gaps visible.', sections: ['Topics Discussed', 'Current Situation', 'Proposed Solution', 'Decisions', 'Technical Open Points', 'Actions'] },
  { id: 'custom', title: 'My Template', description: 'Tell Ana exactly how you want the MOM structured.', sections: [] },
]

const MEETING_MODES = [
  { id: 'translate', title: 'Live translate', description: 'Live transcript + translation', icon: Languages },
  { id: 'transcript', title: 'Live transcript', description: 'See the transcript live. No translation.', icon: Mic },
  { id: 'mom', title: 'MOM only', description: 'No live text. Record now, prepare notes at the end.', icon: FileAudio },
]

const LANGUAGE_CODES = {
  German: 'de',
  'Swabian German (Schwäbisch)': 'de',
  'Bavarian German (Bairisch)': 'de',
  'Low German (Plattdeutsch)': 'de',
  English: 'en', Hindi: 'hi', Hinglish: 'hi', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa', Malayalam: 'ml', Kannada: 'kn', Urdu: 'ur', French: 'fr', Spanish: 'es', Italian: 'it',
}

const clean = value => String(value || '').trim()
const codeFor = target => LANGUAGE_CODES[target] || 'en'
const appendText = (base, next) => [clean(base), clean(next)].filter(Boolean).join(' ').replace(/\s+([,.;!?])/g, '$1').trim()

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '')
    return value ?? fallback
  } catch { return fallback }
}
function readMeetingHistory() { const value = readJson(HISTORY_KEY, []); return Array.isArray(value) ? value : [] }
function readSavedMeeting() { const value = readJson(STORAGE_KEY, {}); return value && typeof value === 'object' ? value : {} }
function readMomPrefs() { const value = readJson(MOM_PREFS_KEY, {}); return value && typeof value === 'object' ? value : {} }
function cleanTags(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(input.map(item => clean(item)).filter(Boolean))].slice(0, 12)
}
function initialMode() {
  try { const value = localStorage.getItem(MODE_KEY); return MEETING_MODES.some(item => item.id === value) ? value : 'translate' } catch { return 'translate' }
}
function initialTarget() {
  const saved = readSavedMeeting()
  if (TARGETS.includes(saved.target)) return saved.target
  const memory = getPersonalLanguageMemory?.() || {}
  if (TARGETS.includes(memory.lastMeetingTarget)) return memory.lastMeetingTarget
  if (TARGETS.includes(memory.ownerLanguage)) return memory.ownerLanguage
  return 'English'
}
function formatMeetingDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
function formatTime(ms = 0) {
  const seconds = Math.max(0, Math.floor(ms / 1000)), hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), secs = seconds % 60
  if (hours) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
function formatSegmentTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0)
  return formatTime(safe * 1000)
}
function normalizeSegments(value) {
  return Array.isArray(value) ? value.map((segment, index) => ({
    id: String(segment?.id || `seg-${index + 1}`),
    speaker: clean(segment?.speaker) || 'Speaker',
    start: Number(segment?.start) || 0,
    end: Number(segment?.end) || 0,
    text: clean(segment?.text),
  })).filter(segment => segment.text) : []
}
function transcriptFromSegments(segments, speakerNames = {}) {
  return normalizeSegments(segments).map(segment => {
    const label = clean(speakerNames?.[segment.speaker]) || segment.speaker
    return `[${formatSegmentTime(segment.start)}] ${label}: ${segment.text}`
  }).join('\n')
}
function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported?.(value)) || ''
}
function extensionForMime(mime = '') {
  const value = String(mime).toLowerCase()
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a'
  if (value.includes('ogg')) return 'ogg'
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3'
  if (value.includes('wav')) return 'wav'
  return 'webm'
}
function glossaryHints() {
  const glossary = readJson(GLOSSARY_KEY, [])
  if (!Array.isArray(glossary)) return { keywords: [], context: '' }
  const terms = [], mappings = [], seen = new Set()
  for (const item of glossary.slice(-60)) {
    const source = clean(item?.source), preferred = clean(item?.preferred)
    for (const value of [source, preferred]) {
      const safe = value.replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80), key = safe.toLocaleLowerCase()
      if (safe && !seen.has(key)) { seen.add(key); terms.push(safe) }
    }
    if (source && preferred) mappings.push(`${source} → ${preferred}`)
    if (terms.length >= 40) break
  }
  return { keywords: terms.slice(0, 40), context: mappings.slice(0, 24).join('; ').slice(0, 1200) }
}

function SearchFallback() { return <span className="meeting-search-icon" aria-hidden="true">⌕</span> }

export default function MeetingMode() {
  const saved = readSavedMeeting()
  const [meetingMode, setMeetingMode] = useState(initialMode)
  const [target, setTarget] = useState(initialTarget)
  const [source, setSource] = useState('microphone')
  const [sessionState, setSessionState] = useState('idle')
  const [paused, setPaused] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Number(saved.startedAt) || null)
  const [elapsed, setElapsed] = useState(0)
  const [originalText, setOriginalText] = useState(() => clean(saved.originalText))
  const [translatedText, setTranslatedText] = useState(() => clean(saved.translatedText))
  const [liveOriginal, setLiveOriginal] = useState('')
  const [liveTranslation, setLiveTranslation] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [notesStatus, setNotesStatus] = useState('idle')
  const [meetingNotes, setMeetingNotes] = useState(null)
  const [notesError, setNotesError] = useState('')
  const [meetingHistory, setMeetingHistory] = useState(readMeetingHistory)
  const momPrefs = readMomPrefs()
  const [meetingMeta, setMeetingMeta] = useState(() => ({
    customer: clean(saved?.metadata?.customer),
    topic: clean(saved?.metadata?.topic),
    project: clean(saved?.metadata?.project),
    meetingType: clean(saved?.metadata?.meetingType) || 'Customer meeting',
    attendees: Array.isArray(saved?.metadata?.attendees) ? saved.metadata.attendees.map(clean).filter(Boolean).slice(0, 25) : [],
    tags: cleanTags(saved?.metadata?.tags),
  }))
  const [selectedMomTemplate, setSelectedMomTemplate] = useState(() => saved.momTemplateId || momPrefs.selectedTemplateId || 'standard')
  const [customMomName, setCustomMomName] = useState(() => clean(saved.customMomName || momPrefs.customName) || 'My Template')
  const [customMomInstruction, setCustomMomInstruction] = useState(() => clean(saved.customMomInstruction || momPrefs.customInstruction))
  const [historyQuery, setHistoryQuery] = useState('')
  const [consentVerified, setConsentVerified] = useState(false)
  const [transcriptSegments, setTranscriptSegments] = useState(() => normalizeSegments(saved.transcriptSegments || saved?.notes?._ana?.transcriptSegments))
  const [speakerNames, setSpeakerNames] = useState(() => saved.speakerNames || saved?.notes?._ana?.speakerNames || {})
  const [transcriptDirty, setTranscriptDirty] = useState(false)
  const [importingAudio, setImportingAudio] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calendarState, setCalendarState] = useState({ loading: true, message: '', reconnect: false })
  const [keepAudio, setKeepAudio] = useState(false)
  const [bookmarks, setBookmarks] = useState(() => Array.isArray(saved.bookmarks) ? saved.bookmarks : [])
  const [missedSummary, setMissedSummary] = useState('')
  const [missedLoading, setMissedLoading] = useState(false)

  const peerRef = useRef(null), dataChannelRef = useRef(null), streamRef = useRef(null), recorderRef = useRef(null)
  const recordedChunksRef = useRef([]), recordingMimeRef = useRef(''), activeRef = useRef(false), pausedRef = useRef(false)
  const targetRef = useRef(target), meetingModeRef = useRef(meetingMode), startedAtRef = useRef(Number(saved.startedAt) || 0)
  const originalTextRef = useRef(clean(saved.originalText)), translatedTextRef = useRef(clean(saved.translatedText))
  const originalBufferRef = useRef(''), translatedBufferRef = useRef(''), transcriptionItemsRef = useRef(new Map()), transcriptionOrderRef = useRef([])
  const commitTimerRef = useRef(null), commitWaitsRef = useRef(0), translationPaneRef = useRef(null), hearingPaneRef = useRef(null), audioPlayerRef = useRef(null)

  const active = ['connecting', 'listening', 'recovering', 'paused'].includes(sessionState)
  const processing = ['transcribing', 'preparing'].includes(notesStatus)
  const screenSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
  const activeMomTemplate = MOM_TEMPLATES.find(item => item.id === selectedMomTemplate) || MOM_TEMPLATES[0]
  const momTemplateInstruction = selectedMomTemplate === 'custom'
    ? customMomInstruction
    : activeMomTemplate.sections.join(', ')
  const filteredMeetingHistory = useMemo(() => {
    const query = clean(historyQuery).toLocaleLowerCase()
    if (!query) return meetingHistory
    return meetingHistory.filter(record => {
      const meta = record?.metadata || record?.notes?._ana?.metadata || {}
      const template = record?.momTemplate || record?.notes?._ana?.momTemplate || {}
      return [
        record?.title, record?.target, meta.customer, meta.topic, meta.project, meta.meetingType,
        ...(Array.isArray(meta.attendees) ? meta.attendees : []),
        ...(Array.isArray(meta.tags) ? meta.tags : []), template.title, record?.notes?.summary,
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
    })
  }, [meetingHistory, historyQuery])

  useEffect(() => { meetingModeRef.current = meetingMode; try { localStorage.setItem(MODE_KEY, meetingMode) } catch {} }, [meetingMode])
  useEffect(() => { targetRef.current = target }, [target])
  useEffect(() => { originalTextRef.current = originalText }, [originalText])
  useEffect(() => { translatedTextRef.current = translatedText }, [translatedText])
  useEffect(() => { startedAtRef.current = startedAt || 0 }, [startedAt])
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000)
    setElapsed(Math.max(0, Date.now() - startedAt))
    return () => clearInterval(timer)
  }, [startedAt])
  const calendarSessionToken = async () => {
    if (!supabase) return ''
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || ''
  }

  const loadCalendar = async () => {
    const token = await calendarSessionToken()
    if (!token) { setCalendarState({ loading: false, message: '', reconnect: false }); return }
    setCalendarState(value => ({ ...value, loading: true }))
    try {
      const response = await fetch('/api/auth-notify?action=google-calendar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 14 }),
      })
      const data = await response.json()
      if (!response.ok) {
        setCalendarEvents([])
        setCalendarState({ loading: false, message: data?.error || 'Calendar unavailable.', reconnect: Boolean(data?.reconnect) })
        return
      }
      setCalendarEvents(Array.isArray(data?.events) ? data.events : [])
      setCalendarState({ loading: false, message: '', reconnect: false })
    } catch (error) {
      setCalendarState({ loading: false, message: error?.message || 'Calendar unavailable.', reconnect: false })
    }
  }

  const connectGoogleCalendar = async () => {
    const token = await calendarSessionToken()
    if (!token) { setCalendarState({ loading: false, message: 'Sign in to Ana first.', reconnect: false }); return }
    try {
      const returnTo = `${window.location.origin}/?mode=meeting&calendar=connected`
      const response = await fetch('/api/auth-notify?action=google-start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo }),
      })
      const data = await response.json()
      if (!response.ok || !data?.url) throw new Error(data?.error || 'Could not connect Google.')
      window.location.assign(data.url)
    } catch (error) {
      setCalendarState({ loading: false, message: error?.message || 'Could not connect Google.', reconnect: false })
    }
  }

  const useCalendarEvent = event => {
    const attendees = (Array.isArray(event?.attendees) ? event.attendees : [])
      .map(person => clean(person?.name) || clean(person?.email))
      .filter(Boolean)
      .slice(0, 25)
    setMeetingMeta(value => ({ ...value, topic: clean(event?.title) || value.topic, attendees }))
  }

  useEffect(() => { loadCalendar() }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        target, meetingMode, startedAt, originalText, translatedText, metadata: meetingMeta,
        transcriptSegments, speakerNames, bookmarks,
        momTemplateId: selectedMomTemplate, customMomName, customMomInstruction, updatedAt: Date.now(),
      }))
      localStorage.setItem(MOM_PREFS_KEY, JSON.stringify({ selectedTemplateId: selectedMomTemplate, customName: customMomName, customInstruction: customMomInstruction }))
    } catch {}
  }, [target, meetingMode, startedAt, originalText, translatedText, meetingMeta, transcriptSegments, speakerNames, bookmarks, selectedMomTemplate, customMomName, customMomInstruction])
  useEffect(() => { const node = translationPaneRef.current; if (node) node.scrollTop = node.scrollHeight }, [translatedText, liveTranslation])
  useEffect(() => { const node = hearingPaneRef.current; if (node) node.scrollTop = node.scrollHeight }, [originalText, liveOriginal])
  useEffect(() => () => discardActiveMeeting(), [])

  const setTrackEnabled = enabled => streamRef.current?.getAudioTracks?.().forEach(track => { track.enabled = enabled })
  const sendRealtime = event => { const channel = dataChannelRef.current; if (channel?.readyState === 'open') channel.send(JSON.stringify(event)) }
  const clearCommitTimer = () => { if (commitTimerRef.current) clearTimeout(commitTimerRef.current); commitTimerRef.current = null }

  const commitCurrentTranslationSpeech = (force = false) => {
    clearCommitTimer()
    const original = clean(originalBufferRef.current), translated = clean(translatedBufferRef.current)
    if (!original && !translated) return
    if (!force && original && !translated && commitWaitsRef.current < 3) { commitWaitsRef.current += 1; commitTimerRef.current = setTimeout(() => commitCurrentTranslationSpeech(false), 650); return }
    if (original) { const value = appendText(originalTextRef.current, original); originalTextRef.current = value; setOriginalText(value) }
    if (translated) { const value = appendText(translatedTextRef.current, translated); translatedTextRef.current = value; setTranslatedText(value) }
    originalBufferRef.current = ''; translatedBufferRef.current = ''; commitWaitsRef.current = 0; setLiveOriginal(''); setLiveTranslation('')
  }
  const scheduleTranslationCommit = () => { clearCommitTimer(); commitWaitsRef.current = 0; commitTimerRef.current = setTimeout(() => commitCurrentTranslationSpeech(false), 1500) }
  const refreshLiveTranscription = () => setLiveOriginal(transcriptionOrderRef.current.map(key => transcriptionItemsRef.current.get(key)).filter(Boolean).join(' ').trim())

  const handleTranslationEvent = event => {
    if (pausedRef.current) return
    switch (event.type) {
      case 'session.input_transcript.delta': { const delta = String(event.delta || ''); if (!delta) break; originalBufferRef.current += delta; setLiveOriginal(originalBufferRef.current); scheduleTranslationCommit(); break }
      case 'session.output_transcript.delta': { const delta = String(event.delta || ''); if (!delta) break; translatedBufferRef.current += delta; setLiveTranslation(translatedBufferRef.current); scheduleTranslationCommit(); break }
      case 'session.input_transcript.done': case 'session.output_transcript.done': scheduleTranslationCommit(); break
      case 'session.closed': if (activeRef.current) setError('The live meeting connection ended. End the meeting to keep the recording and prepare notes.'); break
      case 'error': case 'session.error': setError(event.error?.message || 'Live meeting translation was interrupted.'); break
      default: break
    }
  }
  const handleTranscriptionEvent = event => {
    if (pausedRef.current) return
    const type = String(event.type || ''), key = String(event.item_id || event.item?.id || event.response_id || 'active')
    if (type === 'conversation.item.input_audio_transcription.delta') {
      const delta = String(event.delta || ''); if (!delta) return
      if (!transcriptionItemsRef.current.has(key)) transcriptionOrderRef.current.push(key)
      transcriptionItemsRef.current.set(key, String(transcriptionItemsRef.current.get(key) || '') + delta); refreshLiveTranscription(); return
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = clean(event.transcript || transcriptionItemsRef.current.get(key) || '')
      transcriptionItemsRef.current.delete(key); transcriptionOrderRef.current = transcriptionOrderRef.current.filter(item => item !== key)
      if (transcript) { const value = appendText(originalTextRef.current, transcript); originalTextRef.current = value; setOriginalText(value) }
      refreshLiveTranscription(); return
    }
    if (type === 'session.input_transcript.delta') { const delta = String(event.delta || ''); if (!delta) return; originalBufferRef.current += delta; setLiveOriginal(originalBufferRef.current); return }
    if (type === 'session.input_transcript.done') {
      const transcript = clean(event.transcript || originalBufferRef.current)
      if (transcript) { const value = appendText(originalTextRef.current, transcript); originalTextRef.current = value; setOriginalText(value) }
      originalBufferRef.current = ''; setLiveOriginal(''); return
    }
    if (type === 'error' || type === 'session.error') setError(event.error?.message || 'Live transcription was interrupted.')
  }

  const getMeetingStream = async () => {
    if (source === 'screen') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Computer audio sharing is not supported in this browser.')
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }), audioTrack = stream.getAudioTracks?.()[0]
      if (!audioTrack) { stream.getTracks().forEach(track => track.stop()); throw new Error('No computer audio was shared. Choose a tab/window/screen with audio enabled, or use Microphone / speakers.') }
      return stream
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  }
  const startRecorder = stream => {
    if (typeof MediaRecorder === 'undefined') throw new Error('Meeting recording is not supported in this browser.')
    const tracks = stream.getAudioTracks?.() || []; if (!tracks.length) throw new Error('No meeting audio is available to record.')
    const audioStream = new MediaStream(tracks), mimeType = recordingMimeType(), options = { audioBitsPerSecond: 32000, ...(mimeType ? { mimeType } : {}) }, recorder = new MediaRecorder(audioStream, options)
    recordedChunksRef.current = []; recordingMimeRef.current = recorder.mimeType || mimeType || 'audio/webm'
    recorder.addEventListener('dataavailable', event => { if (event.data?.size) recordedChunksRef.current.push(event.data) })
    recorderRef.current = recorder; recorder.start(1000)
  }
  const stopRecorder = () => new Promise(resolve => {
    const recorder = recorderRef.current
    if (!recorder) { resolve(null); return }
    const finish = () => { const type = recordingMimeRef.current || recorder.mimeType || 'audio/webm', blob = recordedChunksRef.current.length ? new Blob(recordedChunksRef.current, { type }) : null; recorderRef.current = null; recordedChunksRef.current = []; resolve(blob) }
    if (recorder.state === 'inactive') { finish(); return }
    recorder.addEventListener('stop', finish, { once: true }); try { recorder.requestData() } catch {}; try { recorder.stop() } catch { finish() }
  })
  const closeRealtime = saveLive => {
    clearCommitTimer(); if (saveLive && meetingModeRef.current === 'translate') commitCurrentTranslationSpeech(true)
    try { dataChannelRef.current?.close() } catch {}; dataChannelRef.current = null
    try { peerRef.current?.close() } catch {}; peerRef.current = null
  }
  const stopTracks = () => { streamRef.current?.getTracks?.().forEach(track => track.stop()); streamRef.current = null }
  function discardActiveMeeting() {
    activeRef.current = false; pausedRef.current = false; clearCommitTimer()
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop() } catch {}; recorderRef.current = null; closeRealtime(false); stopTracks()
  }

  const connectPeer = async ({ stream, token, onEvent }) => {
    const pc = new RTCPeerConnection(); peerRef.current = pc; const audioTrack = stream.getAudioTracks()[0]; pc.addTrack(audioTrack, stream); pc.ontrack = () => {}
    pc.addEventListener('connectionstatechange', () => {
      if (!activeRef.current) return
      if (pc.connectionState === 'connected') setSessionState(pausedRef.current ? 'paused' : 'listening')
      else if (['disconnected', 'connecting'].includes(pc.connectionState)) setSessionState('recovering')
      else if (['failed', 'closed'].includes(pc.connectionState)) setError('The live connection ended. Your local meeting recording is still running.')
    })
    const channel = pc.createDataChannel('oai-events'); dataChannelRef.current = channel
    channel.addEventListener('message', message => { try { onEvent(JSON.parse(message.data)) } catch {} })
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
    const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' } })
    const answerSdp = await response.text(); if (!response.ok) throw new Error(answerSdp || 'Could not connect the live meeting session.')
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    await new Promise((resolve, reject) => {
      if (channel.readyState === 'open') return resolve()
      const timer = setTimeout(() => reject(new Error('Live meeting connection timed out.')), 10000)
      channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true }); channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Live meeting could not connect.')) }, { once: true })
    })
  }
  const startTranslation = async stream => {
    const tokenResponse = await fetch('/api/realtime-translation-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetLanguage: codeFor(targetRef.current) }) }), tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start realtime meeting translation.')
    await connectPeer({ stream, token: tokenData.value, onEvent: handleTranslationEvent })
  }
  const startLiveTranscription = async stream => {
    const hints = glossaryHints(), tokenResponse = await fetch('/api/realtime-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'transcription', languages: ['en', 'de', 'hi'], keywords: hints.keywords, context: hints.context }) }), tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start live transcription.')
    await connectPeer({ stream, token: tokenData.value, onEvent: handleTranscriptionEvent })
  }

  const startMeeting = async () => {
    if (!consentVerified) { setError('Confirm that participants have been informed and you have permission to record/process this meeting.'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Meeting capture is not supported in this browser.'); return }
    setError(''); setNotesError(''); setMeetingNotes(null); setNotesStatus('idle'); setSessionState('connecting'); setPaused(false); pausedRef.current = false; activeRef.current = true
    setBookmarks([]); setMissedSummary('')
    originalBufferRef.current = ''; translatedBufferRef.current = ''; transcriptionItemsRef.current.clear(); transcriptionOrderRef.current = []; setLiveOriginal(''); setLiveTranslation('')
    originalTextRef.current = ''; translatedTextRef.current = ''; setOriginalText(''); setTranslatedText(''); try { localStorage.removeItem(STORAGE_KEY) } catch {}
    try {
      const stream = await getMeetingStream(); streamRef.current = stream
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (activeRef.current) setError('Audio sharing ended. Press End meeting to prepare the transcript and notes from what was recorded.') }, { once: true }))
      startRecorder(stream); const now = Date.now(); startedAtRef.current = now; setStartedAt(now); setElapsed(0)
      if (meetingModeRef.current === 'mom') { setSessionState('listening'); return }
      if (meetingModeRef.current === 'transcript') await startLiveTranscription(stream); else await startTranslation(stream)
      setSessionState('listening')
    } catch (err) {
      setError(err.message || 'Ana could not start the meeting.'); activeRef.current = false; try { await stopRecorder() } catch {}; closeRealtime(false); stopTracks(); setSessionState('idle')
    }
  }

  const buildFinalContext = () => {
    const hints = glossaryHints()
    return ['Business/technical meeting. The speakers may naturally mix English, German, Hindi and Hinglish.', 'SAP terms, transaction codes, material master, inspection plans and project names may occur.', hints.context ? `User glossary: ${hints.context}` : ''].filter(Boolean).join(' ').slice(0, 1800)
  }
  const transcribeRecording = async (blob, retainAudio = false) => {
    if (!blob?.size) throw new Error('No meeting audio was captured.')
    if (blob.size > MAX_FINAL_AUDIO_BYTES) throw new Error('This recording is too large for the final high-quality transcription pass. The live transcript will be kept where available.')
    if (!supabase) throw new Error('Account storage is not available.')
    const { data: userData, error: userError } = await supabase.auth.getUser(); if (userError || !userData?.user) throw new Error('Please sign in again before saving this meeting.')
    const mimeType = String(blob.type || recordingMimeRef.current || 'audio/webm').split(';')[0], ext = extensionForMime(mimeType), id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, path = `${userData.user.id}/${Date.now()}-${id}.${ext}`, uploadBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })
    const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(path, uploadBlob, { contentType: mimeType, upsert: false }); if (uploadError) throw new Error(uploadError.message || 'Could not upload the temporary meeting recording.')
    let keepStoredAudio = false
    try {
      const { data: signed, error: signedError } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600); if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || 'Could not prepare the temporary recording for transcription.')
      const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioUrl: signed.signedUrl, mimeType, meeting: true, speakerLabels: true, contextHints: buildFinalContext() }) }), data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not create the final transcript.')
      const text = clean(data?.text); if (!text) throw new Error('No speech was found in the meeting recording.')
      keepStoredAudio = Boolean(retainAudio)
      return { text, segments: normalizeSegments(data?.segments), diarized: Boolean(data?.diarized), audioPath: keepStoredAudio ? path : '' }
    } finally {
      if (!keepStoredAudio) { try { await supabase.storage.from(AUDIO_BUCKET).remove([path]) } catch {} }
    }
  }

  const persistMeetingRecord = async record => {
    if (!supabase || !record?.id) return
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData?.user
      if (!user) return
      const { error } = await supabase.from('meeting_records').upsert({
        user_id: user.id,
        client_id: String(record.id),
        title: record.title || 'Meeting',
        started_at: record.startedAt ? new Date(record.startedAt).toISOString() : null,
        ended_at: record.endedAt ? new Date(record.endedAt).toISOString() : null,
        duration_ms: Number(record.durationMs) || 0,
        target: record.target || '',
        source: record.source || '',
        notes: record.notes || null,
        original_text: record.originalText || '',
        translated_text: record.translatedText || '',
      }, { onConflict: 'user_id,client_id' })
      if (error) console.warn('[Ana meeting save]', error.message)
    } catch (error) { console.warn('[Ana meeting save]', error?.message || error) }
  }
  const saveMeetingRecord = record => {
    const next = [record, ...readMeetingHistory().filter(item => item?.id !== record.id)].slice(0, 50)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
    setMeetingHistory(next)
    void persistMeetingRecord(record)
  }
  const generateMeetingNotes = async ({ transcript, translation, start, end, mode, recordId = '', segments = transcriptSegments, names = speakerNames, audioPath = '', meetingBookmarks = bookmarks }) => {
    const outputLanguage = targetRef.current
    setNotesStatus('preparing'); setNotesError('')
    const manualMetadata = { ...meetingMeta, tags: cleanTags(meetingMeta.tags) }
    const template = {
      id: activeMomTemplate.id,
      title: selectedMomTemplate === 'custom' ? (clean(customMomName) || 'My Template') : activeMomTemplate.title,
      instruction: clean(momTemplateInstruction),
    }
    const suppliedContext = [
      manualMetadata.customer ? `Customer: ${manualMetadata.customer}` : '',
      manualMetadata.topic ? `Topic: ${manualMetadata.topic}` : '',
      manualMetadata.project ? `Project: ${manualMetadata.project}` : '',
      manualMetadata.meetingType ? `Meeting type: ${manualMetadata.meetingType}` : '',
      manualMetadata.attendees?.length ? `Attendees: ${manualMetadata.attendees.join(', ')}` : '',
      manualMetadata.tags?.length ? `Tags: ${manualMetadata.tags.join(', ')}` : '',
      meetingBookmarks?.length ? `User bookmarks: ${meetingBookmarks.map(item => formatSegmentTime(item.at || 0)).join(', ')}` : '',
    ].filter(Boolean).join('; ')
    const instructions = `ANA_MEETING_NOTES. Create post-meeting notes from this raw transcript. Write in ${outputLanguage}. Return JSON only with title, summary, keyPoints, decisions, actions, openQuestions, labels, sections. actions must be objects with task, owner and deadline. labels must be an object with customer, topic, project, meetingType and tags. Respect user-supplied labels and only infer missing labels when clearly supported; otherwise use empty values. sections must be an array of objects with title, content and items and MUST follow this MOM template: "${template.title}". Required/custom structure: ${template.instruction || 'Use the most useful concise meeting structure.'}. Keep the standard summary/keyPoints/decisions/actions/openQuestions fields populated too so Ana can search and route actions later. Never invent owners, deadlines, facts or decisions; use empty strings when owner or deadline was not stated. Derive the title from the actual meeting topic. User-supplied meeting context: ${suppliedContext || 'none'}. IMPORTANT SIGNAL FILTER: greetings, jokes, filler, repetitions, private chatter, side conversations and off-topic discussion must stay out of MOM sections unless they materially affect a decision, commitment, risk, requirement or important context. Understand natural code-switching between English, German, Hindi and Hinglish.`
    const normalizedSegments = normalizeSegments(segments)
    const evidenceTranscript = normalizedSegments.length ? transcriptFromSegments(normalizedSegments, names) : transcript
    const baseAna = { metadata: manualMetadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath) }
    try {
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: evidenceTranscript, instructions }) }), data = await response.json(); if (!response.ok) throw new Error(data?.error || 'Could not prepare meeting notes.')
      const raw = String(data?.content || '').replace(/```json|```/g, '').trim(), jsonStart = raw.indexOf('{'), jsonEnd = raw.lastIndexOf('}'), parsed = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw)
      const suggested = parsed?.labels && typeof parsed.labels === 'object' ? parsed.labels : {}
      const metadata = {
        customer: manualMetadata.customer || clean(suggested.customer),
        topic: manualMetadata.topic || clean(suggested.topic),
        project: manualMetadata.project || clean(suggested.project),
        meetingType: manualMetadata.meetingType || clean(suggested.meetingType),
        tags: cleanTags([...(manualMetadata.tags || []), ...cleanTags(suggested.tags)]),
      }
      const notes = { ...parsed, _ana: { metadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath) } }
      const record = { id: recordId || `${start || Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: clean(parsed?.title) || metadata.topic || 'Meeting', startedAt: start || end, endedAt: end, durationMs: Math.max(0, end - (start || end)), target: outputLanguage, source: mode, metadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), notes, originalText: transcript, translatedText: translation }
      setMeetingNotes(record); saveMeetingRecord(record); setNotesStatus('ready')
    } catch (err) {
      const notes = { _ana: baseAna }
      const record = { id: recordId || `${start || Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: manualMetadata.topic || `Meeting · ${formatMeetingDate(start || end)}`, startedAt: start || end, endedAt: end, durationMs: Math.max(0, end - (start || end)), target: outputLanguage, source: mode, metadata: manualMetadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), notes, originalText: transcript, translatedText: translation }
      saveMeetingRecord(record); setNotesError(err.message || 'The transcript was saved, but Ana could not create notes.'); setNotesStatus('error')
    }
  }

  const endMeeting = async () => {
    if (!activeRef.current || processing) return
    const mode = meetingModeRef.current, liveOriginalFinal = mode === 'translate' ? appendText(originalTextRef.current, originalBufferRef.current) : appendText(originalTextRef.current, liveOriginal), liveTranslationFinal = appendText(translatedTextRef.current, translatedBufferRef.current), start = startedAtRef.current || Date.now(), end = Date.now()
    activeRef.current = false; pausedRef.current = false; setPaused(false); setSessionState('processing'); setNotesStatus('transcribing')
    let recording = null; try { recording = await stopRecorder() } catch {}; closeRealtime(false); stopTracks()
    let finalTranscript = clean(liveOriginalFinal), finalSegments = [], finalTranscriptError = '', retainedAudioPath = ''
    try {
      if (recording?.size) {
        const result = await transcribeRecording(recording, keepAudio)
        finalTranscript = result.text
        finalSegments = result.segments
        retainedAudioPath = clean(result.audioPath)
      }
    } catch (err) { finalTranscriptError = err.message || 'Final high-quality transcription failed.' }
    setTranscriptSegments(finalSegments); setSpeakerNames({}); setTranscriptDirty(false)
    setOriginalText(finalTranscript); originalTextRef.current = finalTranscript; setTranslatedText(mode === 'translate' ? liveTranslationFinal : ''); translatedTextRef.current = mode === 'translate' ? liveTranslationFinal : ''
    setLiveOriginal(''); setLiveTranslation(''); originalBufferRef.current = ''; translatedBufferRef.current = ''; transcriptionItemsRef.current.clear(); transcriptionOrderRef.current = []; setSessionState('ended')
    if (finalTranscript.length >= 20) { await generateMeetingNotes({ transcript: finalTranscript, translation: mode === 'translate' ? liveTranslationFinal : '', start, end, mode, segments: finalSegments, names: {}, audioPath: retainedAudioPath, meetingBookmarks: bookmarks }); if (finalTranscriptError) setNotesError(`Ana kept the live transcript because the final accuracy pass could not complete: ${finalTranscriptError}`) }
    else { setNotesStatus('error'); setNotesError(finalTranscriptError || 'Not enough speech was captured to create meeting notes.') }
    setConsentVerified(false)
    setKeepAudio(false)
  }

  const togglePause = () => {
    if (!activeRef.current) return
    const next = !pausedRef.current; if (next && meetingModeRef.current === 'translate') commitCurrentTranslationSpeech(true); pausedRef.current = next; setPaused(next); setTrackEnabled(!next); setSessionState(next ? 'paused' : 'listening')
  }
  const changeTarget = value => {
    if (activeRef.current && meetingModeRef.current === 'translate') commitCurrentTranslationSpeech(true)
    targetRef.current = value; setTarget(value); rememberPersonalLanguagePreference?.({ lastMeetingTarget: value })
    if (activeRef.current && meetingModeRef.current === 'translate') sendRealtime({ type: 'session.update', session: { audio: { output: { language: codeFor(value) } } } })
  }
  const changeMode = value => {
    if (active || processing) return
    meetingModeRef.current = value; setMeetingMode(value); setError(''); setNotesError(''); setMeetingNotes(null); setNotesStatus('idle'); originalTextRef.current = ''; translatedTextRef.current = ''; setOriginalText(''); setTranslatedText(''); setLiveOriginal(''); setLiveTranslation(''); setStartedAt(null); startedAtRef.current = 0; setElapsed(0); setSessionState('idle'); try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }
  const clearTranscript = async () => {
    if (active || processing) return
    if (clean(meetingNotes?.notes?._ana?.audioPath || meetingNotes?.audioPath)) await deleteRetainedAudio()
    originalTextRef.current = ''; translatedTextRef.current = ''; startedAtRef.current = 0; setOriginalText(''); setTranslatedText(''); setTranscriptSegments([]); setSpeakerNames({}); setTranscriptDirty(false); setMeetingNotes(null); setNotesStatus('idle'); setNotesError(''); setStartedAt(null); setElapsed(0); setSessionState('idle'); setBookmarks([]); setMissedSummary(''); try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const updateTranscriptSegment = (index, text) => {
    setTranscriptSegments(previous => {
      const next = previous.map((segment, itemIndex) => itemIndex === index ? { ...segment, text } : segment)
      const flat = next.map(item => clean(item.text)).filter(Boolean).join(' ')
      setOriginalText(flat); originalTextRef.current = flat; setTranscriptDirty(true)
      return next
    })
  }

  const renameSpeaker = (speaker, value) => {
    setSpeakerNames(previous => ({ ...previous, [speaker]: value }))
    setTranscriptDirty(true)
  }

  const regenerateFromReviewedTranscript = async () => {
    const transcript = transcriptSegments.length ? transcriptSegments.map(item => clean(item.text)).filter(Boolean).join(' ') : clean(originalText)
    if (transcript.length < 20 || processing) return
    const start = meetingNotes?.startedAt || startedAt || Date.now()
    const end = meetingNotes?.endedAt || Date.now()
    await generateMeetingNotes({ transcript, translation: translatedText, start, end, mode: meetingNotes?.source || meetingMode, recordId: meetingNotes?.id || '', segments: transcriptSegments, names: speakerNames, audioPath: meetingNotes?.notes?._ana?.audioPath || meetingNotes?.audioPath || '', meetingBookmarks: meetingNotes?.notes?._ana?.bookmarks || bookmarks })
    setTranscriptDirty(false)
  }

  const importAudioFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!consentVerified) { setError('Confirm consent before importing meeting audio.'); return }
    if (file.size > MAX_FINAL_AUDIO_BYTES) { setError('This audio file is larger than the supported final transcription size.'); return }
    setImportingAudio(true); setError(''); setNotesError(''); setNotesStatus('transcribing'); setSessionState('processing')
    const end = Date.now()
    try {
      const result = await transcribeRecording(file, keepAudio)
      const segments = result.segments
      const durationMs = segments.length ? Math.max(...segments.map(item => Number(item.end) || 0)) * 1000 : 0
      const start = durationMs ? end - durationMs : end
      setStartedAt(start); startedAtRef.current = start; setElapsed(durationMs)
      setTranscriptSegments(segments); setSpeakerNames({}); setTranscriptDirty(false)
      setOriginalText(result.text); originalTextRef.current = result.text
      setTranslatedText(''); translatedTextRef.current = ''
      setSessionState('ended')
      await generateMeetingNotes({ transcript: result.text, translation: '', start, end, mode: 'import', segments, names: {}, audioPath: result.audioPath || '', meetingBookmarks: bookmarks })
      setConsentVerified(false)
      setKeepAudio(false)
    } catch (err) {
      setSessionState('idle'); setNotesStatus('error'); setNotesError(err?.message || 'Could not import this meeting audio.')
    } finally { setImportingAudio(false) }
  }

  const addBookmark = () => {
    if (!activeRef.current || !startedAtRef.current) return
    const at = Math.max(0, (Date.now() - startedAtRef.current) / 1000)
    setBookmarks(previous => [...previous, { id: `bookmark-${Date.now()}`, at }].slice(-30))
  }

  const whatDidIMiss = async () => {
    if (!activeRef.current || meetingModeRef.current === 'mom' || missedLoading) return
    const recent = appendText(
      originalTextRef.current,
      meetingModeRef.current === 'translate' ? originalBufferRef.current : liveOriginal
    ).slice(-2600)
    if (recent.length < 40) { setMissedSummary('Not enough speech has been captured yet.'); return }
    setMissedLoading(true)
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: recent,
          instructions: `Summarize only the most recent discussion for someone who briefly stepped away. Write in ${targetRef.current}. Maximum 3 short bullets. Focus on decisions, changes, questions and actions; omit greetings and filler. Do not invent anything.`,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not prepare a catch-up.')
      setMissedSummary(clean(data?.content) || 'No meaningful update was detected.')
    } catch (error) {
      setMissedSummary(error?.message || 'Catch-up is temporarily unavailable.')
    } finally { setMissedLoading(false) }
  }

  const playRetainedAudio = async startSeconds => {
    const path = clean(meetingNotes?.notes?._ana?.audioPath || meetingNotes?.audioPath)
    if (!path || !supabase) return
    try {
      const { data, error: signedError } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600)
      if (signedError || !data?.signedUrl) throw new Error(signedError?.message || 'Could not open retained audio.')
      try { audioPlayerRef.current?.pause?.() } catch {}
      const audio = new Audio(data.signedUrl)
      audioPlayerRef.current = audio
      audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, Number(startSeconds) || 0); void audio.play() }, { once: true })
      audio.addEventListener('error', () => setNotesError('Retained audio could not be played.'), { once: true })
    } catch (error) { setNotesError(error?.message || 'Retained audio could not be played.') }
  }

  const deleteRetainedAudio = async () => {
    const record = meetingNotes
    const path = clean(record?.notes?._ana?.audioPath || record?.audioPath)
    if (!path || !supabase) return
    try {
      const { error: removeError } = await supabase.storage.from(AUDIO_BUCKET).remove([path])
      if (removeError) throw removeError
      const notes = record?.notes ? { ...record.notes, _ana: { ...(record.notes._ana || {}), audioPath: '' } } : record?.notes
      const updated = { ...record, audioPath: '', notes }
      setMeetingNotes(updated)
      saveMeetingRecord(updated)
      try { audioPlayerRef.current?.pause?.() } catch {}
      setNotesError('')
    } catch (error) { setNotesError(error?.message || 'Could not delete retained audio.') }
  }

  const fullOriginal = appendText(originalText, liveOriginal), fullTranslation = appendText(translatedText, liveTranslation), copyValue = meetingMode === 'translate' ? clean(fullTranslation || fullOriginal) : clean(fullOriginal)
  const copyTranscript = async () => { if (!copyValue) return; await navigator.clipboard.writeText(copyValue); setCopied(true); setTimeout(() => setCopied(false), 1400) }
  const downloadTranscript = () => {
    if (!fullOriginal && !fullTranslation) return
    const heading = meetingMode === 'translate' ? `Translated to: ${target}` : `Notes language: ${target}`, translationSection = meetingMode === 'translate' ? `\n\nTRANSLATION\n${fullTranslation || '—'}` : '', evidence = transcriptSegments.length ? transcriptFromSegments(transcriptSegments, speakerNames) : (fullOriginal || '—'), text = `Ana Meeting\n${heading}${translationSection}\n\nTRANSCRIPT\n${evidence}\n`, blob = new Blob([text], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `ana-meeting-${new Date(startedAt || Date.now()).toISOString().slice(0, 10)}.txt`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadMomMarkdown = () => {
    const record = meetingNotes
    if (!record?.notes) return
    const notes = record.notes
    const meta = record.metadata || notes?._ana?.metadata || {}
    const lines = [
      `# ${record.title || 'Meeting'}`,
      '',
      record.startedAt ? `**Date:** ${formatMeetingDate(record.startedAt)}` : '',
      meta.customer ? `**Customer:** ${meta.customer}` : '',
      meta.project ? `**Project:** ${meta.project}` : '',
      '',
      notes.summary ? `## Summary\n\n${notes.summary}` : '',
      ...(Array.isArray(notes.sections) ? notes.sections.map(section => `## ${clean(section?.title) || 'Section'}\n\n${clean(section?.content)}${Array.isArray(section?.items) && section.items.length ? `\n\n${section.items.map(item => `- ${String(item)}`).join('\n')}` : ''}`) : []),
      Array.isArray(notes.actions) && notes.actions.length ? `## Actions\n\n${notes.actions.map(item => typeof item === 'string' ? `- ${item}` : `- ${item?.task || ''}${item?.owner ? ` — Owner: ${item.owner}` : ''}${item?.deadline ? ` — Deadline: ${item.deadline}` : ''}`).join('\n')}` : '',
      '',
      '## Evidence transcript',
      '',
      transcriptSegments.length ? transcriptFromSegments(transcriptSegments, speakerNames) : originalText,
    ].filter(value => value !== '').join('\n\n')
    const blob = new Blob([lines], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `ana-mom-${new Date(record.startedAt || Date.now()).toISOString().slice(0, 10)}.md`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const retainedAudioPath = clean(meetingNotes?.notes?._ana?.audioPath || meetingNotes?.audioPath)
  const statusText = sessionState === 'connecting' ? 'Connecting…' : sessionState === 'recovering' ? 'Reconnecting…' : sessionState === 'processing' ? 'Preparing final transcript…' : paused ? 'Paused' : active ? (meetingMode === 'mom' ? 'Ana is recording' : 'Ana is listening now') : sessionState === 'ended' ? 'Meeting ended' : 'Ready'

  return <section className="meeting-wrap meeting-realtime">
    <header className="meeting-head"><div className="eyebrow"><Headphones size={14}/> Meeting</div><h1>Choose what you need from this meeting.</h1><p>Translate live, transcribe live, or keep the screen quiet and let Ana prepare the transcript and MOM when the meeting ends.</p></header>

    <section className="meeting-mode-picker" aria-label="Meeting mode">{MEETING_MODES.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={`meeting-mode-card ${meetingMode === item.id ? 'active' : ''}`} onClick={() => changeMode(item.id)} disabled={active || processing}><span className="meeting-mode-icon"><Icon size={17}/></span><span><strong>{item.title}</strong><small>{item.description}</small></span>{meetingMode === item.id && <Check size={15}/>}</button> })}</section>

    <section className="meeting-setup">
      <div className="meeting-toolbar">
        <label><span>Listen to</span><select value={source} onChange={event => setSource(event.target.value)} disabled={active || processing}><option value="microphone">Microphone / speakers</option>{screenSupported && <option value="screen">Computer / tab audio</option>}</select></label>
        <label><span>{meetingMode === 'translate' ? 'Translate to' : 'MOM language'}</span><select value={target} onChange={event => changeTarget(event.target.value)} disabled={processing}>{TARGETS.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>

      <section className="meeting-calendar">
        <div className="meeting-calendar-head"><div><strong>Upcoming calendar</strong><span>Use an event to prefill the meeting topic and attendees.</span></div><button type="button" onClick={calendarState.reconnect || (!calendarEvents.length && !calendarState.loading) ? connectGoogleCalendar : loadCalendar}>{calendarState.loading ? 'Checking…' : calendarState.reconnect ? 'Reconnect Google' : calendarEvents.length ? 'Refresh' : 'Connect Google'}</button></div>
        {calendarEvents.length > 0 && <div className="meeting-calendar-events">{calendarEvents.slice(0,5).map(event => <button type="button" key={event.id} onClick={() => useCalendarEvent(event)} disabled={active || processing}><strong>{event.title}</strong><span>{event.start ? new Date(event.start).toLocaleString() : ''}</span><small>{event.attendees?.length ? `${event.attendees.length} attendee${event.attendees.length === 1 ? '' : 's'}` : 'No attendee list'}</small></button>)}</div>}
        {calendarState.message && <p>{calendarState.message}</p>}
      </section>

      <div className="meeting-meta-grid">
        <label><span>Customer</span><input value={meetingMeta.customer} onChange={event => setMeetingMeta(value => ({ ...value, customer: event.target.value }))} placeholder="Customer / organisation" disabled={active || processing}/></label>
        <label><span>Topic</span><input value={meetingMeta.topic} onChange={event => setMeetingMeta(value => ({ ...value, topic: event.target.value }))} placeholder="Main meeting topic" disabled={active || processing}/></label>
        <label><span>Project</span><input value={meetingMeta.project} onChange={event => setMeetingMeta(value => ({ ...value, project: event.target.value }))} placeholder="Project (optional)" disabled={active || processing}/></label>
        <label><span>Meeting type</span><select value={meetingMeta.meetingType} onChange={event => setMeetingMeta(value => ({ ...value, meetingType: event.target.value }))} disabled={active || processing}>{MEETING_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="meeting-meta-wide"><span>Attendees</span><input value={meetingMeta.attendees.join(', ')} onChange={event => setMeetingMeta(value => ({ ...value, attendees: event.target.value.split(',').map(clean).filter(Boolean).slice(0,25) }))} placeholder="Names or email addresses"/></label>
        <label className="meeting-meta-wide"><span>Tags</span><input value={meetingMeta.tags.join(', ')} onChange={event => setMeetingMeta(value => ({ ...value, tags: event.target.value.split(',') }))} onBlur={() => setMeetingMeta(value => ({ ...value, tags: cleanTags(value.tags) }))} placeholder="e.g. SAP, MRP, capacity"/></label>
      </div>

      <section className="meeting-template-picker">
        <div className="meeting-template-head"><div><strong>MOM template</strong><span>Choose a starting structure or tell Ana your own.</span></div><span>{activeMomTemplate.title}</span></div>
        <div className="meeting-template-grid">{MOM_TEMPLATES.map(template => <button type="button" key={template.id} className={selectedMomTemplate === template.id ? 'active' : ''} onClick={() => setSelectedMomTemplate(template.id)} disabled={active || processing}><strong>{template.title}</strong><small>{template.description}</small>{template.sections.length ? <em>{template.sections.slice(0, 3).join(' · ')}{template.sections.length > 3 ? ' …' : ''}</em> : null}</button>)}</div>
        {selectedMomTemplate === 'custom' && <div className="meeting-custom-template"><input value={customMomName} onChange={event => setCustomMomName(event.target.value)} placeholder="Template name"/><textarea value={customMomInstruction} onChange={event => setCustomMomInstruction(event.target.value)} placeholder="Example: Business requirement, SAP solution, gaps, decisions and follow-up actions."/></div>}
      </section>

      <label className="meeting-consent"><input type="checkbox" checked={consentVerified} onChange={event => setConsentVerified(event.target.checked)} disabled={active || processing}/><span><strong>Consent verified</strong> I confirm participants have been informed and I have the necessary permission to record/process this meeting.</span></label>
      <label className="meeting-consent meeting-keep-audio"><input type="checkbox" checked={keepAudio} onChange={event => setKeepAudio(event.target.checked)} disabled={active || processing}/><span><strong>Keep audio after transcription</strong> Off by default. If enabled, Ana retains this meeting audio privately so transcript timestamps can replay the original moment.</span></label>
      <div className={`meeting-single-card ${active ? 'active' : ''}`}>
        <div className="meeting-status-row meeting-live-status"><div><i className={active && !paused ? 'on' : ''}/><strong>{statusText}</strong></div><span>{startedAt ? formatTime(elapsed) : '00:00'} · {source === 'screen' ? <><MonitorUp size={13}/> shared audio</> : <><Mic size={13}/> microphone</>}</span></div>

        {meetingMode === 'translate' && <div className="meeting-single-screen">
          <section className="meeting-complete-translation"><div className="meeting-screen-label"><span>Translation · {target}</span>{active && liveOriginal && !liveTranslation ? <em>catching up…</em> : null}</div><div ref={translationPaneRef} className="meeting-screen-scroll meeting-translation-scroll"><p>{fullTranslation || (active ? 'Translation will appear here as soon as Ana understands the speech.' : 'Your translated meeting will appear here.')}</p></div></section>
          <section className="meeting-complete-hearing"><div className="meeting-screen-label"><span>What Ana hears</span>{active && !paused ? <em className="meeting-hearing-live">● live</em> : null}</div><div ref={hearingPaneRef} className="meeting-screen-scroll meeting-hearing-scroll"><p>{fullOriginal || (active ? 'Listening for speech…' : 'Start listening and the source transcript will appear here.')}</p></div></section>
        </div>}
        {meetingMode === 'transcript' && <div className="meeting-transcript-only-screen"><div className="meeting-screen-label"><span>Live transcript</span>{active && !paused ? <em className="meeting-hearing-live">● live</em> : null}</div><div ref={hearingPaneRef} className="meeting-screen-scroll meeting-transcript-only-scroll"><p>{fullOriginal || (active ? 'Listening for speech…' : 'Start listening and the transcript will appear here.')}</p></div></div>}
        {meetingMode === 'mom' && <div className="meeting-mom-only-screen"><FileAudio size={28}/><strong>{active ? 'Recording the meeting' : sessionState === 'ended' ? 'Meeting processed' : 'No live transcript on screen'}</strong><p>{active ? 'Ana is recording the audio. When you end the meeting, Ana will create a high-quality transcript and prepare the MOM.' : 'Start the meeting and keep this screen quiet. The transcript is prepared only after you press End meeting.'}</p></div>}
        {bookmarks.length > 0 && <div className="meeting-bookmarks">{bookmarks.map((item,index)=><span key={item.id || index}><Bookmark size={11}/>{formatSegmentTime(item.at)}</span>)}</div>}
        {(missedLoading || missedSummary) && <div className="meeting-catchup-card"><strong>Catch-up</strong><p>{missedLoading ? 'Ana is summarizing the most recent discussion…' : missedSummary}</p></div>}
        {error && <div className="error meeting-error">{error}</div>}
        <div className="meeting-single-footer">
          <div className="meeting-controls">{!active ? <><button className="meeting-start" onClick={startMeeting} disabled={processing || !consentVerified}><Headphones size={18}/> Start meeting</button><label className="meeting-import-button"><Upload size={16}/>{importingAudio ? 'Importing…' : 'Import audio'}<input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.mp4" onChange={importAudioFile} disabled={processing || importingAudio || !consentVerified}/></label></> : <><button className="meeting-pause" onClick={togglePause}>{paused ? <Play size={17}/> : <Pause size={17}/>} {paused ? 'Resume' : 'Pause'}</button><button className="meeting-bookmark" onClick={addBookmark}><Bookmark size={15}/> Bookmark{bookmarks.length ? ` ${bookmarks.length}` : ''}</button>{meetingMode !== 'mom' && <button className="meeting-catchup" onClick={whatDidIMiss} disabled={missedLoading}>{missedLoading ? 'Catching up…' : 'What did I miss?'}</button>}<button className="meeting-stop" onClick={endMeeting} disabled={processing}><Square size={16}/> End meeting</button></>}</div>
          <div className="meeting-transcript-actions meeting-single-actions"><button onClick={copyTranscript} disabled={!copyValue}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy'}</button><button onClick={downloadTranscript} disabled={!fullOriginal && !fullTranslation}><Download size={15}/> Download</button><button onClick={clearTranscript} disabled={active || processing || (!fullOriginal && !fullTranslation)}><Trash2 size={15}/> Clear</button></div>
        </div>
      </div>
    </section>

    {(notesStatus !== 'idle' || meetingNotes) && <section className="meeting-notes-card">
      <div className="meeting-notes-head"><div><Sparkles size={16}/><h2>After the meeting</h2></div><span>High-quality final pass</span></div>
      {notesStatus === 'transcribing' && <div className="meeting-notes-loading"><i/>Ana is preparing the final transcript from the meeting audio…</div>}
      {notesStatus === 'preparing' && <div className="meeting-notes-loading"><i/>Ana is separating meeting signal from chatter and preparing the MOM…</div>}
      {meetingNotes?.notes && <div className="meeting-notes-body"><h2 className="meeting-notes-title">{meetingNotes.title}</h2><div className="meeting-notes-meta">{formatMeetingDate(meetingNotes.startedAt)} · {formatTime(meetingNotes.durationMs)} · {meetingNotes.target}</div>
        <div className="meeting-label-chips">{[meetingNotes.metadata?.customer, meetingNotes.metadata?.topic, meetingNotes.metadata?.project, meetingNotes.metadata?.meetingType, meetingNotes.momTemplate?.title, ...(meetingNotes.metadata?.tags || [])].filter(Boolean).map((item,index)=><span key={index}>{item}</span>)}</div>
        {!!meetingNotes.notes.sections?.length && <div className="meeting-template-output">{meetingNotes.notes.sections.map((section,index)=><section className="meeting-notes-section" key={index}><h3>{clean(section?.title) || `Section ${index + 1}`}</h3>{clean(section?.content) && <p>{section.content}</p>}{Array.isArray(section?.items) && section.items.length ? <ul>{section.items.map((item,itemIndex)=><li key={itemIndex}>{String(item)}</li>)}</ul> : null}</section>)}</div>}
        {!meetingNotes.notes.sections?.length && meetingNotes.notes.summary && <section className="meeting-notes-section"><h3>Summary</h3><p>{meetingNotes.notes.summary}</p></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.keyPoints?.length && <section className="meeting-notes-section"><h3>Key points</h3><ul>{meetingNotes.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.decisions?.length && <section className="meeting-notes-section"><h3>Decisions</h3><ul>{meetingNotes.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {!!meetingNotes.notes.actions?.length && <section className="meeting-notes-section"><h3>To-do / actions</h3><div className="meeting-action-list">{meetingNotes.notes.actions.map((item,index)=><div className="meeting-action" key={index}><strong>{typeof item === 'string' ? item : item?.task}</strong>{typeof item !== 'string' && (item?.owner || item?.deadline) && <small>{item?.owner ? `Owner: ${item.owner}` : 'Owner: not specified'}{item?.deadline ? ` · Deadline: ${item.deadline}` : ''}</small>}</div>)}</div></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.openQuestions?.length && <section className="meeting-notes-section"><h3>Open questions</h3><ul>{meetingNotes.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {(transcriptSegments.length > 0 || originalText) && <section className="meeting-review-transcript"><div className="meeting-review-head"><div><strong>Review transcript evidence</strong><span>Edit speaker names or transcript text before regenerating the MOM.</span></div><div><button onClick={downloadMomMarkdown}><Download size={14}/> MOM .md</button>{retainedAudioPath && <button onClick={deleteRetainedAudio}><Trash2 size={14}/> Delete audio</button>}<button className={transcriptDirty ? 'primary' : ''} onClick={regenerateFromReviewedTranscript} disabled={!transcriptDirty || processing}><RefreshCw size={14}/> Regenerate MOM</button></div></div>
          {transcriptSegments.length ? <div className="meeting-segment-editor">{[...new Set(transcriptSegments.map(item => item.speaker))].map(speaker => <label className="meeting-speaker-name" key={speaker}><span>{speaker}</span><input value={speakerNames[speaker] || ''} onChange={event => renameSpeaker(speaker, event.target.value)} placeholder={speaker}/></label>)}{transcriptSegments.map((segment,index)=><article className="meeting-segment-row" key={segment.id || index}><div><span>{formatSegmentTime(segment.start)}</span><strong>{speakerNames[segment.speaker] || segment.speaker}</strong>{retainedAudioPath && <button type="button" className="meeting-play-segment" onClick={() => playRetainedAudio(segment.start)}><Play size={11}/> Replay</button>}</div><textarea value={segment.text} onChange={event => updateTranscriptSegment(index, event.target.value)} rows={Math.max(2, Math.min(5, Math.ceil(segment.text.length / 90)))}/></article>)}</div> : <textarea className="meeting-raw-editor" value={originalText} onChange={event => { setOriginalText(event.target.value); originalTextRef.current = event.target.value; setTranscriptDirty(true) }} rows={10}/>}
        </section>}
      </div>}
      {notesError && <div className="meeting-notes-error">{notesError}</div>}
    </section>}

    {!!meetingHistory.length && <section className="meeting-history"><div className="meeting-history-head"><div><History size={16}/><h2>Meeting history</h2></div><span>{filteredMeetingHistory.length} of {meetingHistory.length}</span></div><div className="meeting-history-filter"><SearchFallback/><input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Filter by customer, topic, project, tag or template"/></div><div className="meeting-history-list">{filteredMeetingHistory.map(record => { const meta = record?.metadata || record?.notes?._ana?.metadata || {}; const template = record?.momTemplate || record?.notes?._ana?.momTemplate || {}; return <details className="meeting-history-item" key={record.id}><summary><div className="meeting-history-summary"><strong>{record.title || 'Meeting'}</strong><span>{formatMeetingDate(record.startedAt)} · {formatTime(record.durationMs || 0)}</span><div className="meeting-label-chips compact">{[meta.customer, meta.topic, meta.project, template.title, ...(meta.tags || [])].filter(Boolean).slice(0,5).map((item,index)=><span key={index}>{item}</span>)}</div></div><span>{record.target}</span></summary><div className="meeting-history-detail">
      {record.notes?.summary && <div><h4>Summary</h4><p>{record.notes.summary}</p></div>}{!!record.notes?.keyPoints?.length && <div><h4>Key points</h4><ul>{record.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.decisions?.length && <div><h4>Decisions</h4><ul>{record.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.actions?.length && <div><h4>To-do / actions</h4><ul>{record.notes.actions.map((item,index)=><li key={index}>{typeof item === 'string' ? item : [item?.task, item?.owner ? `Owner: ${item.owner}` : '', item?.deadline ? `Deadline: ${item.deadline}` : ''].filter(Boolean).join(' · ')}</li>)}</ul></div>}{!!record.notes?.openQuestions?.length && <div><h4>Open questions</h4><ul>{record.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}
      <div className="meeting-history-transcripts">{!!record.translatedText && <details><summary>Translated transcript</summary><p>{record.translatedText}</p></details>}<details><summary>Original transcript</summary><p>{record.originalText || '—'}</p></details></div></div></details> })}</div></section>}

    <p className="meeting-footnote">All three modes keep the complete final transcript as evidence. Ana filters greetings, filler and off-topic chatter only when preparing the MOM. Meeting audio is deleted after transcription by default; it is retained only when you explicitly enable Keep audio.</p>
  </section>
}
