import { useEffect, useMemo, useRef, useState } from 'react'
import { meetingAudioParts } from './meetingAudio.js'
import { meetingSegmentsToSrt } from './meetingSrt.js'
import { Bookmark, Check, Clipboard, Download, FileAudio, Headphones, History, Languages, Mic, MonitorUp, Pause, Play, RefreshCw, Sparkles, Square, Trash2, Upload } from 'lucide-react'
import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'
import { supabase } from './lib/supabase.js'
import { authenticatedHeaders, endTimedUsage, heartbeatTimedUsage, refundFixedTimedUsage, reserveFixedTimedUsage, startTimedUsage } from './usageQuota.js'
import { CONSENT_VERSIONS, recordConsentEvent } from './consentEvents.js'
import './meeting-notes.css'
import './meeting-modes.css'
import MeetingScribble from './MeetingScribble.jsx'

const TARGETS = ['English', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']
const STORAGE_KEY = 'ana-meeting-transcript-v2'
const HISTORY_KEY = 'ana-meeting-history-v1'
const MODE_KEY = 'ana-meeting-mode-v1'
const GLOSSARY_KEY = 'ana-glossary-v1'
const AUDIO_BUCKET = 'ana-meeting-audio'
const MAX_FINAL_AUDIO_BYTES = 24 * 1024 * 1024
const MOM_PREFS_KEY = 'ana-mom-template-prefs-v1'
const SCRIBBLE_STORAGE_KEY = 'ana-meeting-scribble-v1'

const MEETING_TYPES = ['Customer meeting', 'Project / status', 'Workshop / technical', 'Internal meeting', 'Other']
const MOM_TEMPLATES = [
  { id: 'standard', title: 'Standard Meeting', description: 'A clean general-purpose MOM.', sections: ['Summary', 'Decisions', 'Action Items', 'Open Points', 'Next Steps'] },
  { id: 'customer', title: 'Customer Meeting', description: 'Separates customer and internal commitments.', sections: ['Customer Requirements', 'Discussion', 'Decisions', 'Customer Actions', 'Internal Actions', 'Open Questions'] },
  { id: 'project', title: 'Project / Status Meeting', description: 'Built for recurring project governance.', sections: ['Progress', 'Risks / Issues', 'Decisions', 'Actions', 'Dependencies', 'Upcoming Milestones'] },
  { id: 'technical', title: 'Workshop / Technical', description: 'Keeps technical choices and gaps visible.', sections: ['Topics Discussed', 'Current Situation', 'Proposed Solution', 'Decisions', 'Technical Open Points', 'Actions'] },
  { id: 'custom', title: 'My Template', description: 'Tell Ana exactly how you want the MOM structured.', sections: [] },
]

const MEETING_MODES = [
  { id: 'translate', title: 'Live translate', description: 'Live translation · shares the 1h/week live allowance', icon: Languages },
  { id: 'transcript', title: 'Live transcript', description: 'See the transcript live · 1h/week', icon: Mic },
  { id: 'mom', title: 'Meeting notes', description: 'Quiet recording + transcript + MOM · 3h/week', icon: FileAudio },
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
function readMeetingScribble() { const value = readJson(SCRIBBLE_STORAGE_KEY, {}); return value && typeof value === 'object' ? value : {} }
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
async function audioFileDurationSeconds(file) {
  if (!file || typeof Audio === 'undefined' || typeof URL === 'undefined') return 0
  const url = URL.createObjectURL(file)
  try {
    return await new Promise(resolve => {
      const audio = new Audio()
      const finish = value => {
        audio.removeAttribute('src')
        try { audio.load() } catch {}
        resolve(Number.isFinite(value) && value > 0 ? value : 0)
      }
      const timer = setTimeout(() => finish(0), 8000)
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        clearTimeout(timer)
        finish(Number(audio.duration) || 0)
      }
      audio.onerror = () => {
        clearTimeout(timer)
        finish(0)
      }
      audio.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
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
  const [meetingGlossary, setMeetingGlossary] = useState(() => { const items = readJson(GLOSSARY_KEY, []); return Array.isArray(items) ? items : [] })
  const [termHeard, setTermHeard] = useState('')
  const [termPreferred, setTermPreferred] = useState('')
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
  const [audioPlayback, setAudioPlayback] = useState({ status: 'idle', at: 0, duration: 0 })
  const [highlightedSegment, setHighlightedSegment] = useState('')
  const [importingAudio, setImportingAudio] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calendarState, setCalendarState] = useState({ loading: true, message: '', reconnect: false })
  const [keepAudio, setKeepAudio] = useState(false)
  const [bookmarks, setBookmarks] = useState(() => Array.isArray(saved.bookmarks) ? saved.bookmarks : [])
  const [missedSummary, setMissedSummary] = useState('')
  const [missedLoading, setMissedLoading] = useState(false)
  const [preMeetingBrief, setPreMeetingBrief] = useState(null)
  const [preMeetingLoading, setPreMeetingLoading] = useState(false)

  const peerRef = useRef(null), dataChannelRef = useRef(null), streamRef = useRef(null), recorderRef = useRef(null)
  const recordedChunksRef = useRef([]), recordingMimeRef = useRef(''), activeRef = useRef(false), pausedRef = useRef(false)
  const quotaSessionRef = useRef(null), quotaTimerRef = useRef(null), quotaDeadlineRef = useRef(null), quotaExpiredRef = useRef(false)
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
  useEffect(() => { setPreMeetingBrief(null) }, [meetingMeta.customer, meetingMeta.project, meetingMeta.topic])
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
    setPreMeetingBrief(null)
  }

  const prepareMeetingBrief = async () => {
    if (preMeetingLoading) return
    setPreMeetingLoading(true)
    try {
      const project = clean(meetingMeta.project).toLocaleLowerCase()
      const customer = clean(meetingMeta.customer).toLocaleLowerCase()
      const topic = clean(meetingMeta.topic).toLocaleLowerCase()
      const words = topic.split(/\s+/).filter(word => word.length >= 4)
      const matches = meetingHistory
        .filter(record => {
          const meta = record?.metadata || record?.notes?._ana?.metadata || {}
          if (project) return clean(meta.project).toLocaleLowerCase() === project
          if (customer) return clean(meta.customer).toLocaleLowerCase() === customer
          if (!words.length) return false
          const haystack = [record?.title, meta.topic, record?.notes?.summary].map(clean).join(' ').toLocaleLowerCase()
          return words.some(word => haystack.includes(word))
        })
        .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
        .slice(0, 5)

      const meetingIds = matches.map(record => String(record.id || '')).filter(Boolean)
      let openActions = []
      if (supabase && meetingIds.length) {
        try {
          const { data: userData } = await supabase.auth.getUser()
          const user = userData?.user
          if (user) {
            const { data } = await supabase
              .from('meeting_actions')
              .select('meeting_client_id,task,owner,deadline,status')
              .eq('user_id', user.id)
              .eq('status', 'open')
              .in('meeting_client_id', meetingIds)
              .limit(40)
            openActions = Array.isArray(data) ? data : []
          }
        } catch {}
      }

      const decisions = matches.flatMap(record => Array.isArray(record?.notes?.decisions) ? record.notes.decisions : []).map(clean).filter(Boolean).slice(0, 8)
      const risks = matches.flatMap(record => Array.isArray(record?.notes?.risks) ? record.notes.risks : []).map(clean).filter(Boolean).slice(0, 8)
      const questions = matches.flatMap(record => Array.isArray(record?.notes?.openQuestions) ? record.notes.openQuestions : []).map(clean).filter(Boolean).slice(0, 8)
      setPreMeetingBrief({
        meetings: matches,
        decisions,
        risks,
        questions,
        openActions,
      })
    } finally {
      setPreMeetingLoading(false)
    }
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

  const saveMeetingTerm = () => {
    const source = clean(termHeard).slice(0, 80), preferred = clean(termPreferred).slice(0, 80)
    if (!source || !preferred || source === preferred) return
    const next = [...meetingGlossary.filter(item => clean(item?.source).toLocaleLowerCase() !== source.toLocaleLowerCase()), { source, preferred }].slice(-60)
    try { localStorage.setItem(GLOSSARY_KEY, JSON.stringify(next)) } catch { setError('Could not save the terminology on this device.'); return }
    setMeetingGlossary(next); setTermHeard(''); setTermPreferred('')
  }
  const removeMeetingTerm = source => {
    const next = meetingGlossary.filter(item => item?.source !== source)
    try { localStorage.setItem(GLOSSARY_KEY, JSON.stringify(next)) } catch { setError('Could not update the terminology on this device.'); return }
    setMeetingGlossary(next)
  }
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
  const stopQuotaClock = () => {
    if (quotaTimerRef.current) clearInterval(quotaTimerRef.current)
    if (quotaDeadlineRef.current) clearTimeout(quotaDeadlineRef.current)
    quotaTimerRef.current = null
    quotaDeadlineRef.current = null
  }
  const closeQuotaSession = async () => {
    stopQuotaClock()
    const id = quotaSessionRef.current
    quotaSessionRef.current = null
    if (!id) return
    try { await endTimedUsage(id) } catch {}
  }
  const startQuotaSession = async (kind, feature = '') => {
    await closeQuotaSession()
    quotaExpiredRef.current = false
    const quota = await startTimedUsage(kind, feature)
    quotaSessionRef.current = quota.sessionId

    const expire = () => {
      if (quotaExpiredRef.current || !activeRef.current) return
      quotaExpiredRef.current = true
      setError('This week’s tester allowance for this meeting mode has been used. Ana is ending the meeting safely now.')
      stopQuotaClock()
      void endMeeting()
    }

    if (!quota.isAdmin && Number.isFinite(quota.remainingSeconds)) {
      quotaDeadlineRef.current = setTimeout(expire, Math.max(1000, quota.remainingSeconds * 1000))
    }

    quotaTimerRef.current = setInterval(async () => {
      const id = quotaSessionRef.current
      if (!id || quotaExpiredRef.current || !activeRef.current) return
      try {
        const state = await heartbeatTimedUsage(id)
        if (state && !state.allowed) expire()
      } catch {
        // The hard deadline still protects the allowance if a heartbeat is briefly unavailable.
      }
    }, 15000)

    return quota
  }
  function discardActiveMeeting() {
    activeRef.current = false; pausedRef.current = false; clearCommitTimer()
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop() } catch {}; recorderRef.current = null; closeRealtime(false); stopTracks(); void closeQuotaSession()
  }

  const connectPeer = async ({ stream, token, onEvent, callsUrl = 'https://api.openai.com/v1/realtime/calls' }) => {
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
    const response = await fetch(callsUrl, { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' } })
    const answerSdp = await response.text()
    if (!response.ok) {
      let message = answerSdp
      try { message = JSON.parse(answerSdp)?.error?.message || answerSdp } catch {}
      throw new Error(message || 'Could not connect the live meeting session.')
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    await new Promise((resolve, reject) => {
      if (channel.readyState === 'open') return resolve()
      const timer = setTimeout(() => reject(new Error('Live meeting connection timed out.')), 10000)
      channel.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true }); channel.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Live meeting could not connect.')) }, { once: true })
    })
  }
  const startTranslation = async stream => {
    const headers = await authenticatedHeaders({ 'Content-Type': 'application/json' })
    const tokenResponse = await fetch('/api/realtime-translation-token', { method: 'POST', headers, body: JSON.stringify({ targetLanguage: codeFor(targetRef.current), quotaSessionId: quotaSessionRef.current }) }), tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start realtime meeting translation.')
    await connectPeer({ stream, token: tokenData.value, onEvent: handleTranslationEvent, callsUrl: 'https://api.openai.com/v1/realtime/translations/calls' })
  }
  const startLiveTranscription = async stream => {
    const hints = glossaryHints(), headers = await authenticatedHeaders({ 'Content-Type': 'application/json' })
    const tokenResponse = await fetch('/api/realtime-token', { method: 'POST', headers, body: JSON.stringify({ mode: 'transcription', languages: ['en', 'de', 'hi'], keywords: hints.keywords, context: hints.context, quotaSessionId: quotaSessionRef.current }) }), tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start live transcription.')
    await connectPeer({ stream, token: tokenData.value, onEvent: handleTranscriptionEvent })
  }

  const startMeeting = async () => {
    if (!consentVerified) { setError('Confirm that all participants have agreed to the meeting being recorded, transcribed and processed by Ana.'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Meeting capture is not supported in this browser.'); return }
    setError(''); setNotesError(''); setMeetingNotes(null); setNotesStatus('idle'); setSessionState('connecting'); setPaused(false); pausedRef.current = false; activeRef.current = true
    setBookmarks([]); setMissedSummary('')
    originalBufferRef.current = ''; translatedBufferRef.current = ''; transcriptionItemsRef.current.clear(); transcriptionOrderRef.current = []; setLiveOriginal(''); setLiveTranslation('')
    originalTextRef.current = ''; translatedTextRef.current = ''; setOriginalText(''); setTranslatedText(''); try { localStorage.removeItem(STORAGE_KEY) } catch {}
    try {
      const stream = await getMeetingStream(); streamRef.current = stream
      await startQuotaSession(
        meetingModeRef.current === 'mom' ? 'meeting_notes' : 'meeting_live',
        meetingModeRef.current === 'mom' ? 'meeting_notes' : meetingModeRef.current === 'transcript' ? 'live_transcript' : 'live_translate'
      )
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (activeRef.current) setError('Audio sharing ended. Press End meeting to prepare the transcript and notes from what was recorded.') }, { once: true }))
      startRecorder(stream); const now = Date.now(); startedAtRef.current = now; setStartedAt(now); setElapsed(0)
      try { window.dispatchEvent(new CustomEvent('ana:meeting-started', { detail: { startedAt: now } })) } catch {}
      void recordConsentEvent('meeting_recording', 'confirmed', CONSENT_VERSIONS.meeting, { mode: meetingModeRef.current, keepAudio: Boolean(keepAudio) })
      if (keepAudio) void recordConsentEvent('meeting_audio_retention', 'confirmed', CONSENT_VERSIONS.audioRetention, { mode: meetingModeRef.current })
      if (meetingModeRef.current === 'mom') { setSessionState('listening'); return }
      if (meetingModeRef.current === 'transcript') await startLiveTranscription(stream); else await startTranslation(stream)
      setSessionState('listening')
    } catch (err) {
      setError(err.message || 'Ana could not start the meeting.'); activeRef.current = false; try { await stopRecorder() } catch {}; closeRealtime(false); stopTracks(); await closeQuotaSession(); setSessionState('idle')
    }
  }

  const buildFinalContext = () => {
    const hints = glossaryHints()
    return ['Business/technical meeting. The speakers may naturally mix English, German, Hindi and Hinglish.', 'SAP terms, transaction codes, material master, inspection plans and project names may occur.', hints.context ? `User glossary: ${hints.context}` : ''].filter(Boolean).join(' ').slice(0, 1800)
  }
  const meetingAudioPaths = path => {
    const manifest = /^(.*)\.parts-(\d+)$/.exec(path)
    return manifest ? Array.from({ length: Number(manifest[2]) }, (_, index) => `${manifest[1]}.part-${index}`) : [path]
  }

  const uploadMeetingAudio = async blob => {
    if (!supabase) throw new Error('Account storage is not available.')
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) throw new Error('Please sign in again before saving this meeting.')
    const mime = String(blob.type || recordingMimeRef.current || 'audio/webm').split(';')[0]
    const mimeType = mime === 'audio/m4a' ? 'audio/x-m4a' : mime
    const id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
    const basePath = `${data.user.id}/${Date.now()}-${id}.${extensionForMime(mimeType)}`
    const count = Math.ceil(blob.size / MAX_FINAL_AUDIO_BYTES)
    const path = count > 1 ? `${basePath}.parts-${count}` : basePath
    const paths = meetingAudioPaths(path)
    const uploaded = []
    try {
      for (const [index, objectPath] of paths.entries()) {
        const start = index * MAX_FINAL_AUDIO_BYTES
        const part = blob.slice(start, start + MAX_FINAL_AUDIO_BYTES, mimeType)
        const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(objectPath, part, { contentType: mimeType, upsert: false })
        if (uploadError) throw new Error(uploadError.message || 'Could not upload meeting audio.')
        uploaded.push(objectPath)
      }
    } catch (error) {
      if (uploaded.length) await supabase.storage.from(AUDIO_BUCKET).remove(uploaded).catch(() => {})
      throw error
    }
    return path
  }

  const downloadMeetingAudio = async path => {
    const parts = []
    for (const objectPath of meetingAudioPaths(path)) {
      const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(objectPath)
      if (error || !data?.size) throw new Error(error?.message || 'Could not open saved audio.')
      parts.push(data)
    }
    return parts.length === 1 ? parts[0] : new Blob(parts, { type: parts[0].type })
  }

  const transcribeRecording = async (blob, storedPath = '') => {
    if (!blob?.size) throw new Error('No meeting audio was captured.')
    const transcripts = [], segments = []
    const split = blob.size > MAX_FINAL_AUDIO_BYTES
    for await (const { audio, offset } of meetingAudioParts(blob, MAX_FINAL_AUDIO_BYTES)) {
      const existingPath = !split && storedPath
      const path = existingPath || await uploadMeetingAudio(audio)
      try {
        const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600)
        if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not prepare the recording for transcription.')
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: await authenticatedHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ audioUrl: data.signedUrl, mimeType: audio.type.split(';')[0], meeting: true, speakerLabels: true, allowSilence: split, contextHints: buildFinalContext() }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result?.error || 'Could not create the final transcript.')
        const text = clean(result?.text)
        if (!text) continue
        transcripts.push(text)
        const partSegments = normalizeSegments(result.segments)
        if (!split) segments.push(...partSegments)
        else {
          const part = Math.floor(offset / 300) + 1
          segments.push(...(partSegments.length ? partSegments : [{ id: 'transcript', start: 0, end: 0, speaker: 'Speaker', text }]).map(segment => ({
            ...segment,
            id: `part-${part}-${segment.id}`,
            speaker: `${segment.speaker} (part ${part})`,
            start: segment.start + offset,
            end: segment.end + offset,
          })))
        }
      } finally {
        if (!existingPath) {
          try { await supabase.storage.from(AUDIO_BUCKET).remove([path]) } catch {}
        }
      }
    }
    if (!transcripts.length) throw new Error('No speech was found in the meeting recording.')
    return { text: transcripts.join('\n\n'), segments }
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
      if (error) throw error
      return true
    } catch (error) { console.warn('[Ana meeting save]', error?.message || error) }
  }
  const saveMeetingRecord = record => {
    const next = [record, ...readMeetingHistory().filter(item => item?.id !== record.id)].slice(0, 50)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
    setMeetingHistory(next)
    return persistMeetingRecord(record)
  }
  const generateMeetingNotes = async ({
    transcript,
    translation,
    start,
    end,
    mode,
    recordId = '',
    segments = transcriptSegments,
    names = speakerNames,
    audioPath = '',
    meetingBookmarks = bookmarks,
    metadataOverride = null,
    templateOverride = null,
    outputLanguageOverride = '',
    transcriptionError = '',
  }) => {
    const outputLanguage = clean(outputLanguageOverride) || targetRef.current
    setNotesStatus('preparing'); setNotesError('')

    const sourceMetadata = metadataOverride && typeof metadataOverride === 'object' ? metadataOverride : meetingMeta
    const manualMetadata = {
      ...sourceMetadata,
      attendees: Array.isArray(sourceMetadata?.attendees) ? sourceMetadata.attendees : [],
      tags: cleanTags(sourceMetadata?.tags),
    }
    const currentTemplate = {
      id: activeMomTemplate.id,
      title: selectedMomTemplate === 'custom' ? (clean(customMomName) || 'My Template') : activeMomTemplate.title,
      instruction: clean(momTemplateInstruction),
    }
    const template = templateOverride && typeof templateOverride === 'object'
      ? {
          id: clean(templateOverride.id) || currentTemplate.id,
          title: clean(templateOverride.title) || currentTemplate.title,
          instruction: clean(templateOverride.instruction),
        }
      : currentTemplate

    const scribbleNotes = clean(readMeetingScribble()?.text)
    const suppliedContext = [
      manualMetadata.customer ? `Customer: ${manualMetadata.customer}` : '',
      manualMetadata.topic ? `Topic: ${manualMetadata.topic}` : '',
      manualMetadata.project ? `Project: ${manualMetadata.project}` : '',
      manualMetadata.meetingType ? `Meeting type: ${manualMetadata.meetingType}` : '',
      manualMetadata.attendees?.length ? `Attendees: ${manualMetadata.attendees.join(', ')}` : '',
      manualMetadata.tags?.length ? `Tags: ${manualMetadata.tags.join(', ')}` : '',
      meetingBookmarks?.length ? `User bookmarks: ${meetingBookmarks.map(item => formatSegmentTime(item.at || 0)).join(', ')}` : '',
      scribbleNotes ? `User's own meeting notes: ${scribbleNotes}` : '',
    ].filter(Boolean).join('; ')

    const evidenceIds = normalizeSegments(segments).map(item => item.id)
    const evidenceInstruction = evidenceIds.length ? 'Also return evidenceLinks: an object with decisions, actions, openQuestions arrays, each aligned by index to its corresponding output array. Each entry must be an exact segment ID from the supplied [SEGMENT_ID=...] transcript or empty string if no reliable match. Never guess evidence IDs. For long meetings with condensed transcript, use empty strings unless exact segment IDs survive the condensation.' : 'Do not invent evidence references.'
    const instructions = `ANA_MEETING_NOTES. Create post-meeting notes from the supplied meeting evidence. Write in ${outputLanguage}. Return JSON only with title, summary, keyPoints, decisions, actions, openQuestions, labels, sections. actions must be objects with task, owner and deadline. labels must be an object with customer, topic, project, meetingType and tags. Respect user-supplied labels and only infer missing labels when clearly supported; otherwise use empty values. sections must be an array of objects with title, content and items and MUST follow this MOM template: "${template.title}". Required/custom structure: ${template.instruction || 'Use the most useful concise meeting structure.'}. Keep the standard summary/keyPoints/decisions/actions/openQuestions fields populated too so Ana can search and route actions later. Never invent owners, deadlines, facts or decisions; use empty strings when owner or deadline was not stated. Derive the title from the actual meeting topic. User-supplied meeting context: ${suppliedContext || 'none'}. IMPORTANT SIGNAL FILTER: greetings, jokes, filler, repetitions, private chatter, side conversations and off-topic discussion must stay out of MOM sections unless they materially affect a decision, commitment, risk, requirement or important context. Understand natural code-switching between English, German, Hindi and Hinglish. ${evidenceInstruction}`

    const normalizedSegments = normalizeSegments(segments)
    const evidenceTranscript = clean(normalizedSegments.length ? normalizedSegments.map(item => `[SEGMENT_ID=${item.id}] [${formatSegmentTime(item.start)}] ${clean(names?.[item.speaker]) || item.speaker}: ${item.text}`).join('\n') : transcript)
    const baseAna = { metadata: manualMetadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), transcriptionStatus: transcriptionError ? 'failed' : 'complete', transcriptionError, manualNotes: scribbleNotes }

    const requestMeetingAi = async (text, aiInstructions) => {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, instructions: aiInstructions }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not prepare meeting notes.')
      const content = clean(data?.content)
      if (!content) throw new Error('Ana returned an empty meeting analysis.')
      return content
    }

    const splitEvidence = (value, maxChars = 12000) => {
      const source = clean(value)
      if (!source || source.length <= maxChars) return source ? [source] : []
      const parts = []
      let offset = 0
      while (offset < source.length) {
        let endOffset = Math.min(source.length, offset + maxChars)
        if (endOffset < source.length) {
          const window = source.slice(offset, endOffset)
          const minimumBreak = Math.floor(maxChars * 0.62)
          const candidates = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. ')]
          const breakAt = Math.max(...candidates)
          if (breakAt >= minimumBreak) endOffset = offset + breakAt + 1
        }
        if (endOffset <= offset) endOffset = Math.min(source.length, offset + maxChars)
        const part = source.slice(offset, endOffset).trim()
        if (part) parts.push(part)
        offset = endOffset
      }
      return parts
    }

    try {
      if (!evidenceTranscript) throw new Error('No transcript is available for meeting notes.')

      let noteEvidence = evidenceTranscript
      const chunks = splitEvidence(evidenceTranscript)
      if (chunks.length > 1) {
        const digests = []
        for (let index = 0; index < chunks.length; index += 1) {
          const digestInstructions = `ANA_MEETING_ENRICHMENT. This is transcript part ${index + 1} of ${chunks.length}. Condense ONLY this part into faithful evidence for a later final MOM. Return concise plain text, not JSON. Preserve every material decision, requirement, commitment, action item, stated owner, deadline, risk, issue, dependency, open question, disagreement, uncertainty, technical value, identifier, date, number, named person and organisation that could matter later. Keep chronological meaning. Remove greetings, repetition, filler and unrelated chatter. Never invent, resolve ambiguity, or merge distinct facts. Meeting context: ${suppliedContext || 'none'}.`
          const digest = await requestMeetingAi(chunks[index], digestInstructions)
          digests.push(`PART ${index + 1}/${chunks.length}\n${digest}`)
        }
        noteEvidence = `These are faithful condensed evidence notes from consecutive parts of one meeting transcript. Treat them as evidence in chronological order and do not invent omitted details.\n\n${digests.join('\n\n')}`
      }

      const rawContent = await requestMeetingAi(noteEvidence, instructions)
      const raw = String(rawContent || '').replace(/```json|```/g, '').trim()
      const jsonStart = raw.indexOf('{'), jsonEnd = raw.lastIndexOf('}')
      const parsed = JSON.parse(jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw)
      const suggested = parsed?.labels && typeof parsed.labels === 'object' ? parsed.labels : {}
      const metadata = {
        customer: manualMetadata.customer || clean(suggested.customer),
        topic: manualMetadata.topic || clean(suggested.topic),
        project: manualMetadata.project || clean(suggested.project),
        meetingType: manualMetadata.meetingType || clean(suggested.meetingType),
        tags: cleanTags([...(manualMetadata.tags || []), ...cleanTags(suggested.tags)]),
      }
      const validIds = new Set(normalizedSegments.map(item => item.id))
      const evidenceLinks = Object.fromEntries(['decisions', 'actions', 'openQuestions'].map(kind => {
        const entries = Array.isArray(parsed?.[kind]) ? parsed[kind] : []
        const candidates = Array.isArray(parsed?.evidenceLinks?.[kind]) ? parsed.evidenceLinks[kind] : []
        return [kind, entries.map((_, index) => { const id = String(candidates[index] || ''); return validIds.has(id) ? id : '' })]
      }))
      const notes = { ...parsed, _ana: { metadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), transcriptionStatus: transcriptionError ? 'failed' : 'complete', transcriptionError, manualNotes: scribbleNotes, evidenceLinks } }
      const record = { id: recordId || `${start || Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: clean(parsed?.title) || metadata.topic || 'Meeting', startedAt: start || end, endedAt: end, durationMs: Math.max(0, end - (start || end)), target: outputLanguage, source: mode, metadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), notes, originalText: transcript, translatedText: translation }
      setMeetingNotes(record); const synced = await saveMeetingRecord(record); setNotesStatus('ready')
      if (!synced) setNotesError('Meeting minutes could not sync to your account.')
    } catch (err) {
      const notes = { _ana: baseAna }
      const record = { id: recordId || `${start || Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: manualMetadata.topic || `Meeting · ${formatMeetingDate(start || end)}`, startedAt: start || end, endedAt: end, durationMs: Math.max(0, end - (start || end)), target: outputLanguage, source: mode, metadata: manualMetadata, momTemplate: template, transcriptSegments: normalizedSegments, speakerNames: names, bookmarks: meetingBookmarks || [], audioPath: clean(audioPath), notes, originalText: transcript, translatedText: translation }
      setMeetingNotes(record); await saveMeetingRecord(record); setNotesError(err.message || 'The transcript was saved, but Ana could not create notes.'); setNotesStatus('error')
    }
  }

  const endMeeting = async () => {
    if (!activeRef.current || processing) return
    const mode = meetingModeRef.current, liveOriginalFinal = mode === 'translate' ? appendText(originalTextRef.current, originalBufferRef.current) : appendText(originalTextRef.current, liveOriginal), liveTranslationFinal = appendText(translatedTextRef.current, translatedBufferRef.current), start = startedAtRef.current || Date.now(), end = Date.now()
    activeRef.current = false; pausedRef.current = false; setPaused(false); setSessionState('processing'); setNotesStatus('transcribing')
    let recording = null; try { recording = await stopRecorder() } catch {}; closeRealtime(false); stopTracks(); await closeQuotaSession()
    let finalTranscript = clean(liveOriginalFinal), finalSegments = [], finalTranscriptError = '', retainedAudioPath = ''
    const translation = mode === 'translate' ? liveTranslationFinal : ''
    const recordId = `${start}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
    const draft = {
      id: recordId, title: meetingMeta.topic || `Meeting · ${formatMeetingDate(start)}`,
      startedAt: start, endedAt: end, durationMs: end - start, source: mode,
      target: targetRef.current, originalText: finalTranscript, translatedText: translation,
      notes: { _ana: { metadata: meetingMeta, manualNotes: clean(readMeetingScribble()?.text), bookmarks, transcriptionStatus: 'pending' } },
    }
    await saveMeetingRecord(draft)
    let audioSaveError = ''
    if (keepAudio && recording?.size) {
      try {
        retainedAudioPath = await uploadMeetingAudio(recording)
        draft.notes._ana.audioPath = retainedAudioPath
        await saveMeetingRecord(draft)
      } catch (error) {
        audioSaveError = `Audio retention failed: ${error.message}`
      }
    }
    try {
      const result = await transcribeRecording(recording, retainedAudioPath)
      finalTranscript = result.text
      finalSegments = result.segments
    } catch (error) {
      finalTranscriptError = error.message || 'Final transcription failed.'
    }
    setTranscriptSegments(finalSegments); setSpeakerNames({}); setTranscriptDirty(false)
    setOriginalText(finalTranscript); originalTextRef.current = finalTranscript; setTranslatedText(translation); translatedTextRef.current = translation
    setLiveOriginal(''); setLiveTranslation(''); originalBufferRef.current = ''; translatedBufferRef.current = ''; transcriptionItemsRef.current.clear(); transcriptionOrderRef.current = []; setSessionState('ended')
    draft.originalText = finalTranscript
    draft.notes._ana.transcriptSegments = finalSegments
    draft.notes._ana.transcriptionStatus = finalTranscriptError ? 'failed' : 'complete'
    draft.notes._ana.transcriptionError = finalTranscriptError
    const savedToCloud = await saveMeetingRecord(draft)
    setMeetingNotes(draft)
    if (finalTranscript.length >= 20) {
      await generateMeetingNotes({ recordId, transcript: finalTranscript, translation, start, end, mode, segments: finalSegments, names: {}, audioPath: retainedAudioPath, meetingBookmarks: bookmarks, transcriptionError: finalTranscriptError })
    } else {
      setNotesStatus('error')
    }
    const transcriptMessage = finalTranscriptError
      ? `${finalTranscriptError} ${finalTranscript ? 'Live transcript text is available.' : 'No transcript was created.'}`
      : finalTranscript.length < 20 ? 'There is too little transcript text to create meeting minutes.' : ''
    const warning = [transcriptMessage, audioSaveError, savedToCloud ? '' : 'The meeting could not sync to your account. Check the history on this device.'].filter(Boolean).join(' ')
    if (warning) setNotesError(previous => [previous, warning].filter(Boolean).join(' '))
    try { window.dispatchEvent(new CustomEvent('ana:meeting-ended', { detail: { endedAt: end } })) } catch {}
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

  const reassignSegmentSpeaker = (index, speaker) => {
    setTranscriptSegments(previous => previous.map((segment, i) => i === index ? { ...segment, speaker } : segment))
    setTranscriptDirty(true)
  }

  const openHistoryForReview = record => {
    const segments = normalizeSegments(record?.transcriptSegments || record?.notes?._ana?.transcriptSegments)
    setMeetingNotes(record)
    setTranscriptSegments(segments)
    setSpeakerNames(record?.speakerNames || record?.notes?._ana?.speakerNames || {})
    setOriginalText(clean(record?.originalText))
    originalTextRef.current = clean(record?.originalText)
    setTranslatedText(clean(record?.translatedText))
    translatedTextRef.current = clean(record?.translatedText)
    setTranscriptDirty(false)
    setNotesStatus('ready')
    setNotesError(record?.notes?._ana?.transcriptionError || '')
    setHighlightedSegment('')
    requestAnimationFrame(() => document.getElementById('ana-meeting-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const jumpToEvidence = segmentId => {
    const segment = transcriptSegments.find(item => item.id === segmentId)
    if (!segment) return
    setHighlightedSegment(segmentId)
    document.getElementById('meeting-evidence-' + encodeURIComponent(segmentId))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (clean(meetingNotes?.notes?._ana?.audioPath || meetingNotes?.audioPath)) void playRetainedAudio(segment.start)
  }
  const evidenceButton = (kind, index) => {
    const id = meetingNotes?.notes?._ana?.evidenceLinks?.[kind]?.[index]
    const segment = transcriptSegments.find(item => item.id === id)
    if (!segment) return null
    return <button type="button" className="meeting-evidence-link" onClick={() => jumpToEvidence(id)} title="Jump to supporting transcript segment"><Bookmark size={12}/> Evidence {formatSegmentTime(segment.start)}</button>
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

  const retryHistoryMeeting = async record => {
    const transcript = clean(record?.originalText)
    if (transcript.length < 20 || processing || notesStatus === 'preparing') return
    const startValue = Number(record?.startedAt) || Date.parse(record?.startedAt || '') || Date.now()
    const endValue = Number(record?.endedAt) || Date.parse(record?.endedAt || '') || (startValue + (Number(record?.durationMs) || 0)) || Date.now()
    const segments = normalizeSegments(record?.transcriptSegments || record?.notes?._ana?.transcriptSegments || [])
    const names = record?.speakerNames || record?.notes?._ana?.speakerNames || {}
    const metadata = record?.metadata || record?.notes?._ana?.metadata || {}
    const template = record?.momTemplate || record?.notes?._ana?.momTemplate || {}
    const recordBookmarks = record?.bookmarks || record?.notes?._ana?.bookmarks || []

    setMeetingNotes(record)
    setOriginalText(transcript); originalTextRef.current = transcript
    setTranslatedText(clean(record?.translatedText)); translatedTextRef.current = clean(record?.translatedText)
    setTranscriptSegments(segments); setSpeakerNames(names); setTranscriptDirty(false); setNotesError('')

    await generateMeetingNotes({
      transcript,
      translation: clean(record?.translatedText),
      start: startValue,
      end: endValue,
      mode: record?.source || meetingMode,
      recordId: record?.id || '',
      segments,
      names,
      audioPath: record?.notes?._ana?.audioPath || record?.audioPath || '',
      meetingBookmarks: recordBookmarks,
      metadataOverride: metadata,
      templateOverride: template,
      outputLanguageOverride: record?.target || targetRef.current,
    })
  }

  const retrySavedAudio = async record => {
    const path = record?.notes?._ana?.audioPath
    if (!path || !supabase || processing || activeRef.current) return
    setNotesStatus('transcribing')
    setNotesError('')
    setMeetingNotes(record)
    try {
      const audio = await downloadMeetingAudio(path)
      const result = await transcribeRecording(audio, path)
      const updated = {
        ...record,
        originalText: result.text,
        transcriptSegments: result.segments,
        notes: { ...record.notes, _ana: { ...record.notes._ana, transcriptSegments: result.segments, transcriptionStatus: 'complete', transcriptionError: '' } },
      }
      await saveMeetingRecord(updated)
      openHistoryForReview(updated)
      await generateMeetingNotes({
        transcript: result.text, translation: record.translatedText, start: record.startedAt,
        end: record.endedAt, mode: record.source, recordId: record.id, segments: result.segments,
        names: {}, audioPath: path, meetingBookmarks: record.notes._ana.bookmarks,
        metadataOverride: record.notes._ana.metadata, outputLanguageOverride: record.target,
      })
    } catch (error) {
      setNotesStatus('error')
      setNotesError(error.message || 'Could not transcribe saved audio.')
    }
  }

  const importAudioFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!consentVerified) { setError('Confirm that all participants agreed before importing or processing meeting audio.'); return }
    setImportingAudio(true); setError(''); setNotesError(''); setNotesStatus('transcribing'); setSessionState('processing')
    const end = Date.now()
    let quotaReservationId = '', audioPath = ''
    try {
      const durationSeconds = await audioFileDurationSeconds(file)
      if (!durationSeconds) throw new Error('Ana could not determine the audio duration before applying the tester allowance.')
      const reservation = await reserveFixedTimedUsage('meeting_notes', Math.ceil(durationSeconds), file.name)
      quotaReservationId = reservation.sessionId
      void recordConsentEvent('meeting_recording', 'confirmed', CONSENT_VERSIONS.meeting, { mode: 'import', keepAudio: Boolean(keepAudio) })
      if (keepAudio) void recordConsentEvent('meeting_audio_retention', 'confirmed', CONSENT_VERSIONS.audioRetention, { mode: 'import' })
      audioPath = keepAudio ? await uploadMeetingAudio(file) : ''
      const result = await transcribeRecording(file, audioPath)
      const segments = result.segments
      const durationMs = segments.length ? Math.max(...segments.map(item => Number(item.end) || 0)) * 1000 : durationSeconds * 1000
      const start = durationMs ? end - durationMs : end
      setStartedAt(start); startedAtRef.current = start; setElapsed(durationMs)
      setTranscriptSegments(segments); setSpeakerNames({}); setTranscriptDirty(false)
      setOriginalText(result.text); originalTextRef.current = result.text
      setTranslatedText(''); translatedTextRef.current = ''
      setSessionState('ended')
      await generateMeetingNotes({ transcript: result.text, translation: '', start, end, mode: 'import', segments, names: {}, audioPath, meetingBookmarks: bookmarks })
      setConsentVerified(false)
      setKeepAudio(false)
    } catch (err) {
      if (audioPath) await supabase.storage.from(AUDIO_BUCKET).remove(meetingAudioPaths(audioPath)).catch(() => {})
      if (quotaReservationId) await refundFixedTimedUsage(quotaReservationId)
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
      setNotesError('')
      const existing = audioPlayerRef.current
      if (existing?.dataset?.audioPath === path && existing.src) {
        existing.currentTime = Math.max(0, Number(startSeconds) || 0)
        await existing.play()
        return
      }
      setAudioPlayback({ status: 'loading', at: 0, duration: 0 })
      let playbackUrl
      if (meetingAudioPaths(path).length > 1) {
        playbackUrl = URL.createObjectURL(await downloadMeetingAudio(path))
      } else {
        const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 600)
        if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open retained audio.')
        playbackUrl = data.signedUrl
      }
      try { existing?.pause?.() } catch {}
      if (existing?.src?.startsWith('blob:')) URL.revokeObjectURL(existing.src)
      const audio = new Audio(playbackUrl)
      audio.dataset.audioPath = path
      audioPlayerRef.current = audio
      audio.addEventListener('timeupdate', () => { if (audioPlayerRef.current === audio) setAudioPlayback(value => ({ ...value, at: audio.currentTime })) })
      audio.addEventListener('durationchange', () => { if (audioPlayerRef.current === audio) setAudioPlayback(value => ({ ...value, duration: Number.isFinite(audio.duration) ? audio.duration : 0 })) })
      audio.addEventListener('play', () => { if (audioPlayerRef.current === audio) setAudioPlayback(value => ({ ...value, status: 'playing' })) })
      audio.addEventListener('pause', () => { if (audioPlayerRef.current === audio) setAudioPlayback(value => ({ ...value, status: 'paused' })) })
      audio.addEventListener('ended', () => { if (audioPlayerRef.current === audio) setAudioPlayback(value => ({ ...value, status: 'ended' })) })
      audio.addEventListener('error', () => { if (audioPlayerRef.current === audio) { setNotesError('Retained audio could not be played.'); setAudioPlayback(value => ({ ...value, status: 'error' })) } })
      audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, Number(startSeconds) || 0); void audio.play().catch(error => setNotesError(error?.message || 'Playback was blocked.')) }, { once: true })
      audio.load()
    } catch (error) { setAudioPlayback(value => ({ ...value, status: 'error' })); setNotesError(error?.message || 'Retained audio could not be played.') }
  }
  const toggleAudioPlayback = () => {
    const audio = audioPlayerRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(error => setNotesError(error?.message || 'Playback was blocked.'))
    else audio.pause()
  }
  const seekAudioPlayback = seconds => {
    const audio = audioPlayerRef.current
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, Math.max(0, Number(seconds) || 0))
  }

  const deleteRetainedAudio = async () => {
    const record = meetingNotes
    const path = clean(record?.notes?._ana?.audioPath || record?.audioPath)
    if (!path || !supabase) return
    try {
      const { error: removeError } = await supabase.storage.from(AUDIO_BUCKET).remove(meetingAudioPaths(path))
      if (removeError) throw removeError
      const notes = record?.notes ? { ...record.notes, _ana: { ...(record.notes._ana || {}), audioPath: '' } } : record?.notes
      const updated = { ...record, audioPath: '', notes }
      setMeetingNotes(updated)
      saveMeetingRecord(updated)
      try { audioPlayerRef.current?.pause?.() } catch {}
      if (audioPlayerRef.current?.src?.startsWith('blob:')) URL.revokeObjectURL(audioPlayerRef.current.src)
      audioPlayerRef.current = null
      setAudioPlayback({ status: 'idle', at: 0, duration: 0 })
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
      '## Evidence links',
      ...['decisions', 'actions', 'openQuestions'].flatMap(kind => (Array.isArray(notes[kind]) ? notes[kind] : []).flatMap((item,index) => { const id = notes?._ana?.evidenceLinks?.[kind]?.[index]; const segment = transcriptSegments.find(part => part.id === id); return segment ? [`- ${kind}: ${typeof item === 'string' ? item : item?.task || ''} [${formatSegmentTime(segment.start)}] (segment ${id})`] : [] })),
      '',
      '## Evidence transcript',
      '',
      transcriptSegments.length ? transcriptFromSegments(transcriptSegments, speakerNames) : originalText,
    ].filter(value => value !== '').join('\n\n')
    const blob = new Blob([lines], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `ana-mom-${new Date(record.startedAt || Date.now()).toISOString().slice(0, 10)}.md`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const downloadSrt = () => {
    if (!transcriptSegments.length) return
    const subtitles = meetingSegmentsToSrt(transcriptSegments, speakerNames)
    if (!subtitles) return
    const blob = new Blob([subtitles], { type: 'application/x-subrip;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ana-meeting-${new Date(meetingNotes?.startedAt || Date.now()).toISOString().slice(0, 10)}.srt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
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

      <details className="meeting-optional-context">
        <summary>Optional meeting context</summary>
        <div className="meeting-optional-context-body">
          <label><span>Anything Ana should know?</span><input value={meetingMeta.topic} onChange={event => setMeetingMeta(value => ({ ...value, topic: event.target.value }))} placeholder="Optional: topic, customer, project or anything important" disabled={active || processing}/></label>
          <button type="button" onClick={prepareMeetingBrief} disabled={active || processing || preMeetingLoading}>{preMeetingLoading ? 'Preparing…' : 'Prepare me'}</button>
          {preMeetingBrief && <div className="meeting-prebrief-body">
            {!preMeetingBrief.meetings.length ? <p>No earlier matching meetings were found yet.</p> : <>
              {preMeetingBrief.openActions.length > 0 && <div><b>Open actions</b>{preMeetingBrief.openActions.slice(0,6).map((item,index)=><p key={`a-${index}`}>{item.task}{item.owner ? ` · ${item.owner}` : ''}{item.deadline ? ` · ${item.deadline}` : ''}</p>)}</div>}
              {preMeetingBrief.decisions.length > 0 && <div><b>Recent decisions</b>{preMeetingBrief.decisions.slice(0,5).map((item,index)=><p key={`d-${index}`}>{item}</p>)}</div>}
              {preMeetingBrief.questions.length > 0 && <div><b>Open questions</b>{preMeetingBrief.questions.slice(0,5).map((item,index)=><p key={`q-${index}`}>{item}</p>)}</div>}
            </>}
          </div>}
        </div>
      </details>

      <details className="meeting-optional-context">
        <summary>Technical vocabulary · {meetingGlossary.length} corrections</summary>
        <div className="meeting-optional-context-body">
          <p>Teach Ana words often misheard in meetings, such as “V A zero one” → “VA01”. Saved on this device and supplied as hints to future transcriptions; existing live sessions will not change.</p>
          <label><span>What Ana might hear</span><input value={termHeard} onChange={event => setTermHeard(event.target.value)} maxLength={80} placeholder="V A zero one" disabled={active || processing}/></label>
          <label><span>Preferred spelling</span><input value={termPreferred} onChange={event => setTermPreferred(event.target.value)} maxLength={80} placeholder="VA01" disabled={active || processing}/></label>
          <button type="button" onClick={saveMeetingTerm} disabled={active || processing || !clean(termHeard) || !clean(termPreferred) || clean(termHeard) === clean(termPreferred)}>Save correction</button>
          {meetingGlossary.length > 0 && <div className="meeting-terms-list">{meetingGlossary.slice(-12).map((item,index) => <div key={item.source + index}><span>{item.source} → <strong>{item.preferred}</strong></span><button type="button" onClick={() => removeMeetingTerm(item.source)} disabled={active || processing} aria-label={`Remove correction for ${item.source}`}>Remove</button></div>)}</div>}
        </div>
      </details>

      <label className="meeting-consent"><input type="checkbox" checked={consentVerified} onChange={event => setConsentVerified(event.target.checked)} disabled={active || processing}/><span><strong>Everyone has agreed</strong> I confirm that all participants have been informed and have agreed to this meeting being recorded, transcribed and processed by Ana.</span></label>
      <label className="meeting-consent meeting-keep-audio"><input type="checkbox" checked={keepAudio} onChange={event => setKeepAudio(event.target.checked)} disabled={active || processing}/><span><strong>Keep audio after transcription</strong> Off by default. Enable only if participants also agreed that Ana may retain the meeting audio; otherwise Ana deletes the temporary audio after transcription.</span></label>
      <div className={`meeting-single-card ${active ? 'active' : ''}`}>
        <div className="meeting-status-row meeting-live-status"><div><i className={active && !paused ? 'on' : ''}/><strong>{statusText}</strong></div><span>{startedAt ? formatTime(elapsed) : '00:00'} · {source === 'screen' ? <><MonitorUp size={13}/> shared audio</> : <><Mic size={13}/> microphone</>}</span></div>

        {meetingMode === 'translate' && <div className="meeting-single-screen">
          <section className="meeting-complete-translation"><div className="meeting-screen-label"><span>Translation · {target}</span>{active && liveOriginal && !liveTranslation ? <em>catching up…</em> : null}</div><div ref={translationPaneRef} className="meeting-screen-scroll meeting-translation-scroll"><p>{translatedText || (!liveTranslation && !active ? 'Your translated meeting will appear here.' : '')}</p>{liveTranslation && <p className="meeting-interim-caption" aria-live="off">{liveTranslation}</p>}{active && !translatedText && !liveTranslation && <p>Translation will appear here as soon as Ana understands the speech.</p>}</div></section>
          <section className="meeting-complete-hearing"><div className="meeting-screen-label"><span>What Ana hears</span>{active && !paused ? <em className="meeting-hearing-live">● live</em> : null}</div><div ref={hearingPaneRef} className="meeting-screen-scroll meeting-hearing-scroll"><p>{originalText || (!active && !liveOriginal ? 'Start listening and the source transcript will appear here.' : '')}</p>{liveOriginal && <p className="meeting-interim-caption" aria-live="off">{liveOriginal}</p>}{active && !originalText && !liveOriginal && <p>Listening for speech…</p>}</div></section>
        </div>}
        {meetingMode === 'transcript' && <div className="meeting-transcript-only-screen"><div className="meeting-screen-label"><span>Live transcript</span>{active && !paused ? <em className="meeting-hearing-live">● live</em> : null}</div><div ref={hearingPaneRef} className="meeting-screen-scroll meeting-transcript-only-scroll"><p>{originalText || (!active && !liveOriginal ? 'Start listening and the transcript will appear here.' : '')}</p>{liveOriginal && <p className="meeting-interim-caption" aria-live="off">{liveOriginal}</p>}{active && !originalText && !liveOriginal && <p>Listening for speech…</p>}</div></div>}
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

    <MeetingScribble />

    {(notesStatus !== 'idle' || meetingNotes) && <section className="meeting-notes-card">
      <div className="meeting-notes-head"><div><Sparkles size={16}/><h2>After the meeting</h2></div><span>High-quality final pass</span></div>
      {notesStatus === 'transcribing' && <div className="meeting-notes-loading"><i/>Ana is preparing the final transcript from the meeting audio…</div>}
      {notesStatus === 'preparing' && <div className="meeting-notes-loading"><i/>Ana is separating meeting signal from chatter and preparing the MOM…</div>}
      {meetingNotes?.notes && <div className="meeting-notes-body"><h2 className="meeting-notes-title">{meetingNotes.title}</h2><div className="meeting-notes-meta">{formatMeetingDate(meetingNotes.startedAt)} · {formatTime(meetingNotes.durationMs)} · {meetingNotes.target}</div>
        <div className="meeting-label-chips">{[meetingNotes.metadata?.customer, meetingNotes.metadata?.topic, meetingNotes.metadata?.project, meetingNotes.metadata?.meetingType, meetingNotes.momTemplate?.title, ...(meetingNotes.metadata?.tags || [])].filter(Boolean).map((item,index)=><span key={index}>{item}</span>)}</div>
        {!!meetingNotes.notes.sections?.length && <div className="meeting-template-output">{meetingNotes.notes.sections.map((section,index)=><section className="meeting-notes-section" key={index}><h3>{clean(section?.title) || `Section ${index + 1}`}</h3>{clean(section?.content) && <p>{section.content}</p>}{Array.isArray(section?.items) && section.items.length ? <ul>{section.items.map((item,itemIndex)=><li key={itemIndex}>{String(item)}</li>)}</ul> : null}</section>)}</div>}
        {!meetingNotes.notes.sections?.length && meetingNotes.notes.summary && <section className="meeting-notes-section"><h3>Summary</h3><p>{meetingNotes.notes.summary}</p></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.keyPoints?.length && <section className="meeting-notes-section"><h3>Key points</h3><ul>{meetingNotes.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.decisions?.length && <section className="meeting-notes-section"><h3>Decisions</h3><ul>{meetingNotes.notes.decisions.map((item,index)=><li key={index}>{String(item)} {evidenceButton('decisions', index)}</li>)}</ul></section>}
        {!!meetingNotes.notes.sections?.length && (['decisions', 'openQuestions'].some(kind => meetingNotes.notes._ana?.evidenceLinks?.[kind]?.some(Boolean))) && <section className="meeting-notes-section"><h3>Traceable evidence</h3>{['decisions', 'openQuestions'].map(kind => <div key={kind}><strong>{kind === 'decisions' ? 'Decisions' : 'Open questions'}</strong><ul>{(Array.isArray(meetingNotes.notes[kind]) ? meetingNotes.notes[kind] : []).map((item,index) => meetingNotes.notes._ana?.evidenceLinks?.[kind]?.[index] ? <li key={index}>{String(item)} {evidenceButton(kind,index)}</li> : null)}</ul></div>)}</section>}
        {!!meetingNotes.notes.actions?.length && <section className="meeting-notes-section"><h3>To-do / actions</h3><div className="meeting-action-list">{meetingNotes.notes.actions.map((item,index)=><div className="meeting-action" key={index}><strong>{typeof item === 'string' ? item : item?.task}</strong>{evidenceButton('actions', index)}{typeof item !== 'string' && (item?.owner || item?.deadline) && <small>{item?.owner ? `Owner: ${item.owner}` : 'Owner: not specified'}{item?.deadline ? ` · Deadline: ${item.deadline}` : ''}</small>}</div>)}</div></section>}
        {!meetingNotes.notes.sections?.length && !!meetingNotes.notes.openQuestions?.length && <section className="meeting-notes-section"><h3>Open questions</h3><ul>{meetingNotes.notes.openQuestions.map((item,index)=><li key={index}>{String(item)} {evidenceButton('openQuestions', index)}</li>)}</ul></section>}
        {retainedAudioPath && (!originalText || meetingNotes.notes._ana?.transcriptionStatus === 'failed') && <div className="meeting-audio-controls"><button type="button" onClick={() => playRetainedAudio(0)}><Play size={14}/> Play saved audio</button><button type="button" disabled={active || processing} onClick={() => retrySavedAudio(meetingNotes)}><RefreshCw size={14}/> Retry transcription</button><button type="button" onClick={deleteRetainedAudio}><Trash2 size={14}/> Delete audio</button></div>}
        {(transcriptSegments.length > 0 || originalText) && <section id="ana-meeting-review" className="meeting-review-transcript"><div className="meeting-review-head"><div><strong>Review transcript evidence</strong><span>Edit speaker names or transcript text before regenerating the MOM. Evidence links appear only when Ana can reference a valid segment ID.</span></div><div><button onClick={downloadMomMarkdown}><Download size={14}/> MOM .md</button>{transcriptSegments.length > 0 && <button type="button" onClick={downloadSrt}><Download size={14}/> Subtitles .srt</button>}{retainedAudioPath && <button onClick={deleteRetainedAudio}><Trash2 size={14}/> Delete audio</button>}<button className={transcriptDirty || notesStatus === 'error' ? 'primary' : ''} onClick={regenerateFromReviewedTranscript} disabled={processing || notesStatus === 'preparing' || (notesStatus !== 'error' && !transcriptDirty)}><RefreshCw size={14}/> {notesStatus === 'error' ? 'Retry MOM' : 'Regenerate MOM'}</button></div></div>
          {retainedAudioPath && <div className="meeting-audio-controls"><button type="button" onClick={toggleAudioPlayback} disabled={!audioPlayerRef.current}>{audioPlayback.status === 'playing' ? <Pause size={14}/> : <Play size={14}/>} {audioPlayback.status === 'playing' ? 'Pause audio' : 'Play audio'}</button><span>{formatSegmentTime(audioPlayback.at)} / {formatSegmentTime(audioPlayback.duration)}</span><input type="range" aria-label="Seek meeting audio" min="0" max={Math.max(1, audioPlayback.duration)} step="0.5" value={Math.min(audioPlayback.at, Math.max(1, audioPlayback.duration))} onChange={event => seekAudioPlayback(event.target.value)} disabled={!audioPlayerRef.current || !audioPlayback.duration}/></div>}
          {transcriptSegments.length ? <div className="meeting-segment-editor">{[...new Set(transcriptSegments.map(item => item.speaker))].map(speaker => <label className="meeting-speaker-name" key={speaker}><span>{speaker}</span><input value={speakerNames[speaker] || ''} onChange={event => renameSpeaker(speaker, event.target.value)} placeholder={speaker}/></label>)}{transcriptSegments.map((segment,index)=><article id={'meeting-evidence-' + encodeURIComponent(segment.id)} className={`meeting-segment-row ${highlightedSegment === segment.id ? 'meeting-evidence-highlight' : ''}`} key={segment.id || index}><div><span>{formatSegmentTime(segment.start)}</span><label className="meeting-segment-speaker"><span className="sr-only">Speaker for segment {index + 1}</span><select aria-label={`Speaker for segment ${index + 1}`} value={segment.speaker} onChange={event => reassignSegmentSpeaker(index, event.target.value)}>{[...new Set([...transcriptSegments.map(item => item.speaker), segment.speaker])].map(speaker => <option key={speaker} value={speaker}>{speakerNames[speaker] || speaker}</option>)}</select></label>{retainedAudioPath && <button type="button" className="meeting-play-segment" onClick={() => playRetainedAudio(segment.start)}><Play size={11}/> Replay</button>}</div><textarea value={segment.text} onChange={event => updateTranscriptSegment(index, event.target.value)} rows={Math.max(2, Math.min(5, Math.ceil(segment.text.length / 90)))}/></article>)}</div> : <textarea className="meeting-raw-editor" value={originalText} onChange={event => { setOriginalText(event.target.value); originalTextRef.current = event.target.value; setTranscriptDirty(true) }} rows={10}/>}
        </section>}
      </div>}
      {notesError && <div className="meeting-notes-error">{notesError}</div>}
    </section>}

    {!!meetingHistory.length && <section className="meeting-history"><div className="meeting-history-head"><div><History size={16}/><h2>Meeting history</h2></div><span>{filteredMeetingHistory.length} of {meetingHistory.length}</span></div><div className="meeting-history-filter"><SearchFallback/><input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Filter by customer, topic, project, tag or template"/></div><div className="meeting-history-list">{filteredMeetingHistory.map(record => { const meta = record?.metadata || record?.notes?._ana?.metadata || {}; const template = record?.momTemplate || record?.notes?._ana?.momTemplate || {}; return <details className="meeting-history-item" key={record.id}><summary><div className="meeting-history-summary"><strong>{record.title || 'Meeting'}</strong><span>{formatMeetingDate(record.startedAt)} · {formatTime(record.durationMs || 0)}</span><div className="meeting-label-chips compact">{[meta.customer, meta.topic, meta.project, template.title, ...(meta.tags || [])].filter(Boolean).slice(0,5).map((item,index)=><span key={index}>{item}</span>)}</div></div><span>{record.target}</span></summary><div className="meeting-history-detail">
      <div className="meeting-transcript-actions meeting-single-actions"><button type="button" onClick={() => openHistoryForReview(record)}>Open review &amp; evidence</button></div>
      {record.notes?._ana?.transcriptionStatus === 'failed' && <p>{record.notes._ana.transcriptionError} {record.originalText ? 'Live transcript text is available.' : 'No transcript was created.'}</p>}
      {!record.notes?.summary && !record.notes?.sections?.length && clean(record.originalText).length >= 20 && <div className="meeting-transcript-actions meeting-single-actions"><button type="button" className="primary" onClick={() => retryHistoryMeeting(record)} disabled={processing || notesStatus === 'preparing'}><RefreshCw size={14}/> Generate MOM from transcript</button></div>}
      {record.notes?.summary && <div><h4>Summary</h4><p>{record.notes.summary}</p></div>}{!!record.notes?.keyPoints?.length && <div><h4>Key points</h4><ul>{record.notes.keyPoints.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.decisions?.length && <div><h4>Decisions</h4><ul>{record.notes.decisions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}{!!record.notes?.actions?.length && <div><h4>To-do / actions</h4><ul>{record.notes.actions.map((item,index)=><li key={index}>{typeof item === 'string' ? item : [item?.task, item?.owner ? `Owner: ${item.owner}` : '', item?.deadline ? `Deadline: ${item.deadline}` : ''].filter(Boolean).join(' · ')}</li>)}</ul></div>}{!!record.notes?.openQuestions?.length && <div><h4>Open questions</h4><ul>{record.notes.openQuestions.map((item,index)=><li key={index}>{String(item)}</li>)}</ul></div>}
      <div className="meeting-history-transcripts">{!!record.translatedText && <details><summary>Translated transcript</summary><p>{record.translatedText}</p></details>}<details><summary>Original transcript</summary><p>{record.originalText || '—'}</p></details></div></div></details> })}</div></section>}

    <p className="meeting-footnote">All three modes keep the complete final transcript as evidence. Ana filters greetings, filler and off-topic chatter only when preparing the MOM. Meeting audio is deleted after transcription by default; it is retained only when you explicitly enable Keep audio.</p>
  </section>
}
