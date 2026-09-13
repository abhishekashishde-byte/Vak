import fs from 'node:fs'

const expandedTargets = "['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']"
const expandedCaptionTargets = "['Original only', 'German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)', 'English', 'Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu', 'French', 'Spanish', 'Italian']"

function patch(path, apply) {
  const before = fs.readFileSync(path, 'utf8')
  const after = apply(before)
  if (after === before) throw new Error(`No change made to ${path}`)
  fs.writeFileSync(path, after)
}

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing pattern: ${label}`)
  return text.replace(from, to)
}

patch('src/App.jsx', text => {
  text = replaceRequired(text,
    "const TARGETS = ['German', 'English', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']",
    `const TARGETS = ${expandedTargets}`,
    'App TARGETS')
  text = replaceRequired(text,
    "const DRAFT_KEY = 'ana-translate-draft-v1'",
    `const DRAFT_KEY = 'ana-translate-draft-v1'\nconst GERMAN_TARGETS = new Set(['German', 'Swabian German (Schwäbisch)', 'Bavarian German (Bairisch)', 'Low German (Plattdeutsch)'])\nconst isGermanTarget = value => GERMAN_TARGETS.has(value)\nconst germanVariantRule = value => value === 'Swabian German (Schwäbisch)'\n  ? 'Use natural Swabian German (Schwäbisch) as spoken in Baden-Württemberg. Keep it authentic but readable and avoid caricature.'\n  : value === 'Bavarian German (Bairisch)'\n    ? 'Use natural Bavarian German (Bairisch) as spoken in Bavaria. Keep it authentic but readable and avoid caricature.'\n    : value === 'Low German (Plattdeutsch)'\n      ? 'Use natural Low German (Plattdeutsch), not Standard German. Keep it understandable and avoid invented dialect spellings.'\n      : 'Use flawless Standard German (Hochdeutsch) as written in Germany.'`,
    'App German helpers')
  text = replaceRequired(text,
    "if (target === 'German') instructions += `\\nUse flawless Standard German as written in Germany. ${registerRules()}`",
    "if (isGermanTarget(target)) instructions += `\\n${germanVariantRule(target)} ${registerRules()}`",
    'App German translation rule')
  text = replaceRequired(text,
    "if (target === 'German') instructions += ` ${registerRules()}`",
    "if (isGermanTarget(target)) instructions += ` ${germanVariantRule(target)} ${registerRules()}`",
    'App German editor rule')
  text = replaceRequired(text,
    "{target === 'German' && <div className=\"segmented\">",
    "{isGermanTarget(target) && <div className=\"segmented\">",
    'App German register UI')
  return text
})

patch('src/LiveMode.jsx', text => {
  text = replaceRequired(text,
`const LANGS = [
  { name: 'English', iso: 'en' },
  { name: 'German', iso: 'de' },
  { name: 'Hindi', iso: 'hi' },
  { name: 'French', iso: 'fr' },
  { name: 'Spanish', iso: 'es' },
  { name: 'Italian', iso: 'it' },
]`,
`const LANGS = [
  { name: 'English', iso: 'en' },
  { name: 'German', iso: 'de' },
  { name: 'Swabian German (Schwäbisch)', iso: 'de' },
  { name: 'Bavarian German (Bairisch)', iso: 'de' },
  { name: 'Low German (Plattdeutsch)', iso: 'de' },
  { name: 'Hindi', iso: 'hi' },
  { name: 'Hinglish', iso: 'hi' },
  { name: 'Bengali', iso: 'bn' },
  { name: 'Tamil', iso: 'ta' },
  { name: 'Telugu', iso: 'te' },
  { name: 'Marathi', iso: 'mr' },
  { name: 'Gujarati', iso: 'gu' },
  { name: 'Punjabi', iso: 'pa' },
  { name: 'Malayalam', iso: 'ml' },
  { name: 'Kannada', iso: 'kn' },
  { name: 'Urdu', iso: 'ur' },
  { name: 'French', iso: 'fr' },
  { name: 'Spanish', iso: 'es' },
  { name: 'Italian', iso: 'it' },
]
const INDIAN_SPEECH_LANGS = new Set(['Hindi', 'Hinglish', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Punjabi', 'Malayalam', 'Kannada', 'Urdu'])`,
    'Live LANGS')
  text = replaceRequired(text,
    "${languageA === 'Hindi' || languageB === 'Hindi' ? '- When Hindi is one side, Roman-script Hindi/Hinglish and ordinary Hindi-English code-switching belong to the Hindi side when the speaker is fundamentally speaking Hindi. Do not force Roman Hindi into English merely because it uses Latin letters.\\n' : ''}",
    "${INDIAN_SPEECH_LANGS.has(languageA) || INDIAN_SPEECH_LANGS.has(languageB) ? '- Natural code-switching with English or German is normal for Indian-language speakers. Determine the intended language from the whole utterance rather than a borrowed word. For Hinglish, treat Roman-script conversational Hindi as the Hindi side and never mistake Latin script alone for English.\\n' : ''}",
    'Live code-switching rule')
  return text
})

patch('src/RoomMode.jsx', text => {
  text = replaceRequired(text,
    "const LANGUAGES = ['English', 'German', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']",
    `const LANGUAGES = ${expandedTargets}`,
    'Room LANGUAGES')
  text = replaceRequired(text,
`  German: 'de-DE',
  Hindi: 'hi-IN',
  Hinglish: 'hi-IN',
  French: 'fr-FR',`,
`  German: 'de-DE',
  'Swabian German (Schwäbisch)': 'de-DE',
  'Bavarian German (Bairisch)': 'de-DE',
  'Low German (Plattdeutsch)': 'de-DE',
  Hindi: 'hi-IN',
  Hinglish: 'hi-IN',
  Bengali: 'bn-IN',
  Tamil: 'ta-IN',
  Telugu: 'te-IN',
  Marathi: 'mr-IN',
  Gujarati: 'gu-IN',
  Punjabi: 'pa-IN',
  Malayalam: 'ml-IN',
  Kannada: 'kn-IN',
  Urdu: 'ur-IN',
  French: 'fr-FR',`,
    'Room speech locales')
  return text
})

patch('src/CaptionsMode.jsx', text => replaceRequired(text,
  "const TARGETS = ['Original only', 'English', 'German', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']",
  `const TARGETS = ${expandedCaptionTargets}`,
  'Captions TARGETS'))

patch('src/CameraMode.jsx', text => replaceRequired(text,
  "const TARGETS = ['German', 'English', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']",
  `const TARGETS = ${expandedTargets}`,
  'Camera TARGETS'))

patch('src/ScanMode.jsx', text => replaceRequired(text,
  "const TARGETS = ['German', 'English', 'Hindi', 'Hinglish', 'French', 'Spanish', 'Italian']",
  `const TARGETS = ${expandedTargets}`,
  'Scan TARGETS'))

patch('src/TalkForMeRealtime.jsx', text => {
  text = replaceRequired(text,
`const HOME_LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'Hinglish', code: 'hi-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]`,
`const HOME_LANGS = [
  { name: 'English', code: 'en-US' },
  { name: 'German', code: 'de-DE' },
  { name: 'Swabian German (Schwäbisch)', code: 'de-DE' },
  { name: 'Bavarian German (Bairisch)', code: 'de-DE' },
  { name: 'Low German (Plattdeutsch)', code: 'de-DE' },
  { name: 'Hindi', code: 'hi-IN' },
  { name: 'Hinglish', code: 'hi-IN' },
  { name: 'Bengali', code: 'bn-IN' },
  { name: 'Tamil', code: 'ta-IN' },
  { name: 'Telugu', code: 'te-IN' },
  { name: 'Marathi', code: 'mr-IN' },
  { name: 'Gujarati', code: 'gu-IN' },
  { name: 'Punjabi', code: 'pa-IN' },
  { name: 'Malayalam', code: 'ml-IN' },
  { name: 'Kannada', code: 'kn-IN' },
  { name: 'Urdu', code: 'ur-IN' },
  { name: 'French', code: 'fr-FR' },
  { name: 'Spanish', code: 'es-ES' },
  { name: 'Italian', code: 'it-IT' },
]`,
    'Talk HOME_LANGS')
  text = replaceRequired(text,
    "const OTHER_LANGS = HOME_LANGS.filter(x => x.name !== 'Hinglish')",
    'const OTHER_LANGS = [...HOME_LANGS]',
    'Talk OTHER_LANGS')
  text = replaceRequired(text,
`const isoFor = language => ({
  English: 'en', German: 'de', Hindi: 'hi', French: 'fr', Spanish: 'es', Italian: 'it',
}[language] || 'en')`,
`const isoFor = language => ({
  English: 'en', German: 'de', 'Swabian German (Schwäbisch)': 'de', 'Bavarian German (Bairisch)': 'de', 'Low German (Plattdeutsch)': 'de',
  Hindi: 'hi', Hinglish: 'hi', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa', Malayalam: 'ml', Kannada: 'kn', Urdu: 'ur',
  French: 'fr', Spanish: 'es', Italian: 'it',
}[language] || 'en')`,
    'Talk isoFor')
  const homeEnum = 'English|German|Swabian German (Schwäbisch)|Bavarian German (Bairisch)|Low German (Plattdeutsch)|Hindi|Hinglish|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian'
  const otherEnum = 'German|English|Swabian German (Schwäbisch)|Bavarian German (Bairisch)|Low German (Plattdeutsch)|Hindi|Hinglish|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian|'
  text = text.replaceAll('English|German|Hindi|Hinglish|French|Spanish|Italian', homeEnum)
  text = text.replaceAll('German|English|Hindi|French|Spanish|Italian|', otherEnum)
  return text
})

patch('src/personalLanguageMemory.js', text => {
  const withHinglish = 'English|German|Swabian German \\(Schwäbisch\\)|Bavarian German \\(Bairisch\\)|Low German \\(Plattdeutsch\\)|Hindi|Hinglish|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian'
  const withoutHinglish = 'English|German|Swabian German \\(Schwäbisch\\)|Bavarian German \\(Bairisch\\)|Low German \\(Plattdeutsch\\)|Hindi|Bengali|Tamil|Telugu|Marathi|Gujarati|Punjabi|Malayalam|Kannada|Urdu|French|Spanish|Italian'
  text = text.replaceAll('English|German|Hindi|Hinglish|French|Spanish|Italian', withHinglish)
  text = text.replaceAll('English|German|Hindi|French|Spanish|Italian', withoutHinglish)
  return text
})

patch('src/networkResilience.js', text => {
  text = replaceRequired(text,
    "const targetCodes = { English: 'en', German: 'de', Hindi: 'hi', French: 'fr', Spanish: 'es', Italian: 'it' }",
    "const targetCodes = { English: 'en', German: 'de', Hindi: 'hi', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa', Malayalam: 'ml', Kannada: 'kn', Urdu: 'ur', French: 'fr', Spanish: 'es', Italian: 'it' }",
    'Offline target codes')
  text = replaceRequired(text,
    "if (!text?.trim() || !targetLanguage || target === 'Hinglish') return null",
    "if (!text?.trim() || !targetLanguage || target === 'Hinglish' || target.includes('German (') || target.startsWith('Swabian German') || target.startsWith('Bavarian German') || target.startsWith('Low German')) return null",
    'Offline dialect safeguard')
  return text
})

patch('src/conversationPrivacy.js', text => {
  text = replaceRequired(text,
    "  German: 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',",
    "  German: 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',\n  'Swabian German (Schwäbisch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',\n  'Bavarian German (Bairisch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',\n  'Low German (Plattdeutsch)': 'Ana hilft bei diesem Gespräch. Sprache wird von einem KI-Dienst verarbeitet, während Ana zuhört oder übersetzt. Bitte fahren Sie nur fort, wenn das für Sie in Ordnung ist.',",
    'Privacy German variants')
  text = replaceRequired(text,
    "  Hinglish: 'Ana is conversation mein help kar rahi hai. Jab Ana sunti ya translate karti hai, speech ko AI service process karti hai. Please tabhi continue karein jab aap isse comfortable hon.',",
    "  Hinglish: 'Ana is conversation mein help kar rahi hai. Jab Ana sunti ya translate karti hai, speech ko AI service process karti hai. Please tabhi continue karein jab aap isse comfortable hon.',\n  Bengali: 'Ana এই কথোপকথনে সাহায্য করছে। Ana যখন শোনে বা অনুবাদ করে, তখন কথাগুলো একটি AI পরিষেবা দ্বারা প্রক্রিয়া করা হয়। আপনি এতে স্বচ্ছন্দ হলে তবেই চালিয়ে যান।',\n  Tamil: 'இந்த உரையாடலில் Ana உதவுகிறது. Ana கேட்கும் அல்லது மொழிபெயர்க்கும் போது, பேச்சு ஒரு AI சேவையால் செயலாக்கப்படுகிறது. இது உங்களுக்கு வசதியாக இருந்தால் மட்டுமே தொடரவும்.',\n  Telugu: 'ఈ సంభాషణలో Ana సహాయం చేస్తోంది. Ana వింటున్నప్పుడు లేదా అనువదిస్తున్నప్పుడు, మాటలను AI సేవ ప్రాసెస్ చేస్తుంది. ఇది మీకు సౌకర్యంగా ఉంటే మాత్రమే కొనసాగండి.',\n  Marathi: 'Ana या संभाषणात मदत करत आहे. Ana ऐकत असताना किंवा भाषांतर करत असताना, बोलणे AI सेवेद्वारे प्रक्रिया केले जाते. तुम्हाला हे मान्य असेल तरच पुढे सुरू ठेवा.',\n  Gujarati: 'Ana આ વાતચીતમાં મદદ કરી રહી છે. Ana સાંભળે છે અથવા અનુવાદ કરે છે ત્યારે, બોલાયેલું AI સેવા દ્વારા પ્રક્રિયા કરવામાં આવે છે. તમને આ અનુકૂળ હોય ત્યારે જ આગળ વધો.',\n  Punjabi: 'Ana ਇਸ ਗੱਲਬਾਤ ਵਿੱਚ ਮਦਦ ਕਰ ਰਹੀ ਹੈ। ਜਦੋਂ Ana ਸੁਣਦੀ ਜਾਂ ਅਨੁਵਾਦ ਕਰਦੀ ਹੈ, ਤਾਂ ਬੋਲੀ ਨੂੰ AI ਸੇਵਾ ਦੁਆਰਾ ਪ੍ਰੋਸੈਸ ਕੀਤਾ ਜਾਂਦਾ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਤਦ ਹੀ ਜਾਰੀ ਰੱਖੋ ਜੇ ਤੁਸੀਂ ਇਸ ਨਾਲ ਸੁਖੀ ਹੋ।',\n  Malayalam: 'ഈ സംഭാഷണത്തിൽ Ana സഹായിക്കുന്നു. Ana കേൾക്കുകയോ വിവർത്തനം ചെയ്യുകയോ ചെയ്യുമ്പോൾ, സംസാരിച്ചത് ഒരു AI സേവനം പ്രോസസ്സ് ചെയ്യുന്നു. ഇത് നിങ്ങൾക്ക് സമ്മതമാണെങ്കിൽ മാത്രം തുടരുക.',\n  Kannada: 'ಈ ಸಂಭಾಷಣೆಯಲ್ಲಿ Ana ಸಹಾಯ ಮಾಡುತ್ತಿದೆ. Ana ಕೇಳುವಾಗ ಅಥವಾ ಅನುವಾದಿಸುವಾಗ, ಮಾತನ್ನು AI ಸೇವೆ ಪ್ರಕ್ರಿಯೆಗೊಳಿಸುತ್ತದೆ. ಇದು ನಿಮಗೆ ಅನುಕೂಲಕರವಾಗಿದ್ದರೆ ಮಾತ್ರ ಮುಂದುವರಿಯಿರಿ.',\n  Urdu: 'Ana اس گفتگو میں مدد کر رہی ہے۔ جب Ana سنتی یا ترجمہ کرتی ہے تو گفتگو کو AI سروس کے ذریعے پروسیس کیا جاتا ہے۔ براہِ کرم صرف اسی صورت میں جاری رکھیں جب آپ اس سے مطمئن ہوں۔',",
    'Privacy Indian languages')
  return text
})

console.log('Ana language expansion applied.')
