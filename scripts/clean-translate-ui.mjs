import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const appPath = 'src/App.jsx'
const cssPath = 'src/styles.css'

let app = fs.readFileSync(appPath, 'utf8')
let css = fs.readFileSync(cssPath, 'utf8')

if (!app.includes("import AnaMark from './AnaMark.jsx'")) {
  app = app.replace(
    "import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'",
    "import { getPersonalLanguageMemory, rememberPersonalLanguagePreference } from './personalLanguageMemory.js'\nimport AnaMark from './AnaMark.jsx'",
  )
}

app = app.replace(
  '<div className="brand"><img src="/ana-app-icon.png" alt="Ana"/><div><strong>Ana</strong><span>Your voice, in any language</span></div></div>',
  '<div className="brand"><AnaMark className="ana-brand-mark"/><div><strong>Ana</strong></div></div>',
)
app = app.replace(/\n\s*<section className="hero">\s*<div className="eyebrow"><Sparkles size=\{14\}\/> Meaning before words<\/div>\s*<h1>Say exactly what you mean\.<\/h1>\s*<p>Your voice, in any language\.<\/p>\s*<\/section>\s*\n/, '\n\n')

if (!app.includes('<AnaMark className="ana-brand-mark"/>')) throw new Error('Ana brand mark replacement did not apply')
if (app.includes('Say exactly what you mean.')) throw new Error('Translate marketing hero is still present')
if (app.includes('<span>Your voice, in any language</span>')) throw new Error('Translate marketing tagline is still present')

if (!css.includes('.ana-brand-mark{')) css += '\n.ana-brand-mark{width:40px;height:40px;flex:0 0 auto;color:#171717}\n@media(max-width:760px){.ana-brand-mark{width:31px;height:31px}}\n'
fs.writeFileSync(appPath, app)
fs.writeFileSync(cssPath, css)

await import('./simplify-workspace.mjs')
await import('./combine-translate-inputs.mjs')
await import('./style-simplified-modes.mjs')

const workspacePath = 'src/Workspace.jsx'
let workspace = fs.readFileSync(workspacePath, 'utf8')
const duplicateScan = `      {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}\n      {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}`
workspace = workspace.replace(duplicateScan, `      {mode === 'scan' && <main className="app-shell"><ScanMode/></main>}`)
fs.writeFileSync(workspacePath, workspace)

execFileSync('git', ['add', 'src/Workspace.jsx', 'src/workspace.css'])