from pathlib import Path
import re

html_path = Path('public/meet-ana/index.html')
html = html_path.read_text()

css_anchor = '    section.content{padding-top:105px;padding-bottom:105px}'
if '.demo-phone video{' not in html:
    demo_css = '''    .demo-phone{overflow:hidden;background:#111;padding:0}.demo-phone video{width:100%;height:100%;object-fit:cover;display:block;border-radius:31px;background:#111}.demo-kicker{position:absolute;z-index:9;left:3%;bottom:7%;background:rgba(20,19,17,.86);color:#fff;border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(8px);padding:9px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.03em;box-shadow:0 10px 28px rgba(0,0,0,.18)}\n'''
    if css_anchor not in html:
        raise SystemExit('Meet Ana CSS anchor not found')
    html = html.replace(css_anchor, demo_css + css_anchor, 1)

phone_pattern = re.compile(r'        <div class="phone"><div class="notch"></div><div class="screen">.*?\n        <div class="bubble one">', re.S)
phone_replacement = '''        <div class="phone demo-phone">
          <video autoplay muted loop playsinline preload="metadata" aria-label="Ana Keyboard correcting and translating text in real apps">
            <source src="/meet-ana/ana-keyboard-demo.mp4" type="video/mp4">
          </video>
        </div>
        <span class="demo-kicker">Real Ana Keyboard demo</span>
        <div class="bubble one">'''
if '<video autoplay muted loop playsinline' not in html:
    html, count = phone_pattern.subn(phone_replacement, html, count=1)
    if count != 1:
        raise SystemExit(f'Expected one hero phone block, replaced {count}')

html = html.replace(
    '<span class="visual-note">Different languages.<br>A kinder world.</span>',
    '<span class="visual-note">Type normally.<br>Ana helps as you go.</span>',
    1,
)

html = html.replace(
    'Use Ana inside Android apps with local word suggestions and autocorrection, glide typing, voice, clipboard, emoji/GIF, learned words, resizeable layouts and Translate, Write or Correct when you need them.',
    'Use Ana inside Android apps with local word suggestions and autocorrection, voice, clipboard, emoji/GIF, learned words, resizeable layouts and Translate, Write or Correct when you need them.',
    1,
)

html_path.write_text(html)

service_path = Path('android-keyboard/app/src/main/java/com/ana/keyboard/AnaKeyboardService.kt')
service = service_path.read_text()
old_status = 'Ana • typing, correction and glide stay local'
new_status = 'Ana • local typing · AI when enabled'
if old_status in service:
    service = service.replace(old_status, new_status)
elif new_status not in service:
    print('Note: legacy default status text was not present; no service status replacement made.')
service_path.write_text(service)
