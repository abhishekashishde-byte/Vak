export const TALK_NOTICE_VERSION = 'talk-ai-disclosure-v1-2026-09-13'
const RECEIPT_KEY = 'ana-talk-permission-receipts-v1'

export const TALK_DISCLOSURE_COPY = {
  English: "Hello. I'm Ana, an AI communication assistant speaking on behalf of the person here. While I help, your speech is processed by an AI service. Is it okay to continue?",
  German: 'Hallo. Ich bin Ana, eine KI-Kommunikationsassistentin, und spreche im Auftrag der Person hier. Während ich helfe, wird Ihre Sprache von einem KI-Dienst verarbeitet. Ist es für Sie in Ordnung, fortzufahren?',
  'Swabian German (Schwäbisch)': 'Hallo. Ich bin Ana, eine KI-Kommunikationsassistentin, und spreche im Auftrag der Person hier. Während ich helfe, wird Ihre Sprache von einem KI-Dienst verarbeitet. Ist es für Sie in Ordnung, fortzufahren?',
  'Bavarian German (Bairisch)': 'Hallo. Ich bin Ana, eine KI-Kommunikationsassistentin, und spreche im Auftrag der Person hier. Während ich helfe, wird Ihre Sprache von einem KI-Dienst verarbeitet. Ist es für Sie in Ordnung, fortzufahren?',
  'Low German (Plattdeutsch)': 'Hallo. Ich bin Ana, eine KI-Kommunikationsassistentin, und spreche im Auftrag der Person hier. Während ich helfe, wird Ihre Sprache von einem KI-Dienst verarbeitet. Ist es für Sie in Ordnung, fortzufahren?',
  Hindi: 'नमस्ते। मैं Ana हूँ, एक AI संचार सहायक, और यहाँ मौजूद व्यक्ति की ओर से बात कर रही हूँ। मेरी सहायता के दौरान आपकी आवाज़ को एक AI सेवा द्वारा संसाधित किया जाता है। क्या आप बातचीत जारी रखने के लिए सहमत हैं?',
  Hinglish: 'Namaste. Main Ana hoon, ek AI communication assistant, aur yahan maujood vyakti ki taraf se baat kar rahi hoon. Jab main help karti hoon, aapki speech ko ek AI service process karti hai. Kya aap conversation continue karne ke liye comfortable hain?',
  Bengali: 'নমস্কার। আমি Ana, একটি AI যোগাযোগ সহায়ক, এবং এখানে থাকা ব্যক্তির পক্ষ থেকে কথা বলছি। আমি সাহায্য করার সময় আপনার কথা একটি AI পরিষেবা দ্বারা প্রক্রিয়া করা হয়। আপনি কি কথোপকথন চালিয়ে যেতে সম্মত?',
  Tamil: 'வணக்கம். நான் Ana, ஒரு AI தொடர்பு உதவியாளர்; இங்கு உள்ள நபரின் சார்பாக பேசுகிறேன். நான் உதவும் போது உங்கள் பேச்சு ஒரு AI சேவையால் செயலாக்கப்படுகிறது. தொடர்வது உங்களுக்கு சரியா?',
  Telugu: 'నమస్కారం. నేను Ana, ఒక AI కమ్యూనికేషన్ సహాయకురాలిని, ఇక్కడ ఉన్న వ్యక్తి తరఫున మాట్లాడుతున్నాను. నేను సహాయం చేస్తున్నప్పుడు మీ మాటలను AI సేవ ప్రాసెస్ చేస్తుంది. కొనసాగడానికి మీరు సమ్మతిస్తున్నారా?',
  Marathi: 'नमस्कार. मी Ana आहे, एक AI संवाद सहाय्यक, आणि येथे असलेल्या व्यक्तीच्या वतीने बोलत आहे. मी मदत करत असताना तुमचे बोलणे AI सेवेद्वारे प्रक्रिया केले जाते. पुढे सुरू ठेवण्यास तुम्ही सहमत आहात का?',
  Gujarati: 'નમસ્તે. હું Ana છું, એક AI સંચાર સહાયક, અને અહીં હાજર વ્યક્તિ તરફથી વાત કરી રહી છું. હું મદદ કરતી વખતે તમારી વાતને AI સેવા દ્વારા પ્રોસેસ કરવામાં આવે છે. શું તમે વાતચીત ચાલુ રાખવા સંમત છો?',
  Punjabi: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ। ਮੈਂ Ana ਹਾਂ, ਇੱਕ AI ਸੰਚਾਰ ਸਹਾਇਕ, ਅਤੇ ਇੱਥੇ ਮੌਜੂਦ ਵਿਅਕਤੀ ਦੀ ਓਰੋਂ ਗੱਲ ਕਰ ਰਹੀ ਹਾਂ। ਜਦੋਂ ਮੈਂ ਮਦਦ ਕਰਦੀ ਹਾਂ, ਤੁਹਾਡੀ ਬੋਲੀ ਨੂੰ AI ਸੇਵਾ ਦੁਆਰਾ ਪ੍ਰੋਸੈਸ ਕੀਤਾ ਜਾਂਦਾ ਹੈ। ਕੀ ਤੁਸੀਂ ਗੱਲਬਾਤ ਜਾਰੀ ਰੱਖਣ ਲਈ ਸਹਿਮਤ ਹੋ?',
  Malayalam: 'നമസ്കാരം. ഞാൻ Ana ആണ്, ഒരു AI ആശയവിനിമയ സഹായി, ഇവിടെ ഉള്ള വ്യക്തിയുടെ പേരിൽ സംസാരിക്കുകയാണ്. ഞാൻ സഹായിക്കുമ്പോൾ നിങ്ങളുടെ സംസാരത്തെ ഒരു AI സേവനം പ്രോസസ്സ് ചെയ്യുന്നു. തുടരാൻ നിങ്ങൾ സമ്മതിക്കുന്നുണ്ടോ?',
  Kannada: 'ನಮಸ್ಕಾರ. ನಾನು Ana, ಒಂದು AI ಸಂವಹನ ಸಹಾಯಕಿ, ಇಲ್ಲಿ ಇರುವ ವ್ಯಕ್ತಿಯ ಪರವಾಗಿ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನಾನು ಸಹಾಯ ಮಾಡುವಾಗ ನಿಮ್ಮ ಮಾತನ್ನು AI ಸೇವೆ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುತ್ತದೆ. ಮುಂದುವರಿಸಲು ನೀವು ಒಪ್ಪುತ್ತೀರಾ?',
  Urdu: 'سلام۔ میں Ana ہوں، ایک AI مواصلاتی معاون، اور یہاں موجود شخص کی طرف سے بات کر رہی ہوں۔ جب میں مدد کرتی ہوں تو آپ کی گفتگو کو ایک AI سروس پراسیس کرتی ہے۔ کیا آپ گفتگو جاری رکھنے پر رضامند ہیں؟',
  French: "Bonjour. Je suis Ana, une assistante de communication utilisant l'IA, et je parle au nom de la personne présente. Pendant mon aide, votre voix est traitée par un service d'IA. Êtes-vous d'accord pour continuer ?",
  Spanish: 'Hola. Soy Ana, una asistente de comunicación con IA, y hablo en nombre de la persona que está aquí. Mientras ayudo, un servicio de IA procesa su voz. ¿Está de acuerdo en continuar?',
  Italian: 'Salve. Sono Ana, un’assistente di comunicazione basata sull’IA, e parlo per conto della persona qui presente. Mentre aiuto, la sua voce viene elaborata da un servizio di IA. È d’accordo a continuare?',
}

export function getTalkDisclosure(language) {
  return TALK_DISCLOSURE_COPY[language] || TALK_DISCLOSURE_COPY.English
}

export function createTalkPermissionSession(language) {
  return {
    sessionId: globalThis.crypto?.randomUUID?.() || `talk-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    noticeVersion: TALK_NOTICE_VERSION,
    language: TALK_DISCLOSURE_COPY[language] ? language : 'English',
    startedAt: new Date().toISOString(),
  }
}

export function recordTalkPermissionOutcome(session, outcome) {
  if (!session || !['accepted', 'declined', 'withdrawn'].includes(outcome)) return null
  const receipt = {
    sessionId: session.sessionId,
    noticeVersion: session.noticeVersion,
    language: session.language,
    startedAt: session.startedAt,
    decisionAt: new Date().toISOString(),
    outcome,
  }

  try {
    const current = JSON.parse(localStorage.getItem(RECEIPT_KEY) || '[]')
    const receipts = Array.isArray(current) ? current : []
    localStorage.setItem(RECEIPT_KEY, JSON.stringify([...receipts, receipt].slice(-50)))
  } catch {}
  return receipt
}
