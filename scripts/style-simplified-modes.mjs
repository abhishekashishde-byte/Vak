import fs from 'node:fs'

const wp='src/workspace.css'
const sp='src/styles.css'
let w=fs.readFileSync(wp,'utf8')
let s=fs.readFileSync(sp,'utf8')

if(!w.includes('.ana-live-subnav{')) w += `\n.ana-live-stack{min-height:100%;display:flex;flex-direction:column}.ana-live-subnav{position:sticky;top:0;z-index:20;display:flex;justify-content:center;gap:6px;padding:8px 12px;border-bottom:1px solid rgba(43,39,33,.09);background:rgba(244,241,234,.92);backdrop-filter:blur(16px)}.ana-live-subnav button{height:34px;border:1px solid rgba(43,39,33,.12);border-radius:10px;background:rgba(255,255,255,.55);color:#625c54;padding:0 12px;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;cursor:pointer}.ana-live-subnav button.active{background:#171717;color:#fff;border-color:#171717}.ana-live-stack>.app-shell{min-height:calc(100dvh - var(--ana-modebar-height) - 51px)}.ana-mode-group-main{padding-top:2px}\n@media(max-width:760px){.ana-live-subnav{justify-content:stretch}.ana-live-subnav button{flex:1;justify-content:center;padding:0 8px}}\n`

if(!s.includes('.translate-input-actions{')) s += `\n.translate-input-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}.translate-input-actions .dictate-btn{white-space:nowrap}\n@media(max-width:760px){.pane-label-row{align-items:flex-start!important}.translate-input-actions{gap:4px}.translate-input-actions .dictate-btn{padding:0 8px}.translate-input-actions .dictate-btn svg{width:13px;height:13px}}\n`

fs.writeFileSync(wp,w)
fs.writeFileSync(sp,s)
