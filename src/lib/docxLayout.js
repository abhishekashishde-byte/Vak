import JSZip from 'jszip'

const XML_NS = 'http://www.w3.org/XML/1998/namespace'

function nodesByLocalName(root, name) {
  return Array.from(root?.getElementsByTagNameNS?.('*', name) || [])
}

function directChildByLocalName(root, name) {
  return Array.from(root?.childNodes || []).find(node => node.nodeType === 1 && node.localName === name) || null
}

function parseXml(source, path) {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Ana could not read the Word XML in ${path}.`)
  }
  return doc
}

function serialiseXml(doc, original) {
  const body = new XMLSerializer().serializeToString(doc)
  const declaration = String(original || '').match(/^\s*(<\?xml[^>]+\?>)/i)?.[1] || ''
  return declaration && !body.startsWith('<?xml') ? declaration + body : body
}

function wordParts(zip) {
  return Object.keys(zip.files)
    .filter(path =>
      /^word\/document\.xml$/i.test(path) ||
      /^word\/header\d*\.xml$/i.test(path) ||
      /^word\/footer\d*\.xml$/i.test(path) ||
      /^word\/(footnotes|endnotes)\.xml$/i.test(path)
    )
    .sort((a, b) => {
      if (a === 'word/document.xml') return -1
      if (b === 'word/document.xml') return 1
      return a.localeCompare(b)
    })
}

function runStyleFingerprint(run) {
  const rPr = directChildByLocalName(run, 'rPr')
  return rPr ? new XMLSerializer().serializeToString(rPr) : ''
}

function runHasBoundary(run) {
  return ['tab', 'br', 'cr', 'fldChar', 'instrText', 'drawing', 'object', 'pict']
    .some(name => nodesByLocalName(run, name).length > 0)
}

function paragraphType(paragraph) {
  let node = paragraph.parentNode
  while (node && node !== paragraph.ownerDocument) {
    if (node.localName === 'tc') return 'table_cell'
    node = node.parentNode
  }

  const pPr = directChildByLocalName(paragraph, 'pPr')
  const pStyle = pPr ? nodesByLocalName(pPr, 'pStyle')[0] : null
  const styleValue = pStyle?.getAttribute('w:val') || pStyle?.getAttribute('val') || ''
  if (/heading|title|subtitle/i.test(styleValue)) return 'heading'
  return 'paragraph'
}

function visibleRunText(run) {
  if (nodesByLocalName(run, 'instrText').length) return ''
  return nodesByLocalName(run, 't').map(node => node.textContent || '').join('')
}

function normalizePreview(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractDocxLayout(file) {
  const zip = await JSZip.loadAsync(file)
  const parts = wordParts(zip)
  if (!parts.length) throw new Error('This Word file does not contain a readable document body.')

  const blocks = []
  const paragraphOrder = []
  let blockCounter = 0
  let order = 0

  for (const partPath of parts) {
    const entry = zip.file(partPath)
    if (!entry) continue

    const source = await entry.async('string')
    const doc = parseXml(source, partPath)
    const allTextNodes = nodesByLocalName(doc, 't')
    const nodeIndexes = new Map(allTextNodes.map((node, index) => [node, index]))
    const paragraphs = nodesByLocalName(doc, 'p')

    paragraphs.forEach((paragraph, paragraphIndex) => {
      const runs = nodesByLocalName(paragraph, 'r')
      const groups = []
      let current = null

      const flush = () => {
        if (!current) return
        if (current.text.trim()) groups.push(current)
        current = null
      }

      runs.forEach(run => {
        const textNodes = nodesByLocalName(run, 't')
        const text = visibleRunText(run)
        const indexes = textNodes.map(node => nodeIndexes.get(node)).filter(Number.isInteger)

        if (!text || !indexes.length || runHasBoundary(run)) {
          flush()
          return
        }

        const style = runStyleFingerprint(run)
        if (current && current.style === style) {
          current.text += text
          current.textNodeIndexes.push(...indexes)
        } else {
          flush()
          current = { text, style, textNodeIndexes: [...indexes] }
        }
      })
      flush()

      if (!groups.length) return

      const paragraphText = groups.map(group => group.text).join('')
      const paragraphKey = partPath + '#p' + paragraphIndex
      paragraphOrder.push(paragraphKey)
      const type = paragraphType(paragraph)

      groups.forEach(group => {
        blockCounter += 1
        order += 1
        blocks.push({
          id: 'docx-' + blockCounter,
          pageIndex: 0,
          type,
          text: group.text,
          context: paragraphText,
          paragraphKey,
          partPath,
          textNodeIndexes: group.textNodeIndexes,
          order,
          source: 'docx',
        })
      })
    })
  }

  return { kind: 'docx', blocks, parts, paragraphOrder }
}

export function docxLayoutToPlainText(layout, translations = null) {
  const translated = translations
    ? new Map(translations.map(item => [String(item.id), String(item.text || '')]))
    : null

  const grouped = new Map()
  for (const block of layout.blocks || []) {
    if (!grouped.has(block.paragraphKey)) grouped.set(block.paragraphKey, [])
    grouped.get(block.paragraphKey).push({
      order: block.order,
      text: translated?.get(block.id) ?? block.text,
    })
  }

  const paragraphs = []
  for (const key of layout.paragraphOrder || []) {
    const text = (grouped.get(key) || [])
      .sort((a, b) => a.order - b.order)
      .map(item => item.text)
      .join('')
    if (text.trim()) paragraphs.push(text)
  }

  return normalizePreview(paragraphs.join('\n\n'))
}

export async function buildTranslatedDocx(file, layout, translations) {
  const zip = await JSZip.loadAsync(file)
  const byId = new Map((translations || []).map(item => [String(item.id), String(item.text || '')]))
  const blocksByPart = new Map()

  for (const block of layout.blocks || []) {
    if (!blocksByPart.has(block.partPath)) blocksByPart.set(block.partPath, [])
    blocksByPart.get(block.partPath).push(block)
  }

  for (const [partPath, blocks] of blocksByPart.entries()) {
    const entry = zip.file(partPath)
    if (!entry) continue

    const original = await entry.async('string')
    const doc = parseXml(original, partPath)
    const textNodes = nodesByLocalName(doc, 't')

    for (const block of blocks) {
      const translation = byId.get(block.id)
      if (translation == null) throw new Error('A Word text segment was missing after translation.')

      const indexes = block.textNodeIndexes || []
      if (!indexes.length) continue

      const first = textNodes[indexes[0]]
      if (!first) continue

      first.textContent = translation
      if (/^\s|\s$/.test(translation)) first.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      else first.removeAttributeNS(XML_NS, 'space')

      indexes.slice(1).forEach(index => {
        const node = textNodes[index]
        if (node) node.textContent = ''
      })
    }

    zip.file(partPath, serialiseXml(doc, original))
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
