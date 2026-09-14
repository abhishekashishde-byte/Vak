import fs from 'node:fs'

const appPath = 'src/App.jsx'
const apiPath = 'api/translate.js'
let app = fs.readFileSync(appPath, 'utf8')
let api = fs.readFileSync(apiPath, 'utf8')

const replaceApp = (from, to, label) => {
  if (!app.includes(from)) throw new Error(`Missing App.jsx section: ${label}`)
  app = app.replace(from, to)
}
const replaceApi = (from, to, label) => {
  if (!api.includes(from)) throw new Error(`Missing api/translate.js section: ${label}`)
  api = api.replace(from, to)
}

// Avoid an extra network language-detection call for the normal German↔English case.
// We only need the detector when the selected target plausibly matches the source,
// because that is the case where Ana may need to correct a forgotten target choice.
const confidenceAnchor = `const SMART_TARGET_MIN_CHARS = 12\nconst SMART_TARGET_CONFIDENCE = 0.82\n`
if (!app.includes(confidenceAnchor)) throw new Error('Missing smart target constants')
app = app.replace(confidenceAnchor, confidenceAnchor + `\nfunction selectedTargetMayMatchSource(text = '', target = '') {\n  const sample = String(text).toLowerCase()\n  if (target === 'German') {\n    const common = sample.match(/\\b(der|die|das|den|dem|des|und|ich|wir|sie|ist|sind|nicht|mit|für|auf|von|bitte|danke|habe|wurde|werden)\\b/g)?.length || 0\n    const germanChars = sample.match(/[äöüß]/g)?.length || 0\n    return common >= 2 || germanChars >= 2\n  }\n  if (target === 'English') {\n    const common = sample.match(/\\b(the|and|is|are|was|were|have|has|with|for|from|this|that|please|check|checked|will|not|you|your|we|our)\\b/g)?.length || 0\n    return common >= 3\n  }\n  // Keep the full detector for all other languages until we have equally reliable\n  // local signals for them.\n  return true\n}\n`)

replaceApp(
  `      if (writingMode === 'translate' && text.replace(/\\s/g, '').length >= SMART_TARGET_MIN_CHARS) {\n        try {\n          const detected = await detectSourceLanguage(text)`,
  `      if (writingMode === 'translate' && text.replace(/\\s/g, '').length >= SMART_TARGET_MIN_CHARS && selectedTargetMayMatchSource(text, target)) {\n        try {\n          const detected = await detectSourceLanguage(text)`,
  'smart language detection gate',
)

// The browser already asks for exact line-preserving JSON when translating pasted
// structured text. Do not make the API wrap that JSON request in a second layout
// marker protocol; doing both adds prompt size, latency and failure modes.
replaceApi(
  `  const preserveLayout = isAnaTranslation && /[\\r\\n]/.test(text)`,
  `  const isStructuredLayoutRequest = rawInstructions.includes('LAYOUT IS BINDING.')\n  const preserveLayout = isAnaTranslation && !isStructuredLayoutRequest && /[\\r\\n]/.test(text)`,
  'duplicate layout preservation',
)

// Translation quality stays on Sol, but translation itself does not need hidden
// reasoning. The prompt already specifies the quality checks explicitly. Removing
// reasoning latency is especially important for 1k–5k character emails/documents.
replaceApi(
  `  const model = isTalkTurn || isAnaTranslation ? 'gpt-5.6-sol' : 'gpt-5.6-luna'\n  const reasoningEffort = isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief ? 'low' : 'medium'\n  const deadlineMs = isWordRefinement ? 6000 : isLanguageDetection ? 4500 : isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : isAnaTranslation ? 18000 : 20000`,
  `  const model = isTalkTurn || isAnaTranslation ? 'gpt-5.6-sol' : 'gpt-5.6-luna'\n  const reasoningEffort = isAnaTranslation ? 'none' : (isWordRefinement || isLanguageDetection || isAnaBriefing || isTalkDebrief ? 'low' : 'medium')\n  const deadlineMs = isWordRefinement ? 6000 : isLanguageDetection ? 4500 : isAnaBriefing ? 5500 : isTalkDebrief ? 6500 : isTalkTurn ? 15000 : isAnaTranslation ? 22000 : 20000`,
  'translation reasoning and timeout',
)

// Keep translation output bounded. This is far above what a normal translation of
// Ana's current input sizes needs, while avoiding unnecessarily open-ended generation.
replaceApi(
  `    if (isLanguageDetection) body.max_output_tokens = 90\n    if (isWordRefinement) body.max_output_tokens = 280`,
  `    if (isLanguageDetection) body.max_output_tokens = 90\n    if (isWordRefinement) body.max_output_tokens = 280\n    if (isAnaTranslation) body.max_output_tokens = Math.max(1200, Math.min(6000, Math.ceil(String(text).length * 1.6)))`,
  'translation output bound',
)

fs.writeFileSync(appPath, app)
fs.writeFileSync(apiPath, api)
console.log('Long translation latency improvements applied')
