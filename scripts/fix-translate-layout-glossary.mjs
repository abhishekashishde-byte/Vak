import fs from 'node:fs'

const appPath = 'src/App.jsx'
const cssPath = 'src/styles.css'
const prefsPath = 'src/accountPreferences.js'

let app = fs.readFileSync(appPath, 'utf8')
let css = fs.readFileSync(cssPath, 'utf8')
let prefs = fs.readFileSync(prefsPath, 'utf8')

function replaceOrThrow(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`)
  return source.replace(from, to)
}

// The header badge should represent everything Ana remembers, not just the
// currently selected target language. The drawer itself can still show the
// active language-specific rules.
app = replaceOrThrow(
  app,
  `Glossary <span className="badge">{activeGlossary.length}</span>`,
  `Glossary <span className="badge">{glossary.length}</span>`,
  'glossary badge count',
)

app = replaceOrThrow(
  app,
  `<div className="drawer-head"><div><h2>Personal glossary</h2><p>{target} terminology Ana should remember.</p></div><button onClick={() => setGlossaryOpen(false)}><X size={20}/></button></div>`,
  `<div className="drawer-head"><div><h2>Personal glossary</h2><p>{glossary.length} saved in total · showing {target} terminology.</p></div><button onClick={() => setGlossaryOpen(false)}><X size={20}/></button></div>`,
  'glossary drawer summary',
)

// Desktop should use the available monitor instead of staying in a narrow
// 1180px column. Both panes keep their own scroll area.
css = replaceOrThrow(
  css,
  `.app-shell{position:relative;z-index:1;width:min(1180px,calc(100% - 32px));margin:auto;min-height:100vh;padding-bottom:64px}`,
  `.app-shell{position:relative;z-index:1;width:min(1640px,calc(100% - 48px));margin:auto;min-height:100vh;padding-bottom:40px}`,
  'desktop app shell width',
)

css = replaceOrThrow(
  css,
  `.workspace{display:grid;grid-template-columns:1fr 1fr;min-height:440px}`,
  `.workspace{display:grid;grid-template-columns:1fr 1fr;height:clamp(500px,calc(100vh - 215px),760px);min-height:500px}`,
  'desktop workspace sizing',
)

css = replaceOrThrow(
  css,
  `.pane{display:flex;flex-direction:column;min-width:0;background:rgba(255,255,255,.34)}`,
  `.pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(255,255,255,.34);overflow:hidden}`,
  'pane overflow sizing',
)

css = replaceOrThrow(
  css,
  `.pane textarea{flex:1;resize:none;border:0;outline:0;background:transparent;color:#171717;font-size:22px;line-height:1.55;padding:18px;min-height:330px}`,
  `.pane textarea{flex:1;resize:none;border:0;outline:0;background:transparent;color:#171717;font-size:22px;line-height:1.55;padding:18px;min-height:0;overflow-y:auto;overscroll-behavior:contain}`,
  'input pane scrolling',
)

css = replaceOrThrow(
  css,
  `.output-area{flex:1;padding:18px;min-height:330px}`,
  `.output-area{flex:1;padding:18px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}`,
  'output pane scrolling',
)

// Preserve mobile behavior: its existing flex sizing should remain viewport based.
css = replaceOrThrow(
  css,
  `.workspace{grid-template-columns:1fr;grid-template-rows:minmax(145px,1fr) minmax(155px,1.08fr);min-height:0;flex:1}`,
  `.workspace{grid-template-columns:1fr;grid-template-rows:minmax(145px,1fr) minmax(155px,1.08fr);height:auto;min-height:0;flex:1}`,
  'mobile workspace height reset',
)

// Never let a newer empty cloud bundle erase a non-empty local glossary.
// Merge divergent glossaries instead of replacing them wholesale; this is
// deliberately biased toward preserving a user's saved terminology.
const oldRemoteBranch = `      if (remoteGlossaryTs > localGlossaryTs) {\n        writeJson(GLOSSARY_KEY, remoteGlossary)\n        setGlossaryUpdatedAt(remoteGlossaryTs)\n      } else if (localGlossaryTs > remoteGlossaryTs) {\n        // Keep the newer local glossary. This prevents an unrelated, newer account\n        // preference bundle from erasing a term that was just saved on this device.\n      } else if (!localGlossary.length && remoteGlossary.length) {\n        // Backward compatibility for account bundles created before glossary timestamps.\n        writeJson(GLOSSARY_KEY, remoteGlossary)\n      } else if (localGlossary.length && remoteGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {\n        // Legacy bundles have no category timestamp. Merge rather than destroy data.\n        writeJson(GLOSSARY_KEY, mergeGlossaries(remoteGlossary, localGlossary))\n      }`

const newRemoteBranch = `      if (remoteGlossaryTs > localGlossaryTs) {\n        if (localGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {\n          const merged = mergeGlossaries(localGlossary, remoteGlossary)\n          writeJson(GLOSSARY_KEY, merged)\n          setGlossaryUpdatedAt(Date.now())\n        } else {\n          writeJson(GLOSSARY_KEY, remoteGlossary)\n          setGlossaryUpdatedAt(remoteGlossaryTs)\n        }\n      } else if (localGlossaryTs > remoteGlossaryTs) {\n        if (remoteGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {\n          const merged = mergeGlossaries(remoteGlossary, localGlossary)\n          writeJson(GLOSSARY_KEY, merged)\n          setGlossaryUpdatedAt(Date.now())\n        }\n      } else if (!localGlossary.length && remoteGlossary.length) {\n        writeJson(GLOSSARY_KEY, remoteGlossary)\n      } else if (localGlossary.length && remoteGlossary.length && glossarySignature(localGlossary) !== glossarySignature(remoteGlossary)) {\n        writeJson(GLOSSARY_KEY, mergeGlossaries(remoteGlossary, localGlossary))\n        setGlossaryUpdatedAt(Date.now())\n      }`

prefs = replaceOrThrow(prefs, oldRemoteBranch, newRemoteBranch, 'glossary merge policy')

// If the user changes the glossary during startup, still timestamp the glossary
// immediately so hydration cannot treat the just-saved local state as stale.
prefs = replaceOrThrow(
  prefs,
  `export function markAccountPreferencesChanged() {\n  if (applyingRemote || bootstrapping || Date.now() < suppressMarksUntil) return\n  const now = Date.now()\n  const currentGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))`,
  `export function markAccountPreferencesChanged() {\n  if (applyingRemote || Date.now() < suppressMarksUntil) return\n  const now = Date.now()\n  const currentGlossarySignature = glossarySignature(readJson(GLOSSARY_KEY, []))\n  if (bootstrapping) {\n    if (currentGlossarySignature !== lastGlossarySignature) {\n      lastGlossarySignature = currentGlossarySignature\n      setGlossaryUpdatedAt(now)\n      setLocalUpdatedAt(now)\n    }\n    return\n  }`,
  'preference bootstrap protection',
)

fs.writeFileSync(appPath, app)
fs.writeFileSync(cssPath, css)
fs.writeFileSync(prefsPath, prefs)
console.log('Translate layout, scrolling and glossary persistence fixes applied')
