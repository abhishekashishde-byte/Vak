import { useMemo, useState } from 'react'
import { ArrowRight, BookOpen, Camera, Captions, FileText, Headphones, Keyboard, Languages, Mic, MessagesSquare, UsersRound, X } from 'lucide-react'

const GUIDES = [
  {
    id: 'translate',
    title: 'Translate',
    strap: 'One message or paragraph',
    summary: 'Translate typed, pasted or dictated text into the language you choose.',
    steps: ['Enter or dictate the message', 'Choose the target language', 'Translate, refine or copy the result'],
    icon: Languages,
    mode: 'translate',
  },
  {
    id: 'keyboard',
    title: 'Ana Keyboard',
    strap: 'Use Ana inside other apps',
    summary: 'Type normally, get local suggestions and corrections, then use Ana actions only when you need them.',
    steps: ['Choose EN, DE or Hinglish for typing', 'Use suggestions, glide, voice, emoji/GIF and your personal dictionary', 'Pick a target language for Translate, Write or Correct'],
    icon: Keyboard,
    guide: '/learn/?guide=keyboard',
  },
  {
    id: 'live',
    title: 'Live Interpreter',
    strap: 'Two people talking',
    summary: 'Use this when you and another person are both speaking and want Ana to interpret both sides.',
    steps: ['Choose both languages', 'Start the conversation', 'Speak naturally and let Ana interpret each turn'],
    icon: Mic,
    mode: 'live',
  },
  {
    id: 'talk',
    title: 'Talk for Me',
    strap: 'Ana handles the conversation',
    summary: 'Tell Ana the outcome you need. Ana handles routine dialogue and returns important decisions to you.',
    steps: ['Describe the outcome you want', 'Set the two languages', 'Start and keep material decisions with you'],
    icon: MessagesSquare,
    mode: 'talk',
  },
  {
    id: 'captions',
    title: 'Live Subtitles',
    strap: 'Understand speech now',
    summary: 'Read translated subtitles while someone is speaking without creating a meeting record.',
    steps: ['Choose microphone or shared audio', 'Choose the subtitle language', 'Start and read the translated speech'],
    icon: Captions,
    mode: 'captions',
  },
  {
    id: 'meeting',
    title: 'Meeting Listen',
    strap: 'Long meeting + transcript',
    summary: 'Use this for longer meetings when you want ongoing translation and text you can review afterwards.',
    steps: ['Open Ana beside the meeting', 'Share meeting audio or use speakers', 'Read live translation and keep the text transcript'],
    icon: Headphones,
    mode: 'meeting',
  },
  {
    id: 'room',
    title: 'Conversation Room',
    strap: 'Several people and languages',
    summary: 'Give each person a language and let Ana route each turn to the people who need it.',
    steps: ['Add people and languages', 'Open the room', 'Tap the current speaker and take turns'],
    icon: UsersRound,
    mode: 'room',
  },
  {
    id: 'scan',
    title: 'Documents',
    strap: 'PDFs and scanned pages',
    summary: 'Translate letters, forms, PDFs and scans without retyping them.',
    steps: ['Upload or scan the document', 'Choose the target language', 'Review and export the translated result'],
    icon: FileText,
    mode: 'scan',
  },
  {
    id: 'camera',
    title: 'Camera',
    strap: 'Signs, menus and printed text',
    summary: 'Point Ana at text in front of you and translate only what you need.',
    steps: ['Take or choose a photo', 'Let Ana read the visible text', 'Translate the relevant part'],
    icon: Camera,
    mode: 'camera',
  },
]

export default function LearnCenter({ open, onClose, onChooseMode, welcome = false }) {
  const [selectedId, setSelectedId] = useState('translate')
  const selected = useMemo(() => GUIDES.find(guide => guide.id === selectedId) || GUIDES[0], [selectedId])
  if (!open) return null

  const close = () => {
    try { localStorage.setItem('ana-onboarding-v3', 'seen') } catch {}
    onClose?.()
  }

  const openSelected = () => {
    try { localStorage.setItem('ana-onboarding-v3', 'seen') } catch {}
    if (selected.mode) {
      onChooseMode?.(selected.mode)
      onClose?.()
      return
    }
    if (selected.guide) window.open(selected.guide, '_blank', 'noopener,noreferrer')
  }

  const SelectedIcon = selected.icon

  return <div className="ana-learn-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="ana-learn-panel" role="dialog" aria-modal="true" aria-label="Learn how to use Ana">
      <header className="ana-learn-head">
        <div>
          <span><BookOpen size={14}/> {welcome ? 'Welcome to Ana' : 'Learn Ana'}</span>
          <h2>{welcome ? 'Pick what you want to do.' : 'Learn one feature at a time.'}</h2>
          <p>Select one feature. Ana shows only the short guide for that feature.</p>
        </div>
        <button type="button" onClick={close} aria-label="Close"><X size={20}/></button>
      </header>

      <div className="ana-learn-focus">
        <nav className="ana-learn-menu" aria-label="Ana feature guides">
          {GUIDES.map(guide => {
            const Icon = guide.icon
            const active = guide.id === selected.id
            return <button type="button" key={guide.id} className={active ? 'active' : ''} onClick={() => setSelectedId(guide.id)}>
              <span><Icon size={16}/></span>
              <div><strong>{guide.title}</strong><small>{guide.strap}</small></div>
              <ArrowRight size={14}/>
            </button>
          })}
        </nav>

        <article className="ana-learn-detail">
          <div className="ana-learn-detail-title"><span><SelectedIcon size={19}/></span><div><small>{selected.strap}</small><h3>{selected.title}</h3></div></div>
          <p>{selected.summary}</p>
          <ol>{selected.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <button type="button" onClick={openSelected}>{selected.mode ? `Open ${selected.title}` : 'Open keyboard guide'}<ArrowRight size={14}/></button>
        </article>
      </div>

      <footer className="ana-learn-links">
        <div><strong>Need another topic?</strong><span>The full Learn page also has short guides for keyboard actions, dictionary learning, GIFs, privacy and the API.</span></div>
        <nav><a href="/learn/" target="_blank" rel="noreferrer">All guides</a><a href="/developers/" target="_blank" rel="noreferrer">API</a></nav>
      </footer>
    </section>
  </div>
}
