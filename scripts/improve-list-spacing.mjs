import fs from 'node:fs'

const path = 'src/App.jsx'
let src = fs.readFileSync(path, 'utf8')

const anchor = `function clipboardHtmlToText(html = '', fallback = '') {`
if (!src.includes(anchor)) throw new Error('clipboard helper anchor not found')

const helper = `function formatReadableLists(text = '') {\n  const rawLines = String(text).replace(/\\r\\n?/g, '\\n').split('\\n')\n  const normalised = rawLines.map(line => {\n    const bullet = line.match(/^([ \\t]*)([•◦▪‣∙])\\s*(.*)$/u)\n    if (bullet) return \`${'${bullet[1]}'}•  ${'${bullet[3]}'}\`.replace(/[ \\t]+$/, '')\n\n    const numbered = line.match(/^([ \\t]*)(\\d+[.)])\\s*(.*)$/u)\n    if (numbered) return \`${'${numbered[1]}${numbered[2]}'}  ${'${numbered[3]}'}\`.replace(/[ \\t]+$/, '')\n\n    const dash = line.match(/^([ \\t]*)([-*])\\s+(.*)$/u)\n    if (dash) return \`${'${dash[1]}${dash[2]}'}  ${'${dash[3]}'}\`.replace(/[ \\t]+$/, '')\n\n    const arrow = line.match(/^([ \\t]*)(→)\\s*(.*)$/u)\n    if (arrow) return \`${'${arrow[1]}${arrow[2]}'}  ${'${arrow[3]}'}\`.replace(/[ \\t]+$/, '')\n    return line.replace(/[ \\t]+$/, '')\n  })\n\n  const isListLine = line => /^[ \\t]*(?:[•]|[-*]|→|\\d+[.)])\\s+/u.test(line)\n  const out = []\n\n  for (const line of normalised) {\n    if (!line.trim()) {\n      if (out.length && out[out.length - 1] !== '') out.push('')\n      continue\n    }\n\n    const currentIsList = isListLine(line)\n    const previous = out.length ? out[out.length - 1] : ''\n    const previousNonBlank = [...out].reverse().find(item => item.trim()) || ''\n    const previousWasList = isListLine(previousNonBlank)\n\n    // Give lists room to breathe in the plain-text editor: one visual blank line\n    // before the first item, between items and after the final item.\n    if (currentIsList && out.length && previous !== '') out.push('')\n    if (!currentIsList && previousWasList && previous !== '') out.push('')\n\n    out.push(line)\n  }\n\n  while (out[0] === '') out.shift()\n  while (out[out.length - 1] === '') out.pop()\n  return out.join('\\n')\n}\n\n`

if (!src.includes('function formatReadableLists(')) src = src.replace(anchor, helper + anchor)

src = src.replace(
  `    const pasted = html && /<(?:li|ol|ul|p|div|br|table|tr|td)\\b/i.test(html)\n      ? clipboardHtmlToText(html, plain)\n      : normalizeClipboardText(plain)`,
  `    const pastedRaw = html && /<(?:li|ol|ul|p|div|br|table|tr|td)\\b/i.test(html)\n      ? clipboardHtmlToText(html, plain)\n      : normalizeClipboardText(plain)\n    const pasted = formatReadableLists(pastedRaw)`,
)

src = src.replace(
  `    const cleanedInput = normalizeClipboardText(input).trim()`,
  `    const cleanedInput = formatReadableLists(normalizeClipboardText(input)).trim()`,
)

if (!src.includes('const pasted = formatReadableLists(pastedRaw)')) throw new Error('paste list formatting patch did not apply')
if (!src.includes('formatReadableLists(normalizeClipboardText(input)).trim()')) throw new Error('translate list formatting patch did not apply')

fs.writeFileSync(path, src)
console.log('Readable list spacing applied to input and output flow')
