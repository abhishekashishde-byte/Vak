import { ArrowRight, BookOpen, Camera, Captions, FileText, Headphones, Languages, Mic, MessagesSquare, UsersRound, X } from 'lucide-react'

const GUIDES = [
  {
    id: 'translate',
    title: 'Translate',
    strap: 'One message',
    description: 'Use this when you want to translate a sentence, message or paragraph. Type, paste or dictate it, choose the language, then translate.',
    steps: ['Enter or speak your message', 'Choose the language you want', 'Translate, refine or copy the result'],
    icon: Languages,
  },
  {
    id: 'live',
    title: 'Live interpreter',
    strap: 'A back-and-forth conversation',
    description: 'Use this when you and another person are both present and want Ana to interpret the conversation as you speak.',
    steps: ['Choose both languages', 'Start the conversation', 'Speak naturally and let Ana interpret both sides'],
    icon: Mic,
  },
  {
    id: 'talk',
    title: 'Talk for me',
    strap: 'Ana represents you',
    description: 'Tell Ana what you need. Ana conducts the conversation for you, discovers routine information and comes back to you for important decisions.',
    steps: ['Tell Ana the outcome you need', 'Choose your language and the other person’s language', 'Start — Ana handles the conversation while you keep material decisions'],
    icon: MessagesSquare,
  },
  {
    id: 'captions',
    title: 'Live Subtitles',
    strap: 'Temporary translated subtitles',
    description: 'Use this when you mainly want to understand what somebody is saying right now. Translation appears on screen while they speak and is not kept as a meeting record.',
    steps: ['Choose microphone or shared audio', 'Choose your subtitle language', 'Start and read the translation as people speak'],
    icon: Captions,
  },
  {
    id: 'meeting',
    title: 'Meeting Listen',
    strap: 'Long meeting + saved transcript',
    description: 'Use this for Teams, Zoom or other long meetings when you want ongoing translation and a transcript you can keep afterwards.',
    steps: ['Open your meeting and Ana side by side', 'Share meeting audio or use your speakers', 'Read the translation live; Ana keeps the text, not the audio'],
    icon: Headphones,
  },
  {
    id: 'room',
    title: 'Conversation Room',
    strap: 'Several people, several languages',
    description: 'Use this when a group is together and different people need different languages. Each person takes a turn and Ana routes the translation.',
    steps: ['Add the people and their languages', 'Open the room', 'Tap the person who is speaking and take turns'],
    icon: UsersRound,
  },
  {
    id: 'scan',
    title: 'Documents',
    strap: 'PDFs and scanned pages',
    description: 'Use this for letters, PDFs, forms and scanned documents when you need the document translated rather than just one sentence.',
    steps: ['Upload or scan the document', 'Choose the target language', 'Review the translated document and export it when ready'],
    icon: FileText,
  },
  {
    id: 'camera',
    title: 'Camera',
    strap: 'Signs, menus, forms and images',
    description: 'Use this when the text is in front of you — for example a menu, notice, sign or printed form.',
    steps: ['Take or choose a photo', 'Let Ana read the visible text', 'Translate the part you need'],
    icon: Camera,
  },
]

const QUICK_CHOICES = [
  ['I have one message to translate', 'translate'],
  ['I am talking back and forth with someone', 'live'],
  ['I want Ana to handle the conversation for me', 'talk'],
  ['I only need live translated subtitles', 'captions'],
  ['I am joining a long meeting and want the transcript', 'meeting'],
  ['Several people need different languages', 'room'],
  ['I have a PDF or scanned letter', 'scan'],
  ['I am looking at a sign, menu or form', 'camera'],
]

export default function LearnCenter({ open, onClose, onChooseMode, welcome = false }) {
  if (!open) return null

  const choose = mode => {
    try { localStorage.setItem('ana-onboarding-v2', 'seen') } catch {}
    onChooseMode?.(mode)
    onClose?.()
  }

  const close = () => {
    try { localStorage.setItem('ana-onboarding-v2', 'seen') } catch {}
    onClose?.()
  }

  return <div className="ana-learn-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="ana-learn-panel" role="dialog" aria-modal="true" aria-label="Learn how to use Ana">
      <header className="ana-learn-head">
        <div>
          <span><BookOpen size={14}/> {welcome ? 'Welcome to Ana' : 'Learn Ana'}</span>
          <h2>{welcome ? 'Tell Ana what you are trying to do.' : 'Which Ana mode should I use?'}</h2>
          <p>You do not need to learn the technology. Pick the real-world job and Ana will take you to the right place.</p>
        </div>
        <button type="button" onClick={close} aria-label="Close"><X size={20}/></button>
      </header>

      <div className="ana-learn-quick">
        <strong>What are you doing right now?</strong>
        <div>{QUICK_CHOICES.map(([label, mode]) => <button type="button" key={mode} onClick={() => choose(mode)}><span>{label}</span><ArrowRight size={15}/></button>)}</div>
      </div>

      <div className="ana-learn-guides">
        {GUIDES.map(guide => {
          const Icon = guide.icon
          return <article key={guide.id}>
            <div className="ana-learn-guide-title"><span><Icon size={17}/></span><div><strong>{guide.title}</strong><small>{guide.strap}</small></div></div>
            <p>{guide.description}</p>
            <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
            <button type="button" onClick={() => choose(guide.id)}>Open {guide.title}<ArrowRight size={14}/></button>
          </article>
        })}
      </div>

      <footer className="ana-learn-links">
        <div><strong>Want more detail?</strong><span>Guides, customer experiences and developer integrations live outside the working screen so Ana stays simple.</span></div>
        <nav><a href="/learn/" target="_blank" rel="noreferrer">Learn & guides</a><a href="/reviews/" target="_blank" rel="noreferrer">Customer reviews</a><a href="/developers/" target="_blank" rel="noreferrer">Developers</a></nav>
      </footer>
    </section>
  </div>
}
