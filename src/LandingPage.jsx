import { ArrowRight, Camera, Captions, Check, FileText, Globe2, Languages, MessageCircleMore, Mic2, ShieldCheck, Sparkles, UsersRound, Volume2 } from 'lucide-react'
import './landing.css'

const APP_URL = '/'

function AnaMark({ compact = false }) {
  return <div className={`ana-brand${compact ? ' compact' : ''}`} aria-label="Ana">
    <svg className="ana-mark" viewBox="0 0 92 92" role="img" aria-hidden="true">
      <path d="M45.8 8c-5.3 0-9.3 2.3-12 7.1L8.8 65.6c-2.3 4.6-.4 10.2 4.2 12.5 4.6 2.3 10.2.4 12.5-4.2l6.4-12.9c4.7-2.8 9.5-2.6 14.4.7 4.6 3 9.3 3.2 14.1.6l6 12c2.3 4.6 7.9 6.5 12.5 4.2 4.6-2.3 6.5-7.9 4.2-12.5L58 15.1C55.6 10.3 51.5 8 45.8 8Zm0 23.5 8.3 16.7c-3.1.7-6.1.1-9-1.8-3.2-2.1-6.5-3.1-9.9-3.1l10.6-21.8Z" fill="currentColor"/>
      <path d="M30.2 54.8c4.7-2.3 9.4-2.1 14.2.8l4.6 2.9c2.2 1.4 5.1 1.1 6.9-.7l3.6-3.6" fill="none" stroke="#f6f1e8" strokeWidth="5.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M35.9 58.4l5.7 4.8m1.2-7.2 6.5 5.3m.8-6.6 5.4 4.3" fill="none" stroke="#f6f1e8" strokeWidth="3.7" strokeLinecap="round"/>
    </svg>
    <div><strong>Ana</strong>{!compact && <span>Your voice, in any language.</span>}</div>
  </div>
}

const features = [
  { icon: Languages, title: 'Translate', text: 'Context-aware translation that preserves tone, intent, names, numbers and the way you naturally speak.' },
  { icon: Mic2, title: 'Live Interpreter', text: 'Two-way realtime interpretation for natural face-to-face conversations.' },
  { icon: MessageCircleMore, title: 'Talk for Me', text: 'Tell Ana the goal. Ana can speak on your behalf, verify what matters and pause when your decision is needed.', featured: true },
  { icon: FileText, title: 'Documents & PDFs', text: 'Translate digital and scanned documents while preserving structure, forms and tables.' },
  { icon: Camera, title: 'Camera Translation', text: 'Point, capture and understand signs, menus, labels, forms and letters.' },
  { icon: UsersRound, title: 'Conversation Rooms', text: 'Multi-person conversations where each participant can communicate in their own language.' },
  { icon: Captions, title: 'Universal Captions', text: 'Live original and translated captions for speech and supported shared audio.' },
  { icon: Sparkles, title: 'Personal Language Memory', text: 'Ana remembers language preferences, terminology and your German Sie/du choice.' },
  { icon: ShieldCheck, title: 'Privacy & Trust', text: 'Disclosure-first Talk flows, counterparty permission, owner approval and verified handoffs.' },
]

const languages = ['English','German','Schwäbisch','Bairisch','Plattdeutsch','Hindi','Hinglish','Bengali','Tamil','Telugu','Marathi','Gujarati','Punjabi','Malayalam','Kannada','Urdu','French','Spanish','Italian']

const useCases = [
  { title: 'Travel & tickets', text: 'Ask about routes, prices, rules and changes without rehearsing every sentence.', image: 'https://images.pexels.com/photos/14344455/pexels-photo-14344455.jpeg?auto=compress&cs=tinysrgb&w=1200' },
  { title: 'Appointments', text: 'Explain what you need, understand the response and keep important decisions with you.', image: 'https://images.pexels.com/photos/7579831/pexels-photo-7579831.jpeg?auto=compress&cs=tinysrgb&w=1200' },
  { title: 'Family across languages', text: 'Make everyday conversations feel less like translation and more like understanding.', image: 'https://images.pexels.com/photos/14769681/pexels-photo-14769681.jpeg?auto=compress&cs=tinysrgb&w=1200' },
]

function PhoneMockup() {
  return <div className="landing-phone" aria-label="Ana app preview">
    <div className="phone-notch"/>
    <div className="phone-screen">
      <AnaMark compact/>
      <p className="phone-question">What do you want to do?</p>
      <div className="phone-menu">
        <span><Languages size={17}/><b>Translate</b><small>Text, voice or image</small></span>
        <span><Mic2 size={17}/><b>Live Interpreter</b><small>Real-time conversation</small></span>
        <span className="phone-feature"><MessageCircleMore size={17}/><b>Talk for Me</b><small>Ana speaks on your behalf</small></span>
        <span><FileText size={17}/><b>Documents</b><small>PDFs, forms and files</small></span>
        <span><Camera size={17}/><b>Camera</b><small>Understand what you see</small></span>
      </div>
    </div>
  </div>
}

export default function LandingPage() {
  return <div className="landing-root">
    <header className="landing-nav">
      <a href="#top" className="landing-logo"><AnaMark compact/></a>
      <nav aria-label="Ana website navigation">
        <a href="#features">Features</a><a href="#talk">Talk for Me</a><a href="#how">How it works</a><a href="#languages">Languages</a><a href="#trust">Trust</a>
      </nav>
      <a className="nav-cta" href={APP_URL}>Try Ana <ArrowRight size={15}/></a>
    </header>

    <main id="top">
      <section className="landing-hero">
        <div className="hero-copy">
          <p className="overline">PEOPLE. PLACES. POSSIBILITIES.</p>
          <h1>Speak naturally.<br/><em>Ana handles</em> the rest.</h1>
          <p className="hero-deck">Ana helps you express intent, navigate conversations, and get things done across languages — in real life, not just in text.</p>
          <div className="hero-actions"><a className="primary-cta" href={APP_URL}>Try Ana <ArrowRight size={18}/></a><a className="secondary-cta" href="#how">See how it works</a></div>
          <p className="hero-trust"><ShieldCheck size={15}/> Built for real conversations. You stay in control.</p>
          <div className="hand-note">Same intent.<br/>A more open world.</div>
        </div>
        <div className="hero-visual">
          <img src="https://images.pexels.com/photos/14344455/pexels-photo-14344455.jpeg?auto=compress&cs=tinysrgb&w=1800" alt="Traveller at a railway ticket area using a phone"/>
          <PhoneMockup/>
          <div className="speech-bubble user">Can you tell her I’d like to change my train to tomorrow?</div>
          <div className="speech-bubble ana">Of course. I’ll ask her and check what options are available.</div>
          <span className="visual-note">Different languages.<br/>A kinder world.</span>
        </div>
      </section>

      <section className="intro-strip" id="features">
        <div className="section-heading"><p className="overline">A MORE HUMAN WAY TO COMMUNICATE</p><h2>People don’t want translation.<br/>They want <em>outcomes.</em></h2><p>Ana is built for real-life communication — from simple translation to interpretation, documents, captions and conversations handled on your behalf.</p></div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text, featured }) => <article className={`feature-card${featured ? ' featured' : ''}`} key={title}><div className="feature-icon"><Icon size={22}/></div><h3>{title}</h3><p>{text}</p>{featured && <span className="feature-label">Flagship</span>}</article>)}
        </div>
      </section>

      <section className="talk-showcase" id="talk">
        <div className="talk-head"><p className="overline light">TALK FOR ME</p><h2>Tell Ana the goal.<br/><em>Keep the decisions.</em></h2><p>Ana can handle the routine conversation while material choices stay with you.</p></div>
        <div className="talk-steps">
          <article><span className="step-no">01</span><h3>Tell Ana what you need.</h3><blockquote>“I need one adult ticket and one child ticket. Confirm the price and child-ticket rules.”</blockquote></article>
          <article><span className="step-no">02</span><h3>Ana handles the conversation.</h3><p>Ana identifies herself as AI, asks the other person for permission before the task starts, asks follow-ups and verifies important details.</p></article>
          <article><span className="step-no">03</span><h3>Ana hands back the result.</h3><p>You get a concise verified outcome, important facts and next steps — without digging through a transcript.</p></article>
        </div>
        <div className="goal-contract">
          <div className="goal-copy"><span>YOUR GOAL</span><strong>Get the right tickets for today.</strong><p>The reasoning model works out what matters. Deterministic safeguards decide whether Ana is allowed to finish.</p></div>
          <div className="goal-list"><span><i className="done"><Check size={13}/></i> Adult ticket price <b>Confirmed</b></span><span><i className="done"><Check size={13}/></i> Child-ticket rule <b>Confirmed</b></span><span><i className="clarify">?</i> Payment <b>Owner decision</b></span></div>
        </div>
      </section>

      <section className="how-section" id="how">
        <div className="section-heading split"><div><p className="overline">SIMPLE STEPS. REAL RESULTS.</p><h2>How Ana works</h2></div><p>Natural conversations. Meaningful outcomes.</p></div>
        <div className="how-grid">
          <article><div className="how-num">1</div><h3>Tell Ana your goal</h3><p>Speak or type naturally. Ana works out what matters and what can be discovered in the conversation.</p></article>
          <article><div className="how-num">2</div><h3>Ana translates, listens, or speaks for you</h3><p>Use simple translation, live interpretation or Talk for Me depending on the situation.</p></article>
          <article><div className="how-num">3</div><h3>You get the result</h3><p>Important facts come back clearly, with unresolved details labelled instead of guessed.</p></article>
        </div>
      </section>

      <section className="languages-section" id="languages">
        <div className="section-heading split"><div><p className="overline">A WORLD OF LANGUAGES</p><h2>Ana speaks the way<br/>real life sounds.</h2></div><p>Built around multilingual life — including Indian languages, English/German code-switching and regional German preferences.</p></div>
        <div className="language-cloud">{languages.map(language => <span key={language}><Globe2 size={13}/>{language}</span>)}</div>
        <p className="language-note">Speech quality can vary by language, accent, browser and environment. Ana does not claim identical speech performance across every language.</p>
      </section>

      <section className="trust-section" id="trust">
        <div className="trust-photo"><img src="https://images.pexels.com/photos/14769681/pexels-photo-14769681.jpeg?auto=compress&cs=tinysrgb&w=1500" alt="Family talking together in a bright living room"/><span className="hand-note inverse">More understanding.<br/>More possibilities.</span></div>
        <div className="trust-copy"><p className="overline">TRUST BEFORE AUTONOMY</p><h2>Built to speak for you.<br/><em>Built not to overstep.</em></h2><p>Ana is designed around transparency, data minimisation and user control — especially when it speaks on someone’s behalf.</p>
          <div className="trust-list"><span><ShieldCheck size={19}/><b>AI disclosure before Talk begins</b></span><span><UsersRound size={19}/><b>Counterparty permission before the actual task starts</b></span><span><Check size={19}/><b>Owner approval for payments, appointments and commitments</b></span><span><Sparkles size={19}/><b>Unresolved critical details can block completion</b></span></div>
          <small>Legal requirements vary by country and use case. Ana’s product design does not itself constitute legal compliance advice.</small>
        </div>
      </section>

      <section className="use-cases">
        <div className="section-heading"><p className="overline">BUILT FOR REAL LIFE</p><h2>Where language gets in the way,<br/><em>Ana helps you move forward.</em></h2></div>
        <div className="story-grid">{useCases.map(card => <article key={card.title}><img src={card.image} alt=""/><div><h3>{card.title}</h3><p>{card.text}</p></div></article>)}</div>
      </section>

      <section className="why-section">
        <p className="overline">WHY ANA</p><h2>Not word-first.<br/><em>Intent-first.</em></h2>
        <div className="why-grid"><span><b>Understands what you’re trying to achieve</b><p>Translation is a means, not the destination.</p></span><span><b>Understands context and cultural nuance</b><p>Different situations deserve different language.</p></span><span><b>Knows when to ask you</b><p>Routine dialogue can continue; important decisions come back to the owner.</p></span><span><b>Works beyond text</b><p>Voice, documents, camera, captions and multi-person conversations.</p></span><span><b>Trust is part of the interaction</b><p>Disclosure, permission and verification are designed into Talk for Me.</p></span></div>
      </section>

      <section className="final-cta" id="try-ana">
        <div className="final-paper"><AnaMark/><p className="overline">A MORE OPEN WORLD AWAITS.</p><h2>Your voice.<br/>Your intent.<br/><em>Any language.</em></h2><p>Ana is currently in private testing. Explore the product and see what multilingual communication can feel like when the technology understands the goal, not just the words.</p><a className="primary-cta" href={APP_URL}>Try Ana <ArrowRight size={18}/></a></div>
        <div className="final-visual"><img src="https://images.pexels.com/photos/11364987/pexels-photo-11364987.jpeg?auto=compress&cs=tinysrgb&w=1800" alt="Railway service area in Europe"/><span className="hand-note inverse">Same people.<br/>A bigger world.</span></div>
      </section>
    </main>

    <footer className="landing-footer"><AnaMark compact/><div><a href="#features">Product</a><a href="#trust">Privacy</a><a href="#languages">Languages</a><a href="mailto:hello@ana.example">Contact</a></div><span>© 2026 Ana</span></footer>
  </div>
}
