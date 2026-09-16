import { useMemo, useState } from 'react'
import { Check, Clipboard, Search, Volume2, WifiOff } from 'lucide-react'

const BASE = [
  { id: 'help', category: 'Emergency', meaning: 'Please help me.' },
  { id: 'ambulance', category: 'Emergency', meaning: 'Please call an ambulance.' },
  { id: 'police', category: 'Emergency', meaning: 'Please call the police.' },
  { id: 'doctor', category: 'Medical', meaning: 'I need a doctor.' },
  { id: 'breathing', category: 'Medical', meaning: 'I am having trouble breathing.' },
  { id: 'allergy', category: 'Medical', meaning: 'I have an allergy.' },
  { id: 'medication', category: 'Medical', meaning: 'I take this medication.' },
  { id: 'child', category: 'Medical', meaning: 'My child is sick.' },
  { id: 'lost', category: 'Travel', meaning: 'I am lost.' },
  { id: 'station', category: 'Travel', meaning: 'Where is the nearest train station?' },
  { id: 'address', category: 'Travel', meaning: 'Please show me this address.' },
  { id: 'toilet', category: 'Essentials', meaning: 'Where is the toilet?' },
  { id: 'water', category: 'Essentials', meaning: 'I need drinking water.' },
  { id: 'understand', category: 'Essentials', meaning: "I don't understand. Please speak slowly." },
  { id: 'internet', category: 'Essentials', meaning: 'My phone has no internet connection.' },
]

const PACKS = {
  English: {
    locale: 'en-US',
    phrases: Object.fromEntries(BASE.map(item => [item.id, item.meaning])),
  },
  German: {
    locale: 'de-DE',
    phrases: {
      help: 'Bitte helfen Sie mir.',
      ambulance: 'Bitte rufen Sie einen Krankenwagen.',
      police: 'Bitte rufen Sie die Polizei.',
      doctor: 'Ich brauche ärztliche Hilfe.',
      breathing: 'Ich bekomme schlecht Luft.',
      allergy: 'Ich habe eine Allergie.',
      medication: 'Ich nehme dieses Medikament.',
      child: 'Mein Kind ist krank.',
      lost: 'Ich habe mich verlaufen.',
      station: 'Wo ist der nächste Bahnhof?',
      address: 'Bitte zeigen Sie mir diese Adresse.',
      toilet: 'Wo ist die Toilette?',
      water: 'Ich brauche Trinkwasser.',
      understand: 'Ich verstehe Sie nicht. Bitte sprechen Sie langsam.',
      internet: 'Mein Handy hat keine Internetverbindung.',
    },
  },
  French: {
    locale: 'fr-FR',
    phrases: {
      help: 'Aidez-moi, s’il vous plaît.',
      ambulance: 'Appelez une ambulance, s’il vous plaît.',
      police: 'Appelez la police, s’il vous plaît.',
      doctor: 'J’ai besoin d’un médecin.',
      breathing: 'J’ai du mal à respirer.',
      allergy: 'J’ai une allergie.',
      medication: 'Je prends ce médicament.',
      child: 'Mon enfant est malade.',
      lost: 'Je suis perdu(e).',
      station: 'Où est la gare la plus proche ?',
      address: 'Veuillez me montrer cette adresse.',
      toilet: 'Où sont les toilettes ?',
      water: 'J’ai besoin d’eau potable.',
      understand: 'Je ne comprends pas. Parlez lentement, s’il vous plaît.',
      internet: 'Mon téléphone n’a pas de connexion Internet.',
    },
  },
  Spanish: {
    locale: 'es-ES',
    phrases: {
      help: 'Por favor, ayúdeme.',
      ambulance: 'Por favor, llame a una ambulancia.',
      police: 'Por favor, llame a la policía.',
      doctor: 'Necesito un médico.',
      breathing: 'Me cuesta respirar.',
      allergy: 'Tengo una alergia.',
      medication: 'Tomo este medicamento.',
      child: 'Mi hijo está enfermo.',
      lost: 'Estoy perdido/a.',
      station: '¿Dónde está la estación de tren más cercana?',
      address: 'Por favor, muéstreme esta dirección.',
      toilet: '¿Dónde está el baño?',
      water: 'Necesito agua potable.',
      understand: 'No entiendo. Por favor, hable despacio.',
      internet: 'Mi teléfono no tiene conexión a Internet.',
    },
  },
  Italian: {
    locale: 'it-IT',
    phrases: {
      help: 'Per favore, mi aiuti.',
      ambulance: 'Chiami un’ambulanza, per favore.',
      police: 'Chiami la polizia, per favore.',
      doctor: 'Ho bisogno di un medico.',
      breathing: 'Faccio fatica a respirare.',
      allergy: 'Ho un’allergia.',
      medication: 'Prendo questo farmaco.',
      child: 'Mio figlio è malato.',
      lost: 'Mi sono perso/a.',
      station: 'Dov’è la stazione ferroviaria più vicina?',
      address: 'Per favore, mi mostri questo indirizzo.',
      toilet: 'Dov’è il bagno?',
      water: 'Ho bisogno di acqua potabile.',
      understand: 'Non capisco. Per favore, parli lentamente.',
      internet: 'Il mio telefono non ha connessione a Internet.',
    },
  },
  Hindi: {
    locale: 'hi-IN',
    phrases: {
      help: 'कृपया मेरी मदद कीजिए।',
      ambulance: 'कृपया एम्बुलेंस बुलाइए।',
      police: 'कृपया पुलिस को बुलाइए।',
      doctor: 'मुझे डॉक्टर की ज़रूरत है।',
      breathing: 'मुझे साँस लेने में दिक्कत हो रही है।',
      allergy: 'मुझे एलर्जी है।',
      medication: 'मैं यह दवा लेता/लेती हूँ।',
      child: 'मेरा बच्चा बीमार है।',
      lost: 'मैं रास्ता भटक गया/गई हूँ।',
      station: 'सबसे नज़दीकी रेलवे स्टेशन कहाँ है?',
      address: 'कृपया मुझे यह पता दिखाइए।',
      toilet: 'शौचालय कहाँ है?',
      water: 'मुझे पीने का पानी चाहिए।',
      understand: 'मैं समझ नहीं पा रहा/रही हूँ। कृपया धीरे बोलिए।',
      internet: 'मेरे फोन में इंटरनेट नहीं है।',
    },
  },
  Hinglish: {
    locale: 'en-IN',
    phrases: {
      help: 'Kripya meri madad kijiye.',
      ambulance: 'Kripya ambulance bulaiye.',
      police: 'Kripya police ko bulaiye.',
      doctor: 'Mujhe doctor ki zarurat hai.',
      breathing: 'Mujhe saans lene mein dikkat ho rahi hai.',
      allergy: 'Mujhe allergy hai.',
      medication: 'Main yeh dawa leta/leti hoon.',
      child: 'Mera bachcha beemar hai.',
      lost: 'Main rasta bhatak gaya/gayi hoon.',
      station: 'Sabse nazdeeki railway station kahan hai?',
      address: 'Kripya mujhe yeh address dikhaiye.',
      toilet: 'Toilet kahan hai?',
      water: 'Mujhe peene ka paani chahiye.',
      understand: 'Main samajh nahi pa raha/rahi hoon. Kripya dheere boliye.',
      internet: 'Mere phone mein internet nahi hai.',
    },
  },
}

const CATEGORIES = ['All', 'Emergency', 'Medical', 'Travel', 'Essentials']

export default function EmergencyPhrasebook() {
  const [language, setLanguage] = useState('German')
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('')
  const pack = PACKS[language]

  const phrases = useMemo(() => BASE.filter(item => {
    const translated = pack.phrases[item.id] || ''
    const matchesCategory = category === 'All' || item.category === category
    const needle = query.trim().toLocaleLowerCase()
    const matchesQuery = !needle || item.meaning.toLocaleLowerCase().includes(needle) || translated.toLocaleLowerCase().includes(needle)
    return matchesCategory && matchesQuery
  }), [category, query, pack])

  const speak = text => {
    if (!('speechSynthesis' in window) || !text) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = pack.locale
    utterance.rate = 0.9
    window.speechSynthesis.speak(utterance)
  }

  const copy = async item => {
    const text = pack.phrases[item.id] || ''
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(item.id)
    setTimeout(() => setCopied(''), 1400)
  }

  return <section className="ana-emergency-shell">
    <header className="ana-emergency-head">
      <div className="ana-emergency-title"><span><WifiOff size={18}/></span><div><h1>Offline emergency phrases</h1><p>Core phrases stored with Ana — no AI or internet connection required.</p></div></div>
      <label><span>Language</span><select value={language} onChange={event => setLanguage(event.target.value)}>{Object.keys(PACKS).map(item => <option key={item}>{item}</option>)}</select></label>
    </header>

    <div className="ana-emergency-tools">
      <div className="ana-emergency-categories">{CATEGORIES.map(item => <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
      <label className="ana-emergency-search"><Search size={14}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search phrases"/></label>
    </div>

    <div className="ana-emergency-grid">
      {phrases.map(item => <article className="ana-emergency-card" key={item.id}>
        <span className="ana-emergency-category">{item.category}</span>
        <strong>{pack.phrases[item.id]}</strong>
        {language !== 'English' && <p>{item.meaning}</p>}
        <div><button type="button" onClick={() => speak(pack.phrases[item.id])}><Volume2 size={14}/>Speak</button><button type="button" onClick={() => copy(item)}>{copied === item.id ? <Check size={14}/> : <Clipboard size={14}/>} {copied === item.id ? 'Copied' : 'Copy'}</button></div>
      </article>)}
    </div>

    <footer className="ana-emergency-foot">For an actual emergency, contact the local emergency service as soon as you can. These phrases are communication aids, not medical or legal advice.</footer>
  </section>
}
