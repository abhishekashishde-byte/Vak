import fs from 'node:fs'

const path = 'public/meet-ana/index.html'
let html = fs.readFileSync(path, 'utf8')

function mustReplace(from, to, label) {
  if (!html.includes(from)) throw new Error(`Could not find ${label}`)
  html = html.replace(from, to)
}

mustReplace(
  '<title>Ana — Your voice, in any language</title>',
  '<title>Ana — Speak, hear and write in any language</title>',
  'page title',
)

mustReplace(
  '<meta name="description" content="Ana is a multilingual AI communication assistant for translation, live interpretation, documents, captions and Talk for Me — where Ana can help handle a real-world conversation on your behalf while you keep the important decisions." />',
  '<meta name="description" content="Ana is a multilingual AI communication assistant that can translate for you, hear conversations for you, write for you and speak on your behalf — in the language you need." />',
  'meta description',
)

mustReplace(
  '<p class="overline">PEOPLE. PLACES. POSSIBILITIES.</p>\n        <h1>Speak naturally.<br><em>Ana handles</em> the rest.</h1>\n        <p class="deck">Ana helps you express intent, navigate conversations, and get things done across languages — in real life, not just in text.</p>',
  '<p class="overline">WHEN LANGUAGE GETS IN THE WAY</p>\n        <h1>In a foreign land,<br><em>Ana can speak for you,</em><br>hear for you and write for you.</h1>\n        <p class="deck">Use Ana in the language you need. Translate text, voice, photos and documents. Follow live conversations and meetings. Ask Ana to write the message for you — or, when needed, speak on your behalf.</p>',
  'hero copy',
)

mustReplace(
  '<span class="scribble">Same intent.<br>A more open world.</span>',
  '<span class="scribble">Your meaning.<br>Any language.</span>',
  'hero scribble',
)

mustReplace(
  '<div class="phone-list"><div class="phone-item"><i>文</i><b>Translate</b><small>Text, voice or image</small></div><div class="phone-item"><i>◉</i><b>Live Interpreter</b><small>Real-time conversation</small></div><div class="phone-item flag"><i>◎</i><b>Talk for Me</b><small>Ana speaks on your behalf</small></div><div class="phone-item"><i>▤</i><b>Documents</b><small>PDFs, forms and files</small></div><div class="phone-item"><i>◫</i><b>Camera</b><small>Understand what you see</small></div></div>',
  '<div class="phone-list"><div class="phone-item"><i>文</i><b>Translate</b><small>Text · voice · camera · documents</small></div><div class="phone-item"><i>◉</i><b>Live</b><small>Interpreter · subtitles · conversation room</small></div><div class="phone-item"><i>◫</i><b>Meeting</b><small>Listen · translate · keep the transcript</small></div><div class="phone-item flag"><i>◎</i><b>Talk for Me</b><small>Ana speaks on your behalf</small></div></div>',
  'phone feature list',
)

const oldFeatures = `<section class="content shell" id="features"><div class="heading"><p class="overline">A MORE HUMAN WAY TO COMMUNICATE</p><h2>People don’t want translation.<br>They want <em>outcomes.</em></h2><p>Ana is built for real-life communication — from simple text translation to live interpretation, document understanding, captions and conversations handled on your behalf.</p></div>
      <div class="feature-grid">
        <article class="feature"><div class="icon">文</div><h3>Translate</h3><p>Context-aware translation that preserves tone, intent, names, numbers and the way you naturally speak.</p></article>
        <article class="feature"><div class="icon">◉</div><h3>Live Interpreter</h3><p>Two-way realtime interpretation for natural face-to-face conversations.</p></article>
        <article class="feature flag"><span class="tag">Flagship</span><div class="icon">◎</div><h3>Talk for Me</h3><p>Tell Ana the goal. Ana can speak on your behalf, verify what matters and pause when your decision is needed.</p></article>
        <article class="feature"><div class="icon">▤</div><h3>Documents & PDFs</h3><p>Translate digital and scanned documents while preserving structure, forms and tables.</p></article>
        <article class="feature"><div class="icon">◫</div><h3>Camera Translation</h3><p>Photograph signs, menus, labels, forms or letters and understand what you see.</p></article>
        <article class="feature"><div class="icon">●●●</div><h3>Conversation Rooms</h3><p>Multi-person conversations where each participant can communicate in their own language.</p></article>
        <article class="feature"><div class="icon">CC</div><h3>Universal Captions</h3><p>Live original and translated captions for speech and supported shared audio.</p></article>
        <article class="feature"><div class="icon">✦</div><h3>Personal Language Memory</h3><p>Ana remembers language preferences, terminology and your German Sie/du choice.</p></article>
        <article class="feature"><div class="icon">◇</div><h3>Privacy & Trust</h3><p>Disclosure-first Talk flows, counterparty permission, owner approval and verified handoffs.</p></article>
      </div>
    </section>`

const newFeatures = `<section class="content shell" id="features"><div class="heading"><p class="overline">ONE ANA. DIFFERENT WAYS TO HELP.</p><h2>Speak. Hear. Write.<br><em>Across languages.</em></h2><p>Ana is organised around what you need to achieve — not around the technology underneath it.</p></div>
      <div class="feature-grid">
        <article class="feature flag"><span class="tag">SPEAK FOR YOU</span><div class="icon">◎</div><h3>Talk for Me</h3><p>Tell Ana the goal. Ana can handle the conversation on your behalf, verify important details and pause when your decision is needed.</p></article>
        <article class="feature"><div class="icon">◉</div><h3>Hear for you</h3><p>Use Live for an interpreter, translated subtitles or a multi-person conversation room. In meetings, Ana can listen, translate and keep the transcript.</p></article>
        <article class="feature"><div class="icon">✎</div><h3>Write for you</h3><p>Give Ana rough notes or simply explain what you need to say. Ana turns the intent into a ready-to-send email, message, reply or note in the language you choose.</p></article>
        <article class="feature"><div class="icon">文</div><h3>Translate almost anything</h3><p>Type, paste or speak — or use a camera, photo, letter or PDF. Camera and documents now live inside Translate instead of feeling like separate tools.</p></article>
        <article class="feature"><div class="icon">✦</div><h3>Smarter language choices</h3><p>If your text is already in the selected target language, Ana can recognise that you probably forgot to change the target and choose the language you normally use.</p></article>
        <article class="feature"><div class="icon">◇</div><h3>Remembers how you communicate</h3><p>Ana can remember language preferences, personal terminology and German Sie/du choices while keeping important decisions with you.</p></article>
      </div>
    </section>`

mustReplace(oldFeatures, newFeatures, 'features section')

mustReplace(
  '<section class="content shell" id="how"><div class="split-heading"><div><p class="overline">SIMPLE STEPS. REAL RESULTS.</p><h2>How Ana works</h2></div><p>Natural conversations. Meaningful outcomes.</p></div><div class="how"><article><div class="how-number">1</div><h3>Tell Ana your goal</h3><p>Speak or type naturally. Ana works out what matters and what can be discovered in the conversation.</p></article><article><div class="how-number">2</div><h3>Ana translates, listens, or speaks for you</h3><p>Use simple translation, live interpretation or Talk for Me depending on the situation.</p></article><article><div class="how-number">3</div><h3>You get the result</h3><p>Important facts come back clearly, with unresolved details labelled instead of guessed.</p></article></div></section>',
  '<section class="content shell" id="how"><div class="split-heading"><div><p class="overline">SIMPLE STEPS. REAL RESULTS.</p><h2>How Ana works</h2></div><p>You tell Ana what you need. Ana chooses the right way to help.</p></div><div class="how"><article><div class="how-number">1</div><h3>Tell Ana what you need</h3><p>Type, speak, upload a document or use the camera. Rough notes are fine — Ana works from the intent.</p></article><article><div class="how-number">2</div><h3>Ana listens, writes or speaks</h3><p>Translate something, follow a live conversation, understand a meeting, create a ready-to-send message or let Ana handle the dialogue for you.</p></article><article><div class="how-number">3</div><h3>You stay in control</h3><p>Ana helps with the language and routine interaction. Important choices and unresolved details stay visible instead of being guessed.</p></article></div></section>',
  'how section',
)

mustReplace(
  '<h2>Your voice.<br>Your intent.<br><em>Any language.</em></h2><p>Ana is currently in private testing. Explore the product and see what multilingual communication can feel like when the technology understands the goal, not just the words.</p>',
  '<h2>Speak for you.<br>Hear for you.<br><em>Write for you.</em></h2><p>Ana is currently in private testing. Explore what multilingual life can feel like when one assistant can translate what you see, understand what you hear, write what you mean and help you speak when the words are difficult.</p>',
  'final CTA copy',
)

fs.writeFileSync(path, html)
console.log('Meet Ana page updated for the new product experience')
