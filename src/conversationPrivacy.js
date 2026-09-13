import { getPrivacySettings } from './accountPreferences.js'

const SENSITIVE_PATTERN = /(doctor|clinic|hospital|medical|health|arzt|klinik|krankenhaus|buergeramt|behorde|authority|government|bank|insurance|versicherung|legal|contract|vertrag|school|schule|appointment|termin|passport|ausweis)/i

export const DISCLOSURE_COPY = {
  English: 'Ana is helping with this conversation. Speech is processed by an AI service while Ana is listening or translating. Please continue only if you are comfortable with that.',
  German: 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',
  'Swabian German (Schwäbisch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',
  'Bavarian German (Bairisch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',
  'Low German (Plattdeutsch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',
  Hindi: 'Ana is baatcheet mein madad kar rahi hai. Jab Ana sunti ya anuvaad karti hai, awaaz ko AI seva process karti hai. Kripya tabhi aage badhein jab aap isse sahaj hon.',
  Hinglish: 'Ana is conversation mein help kar rahi hai. Jab Ana sunti ya translate karti hai, speech ko AI service process karti hai. Please tabhi continue karein jab aap isse comfortable hon.',
  Bengali: 'Ana এই কথোপকথনে সাহায্য করছে। Ana যখন শোনে বা অনুবাদ করে, তখন কথাগুলো একটি AI পরিষেবা দ্বারা প্রক্রিয়া করা হয়। আপনি এতে স্বচ্ছন্দ হলে তবেই চালিয়ে যান।',
  Tamil: 'இந்த உரையாடலில் Ana உதவுகிறது. Ana கேட்கும் அல்லது மொழிபெயர்க்கும் போது, பேச்சு ஒரு AI சேவையால் செயலாக்கப்படுகிறது. இது உங்களுக்கு வசதியாக இருந்தால் மட்டுமே தொடரவும்.',
  Telugu: 'ఈ సంభాషణలో Ana సహాయం చేస్తోంది. Ana వింటున్నప్పుడు లేదా అనువదిస్తున్నప్పుడు, మాటలను AI సేవ ప్రాసెస్ చేస్తుంది. ఇది మీకు సౌకర్యంగా ఉంటే మాత్రమే కొనసాగండి.',
  Marathi: 'Ana या संभाषणात मदत करत आहे. Ana ऐकत असताना किंवा भाषांतर करत असताना, बोलणे AI सेवेद्वारे प्रक्रिया केले जाते. तुम्हाला हे मान्य असेल तरच पुढे सुरू ठेवा.',
  Gujarati: 'Ana આ વાતચીતમાં મદદ કરી રહી છે. Ana સાંભળે છે અથવા અનુવાદ કરે છે ત્યારે, બોલાયેલું AI સેવા દ્વારા પ્રક્રિયા કરવામાં આવે છે. તમને આ અનુકૂળ હોય ત્યારે જ આગળ વધો.',
  Punjabi: 'Ana ਇਸ ਗੱਲਬਾਤ ਵਿੱਚ ਮਦਦ ਕਰ ਰਹੀ ਹੈ। ਜਦੋਂ Ana ਸੁਣਦੀ ਜਾਂ ਅਨੁਵਾਦ ਕਰਦੀ ਹੈ, ਤਾਂ ਬੋਲੀ ਨੂੰ AI ਸੇਵਾ ਦੁਆਰਾ ਪ੍ਰੋਸੈਸ ਕੀਤਾ ਜਾਂਦਾ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਤਦ ਹੀ ਜਾਰੀ ਰੱਖੋ ਜੇ ਤੁਸੀਂ ਇਸ ਨਾਲ ਸੁਖੀ ਹੋ।',
  Malayalam: 'ഈ സംഭാഷണത്തിൽ Ana സഹായിക്കുന്നു. Ana കേൾക്കുകയോ വിവർത്തനം ചെയ്യുകയോ ചെയ്യുമ്പോൾ, സംസാരിച്ചത് ഒരു AI സേവനം പ്രോസസ്സ് ചെയ്യുന്നു. ഇത് നിങ്ങൾക്ക് സമ്മതമാണെങ്കിൽ മാത്രം തുടരുക.',
  Kannada: 'ಈ ಸಂಭಾಷಣೆಯಲ್ಲಿ Ana ಸಹಾಯ ಮಾಡುತ್ತಿದೆ. Ana ಕೇಳುವಾಗ ಅಥವಾ ಅನುವಾದಿಸುವಾಗ, ಮಾತನ್ನು AI ಸೇವೆ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುತ್ತದೆ. ಇದು ನಿಮಗೆ ಅನುಕೂಲಕರವಾಗಿದ್ದರೆ ಮಾತ್ರ ಮುಂದುವರಿಯಿರಿ.',
  Urdu: 'Ana اس گفتگو میں مدد کر رہی ہے۔ جب Ana سنتی یا ترجمہ کرتی ہے تو گفتگو کو AI سروس کے ذریعے پروسیس کیا جاتا ہے۔ براہِ کرم صرف اسی صورت میں جاری رکھیں جب آپ اس سے مطمئن ہوں۔',
  French: 'Ana aide dans cette conversation. La parole est traitée par un service d’IA pendant qu’Ana écoute ou traduit. Continuez uniquement si cela vous convient.',
  Spanish: 'Ana está ayudando con esta conversación. La voz se procesa mediante un servicio de IA mientras Ana escucha o traduce. Continúe solo si se siente cómodo con ello.',
  Italian: 'Ana sta aiutando in questa conversazione. La voce viene elaborata da un servizio di IA mentre Ana ascolta o traduce. Continui solo se si sente a suo agio.',
}

export function isSensitiveConversation(text = '') {
  return SENSITIVE_PATTERN.test(String(text || ''))
}

export function shouldRequireDisclosure(context = '') {
  const settings = getPrivacySettings()
  if (settings.disclosureMode === 'always') return true
  return isSensitiveConversation(context)
}

export function isExtraPrivacyConversation(context = '') {
  const settings = getPrivacySettings()
  return settings.extraPrivacySensitive !== false && isSensitiveConversation(context)
}

export function privacyRealtimePolicy(instructions = '') {
  const text = String(instructions || '')
  const isTalk = text.includes("live speech-to-speech agent speaking to another person on the user's behalf") || text.includes("USER'S GOAL / BRIEF:")
  if (!isTalk) return ''

  const briefMatch = text.match(/USER'S GOAL \/ BRIEF:\s*([\s\S]*?)(?:\n\nKNOWN FACTS:|\n\nCRITICAL FACT)/i)
  const context = briefMatch?.[1] || text
  const settings = getPrivacySettings()
  const extraPrivacy = settings.extraPrivacySensitive !== false && isSensitiveConversation(context)

  return `\n\nPRIVACY & TRANSPARENCY:\n- The owner is shown a privacy disclosure before the microphone starts.\n- If the other person asks what Ana is doing, explain briefly that Ana is an AI communication assistant and speech is processed by an AI service while Ana helps with the conversation.\n- Never claim that continuing creates legal consent.\n- If the other person objects to AI processing or asks to stop, stop pursuing the task and call ask_owner so the owner can decide how to proceed.\n- Do not add conversation content to personal language memory. Personal memory is only for language preferences, terminology and communication settings.${extraPrivacy ? '\n- EXTRA PRIVACY MODE applies here: minimise repetition of sensitive details and use them only when needed for accuracy or task completion.' : ''}`
}

export function minimiseSensitiveDebriefRequest(body) {
  if (!body || typeof body !== 'object' || typeof body.text !== 'string') return body
  if (!body.text.includes("OWNER'S ORIGINAL GOAL:") || !body.text.includes('CONVERSATION TRANSCRIPT:')) return body

  const goalMatch = body.text.match(/OWNER'S ORIGINAL GOAL:\s*([\s\S]*?)(?:\n\nSTRUCTURED CRITICAL FACTS:)/i)
  const goal = goalMatch?.[1] || ''
  if (!isExtraPrivacyConversation(goal)) return body

  const next = { ...body }
  next.text = body.text.replace(
    /(CONVERSATION TRANSCRIPT:\s*)[\s\S]*?(\n\nThe conversation\s)/i,
    '$1(Omitted by Ana extra privacy mode. Use the structured confirmed facts above.)$2',
  )
  return next
}
