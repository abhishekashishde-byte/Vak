import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeExtensionRequest, extensionRequestToDraft } from '../src/browserExtensionBridge.js'

function hashFor(payload) {
  return `#anaExt=${encodeURIComponent(JSON.stringify(payload))}`
}

test('decodes a valid extension request', () => {
  const request = decodeExtensionRequest(hashFor({ version: 1, action: 'translate', text: 'Guten Morgen' }))
  assert.deepEqual(request, { version: 1, action: 'translate', text: 'Guten Morgen', glossaryContext: '', sourceTitle: '' })
})

test('rejects malformed or empty requests', () => {
  assert.equal(decodeExtensionRequest('#anaExt=%7Bbad'), null)
  assert.equal(decodeExtensionRequest(hashFor({ action: 'translate', text: '   ' })), null)
})

test('unknown action safely falls back to translate', () => {
  const request = decodeExtensionRequest(hashFor({ action: 'delete-everything', text: 'Hallo' }))
  assert.equal(request.action, 'translate')
})

test('rewrite becomes a Write for me draft without changing saved target', () => {
  const draft = extensionRequestToDraft({ action: 'rewrite', text: 'pls send file' }, { target: 'German', outputMode: 'online' })
  assert.equal(draft.target, 'German')
  assert.equal(draft.outputMode, 'online')
  assert.equal(draft.writingMode, 'write')
  assert.match(draft.input, /pls send file/)
  assert.equal(draft.output, '')
})

test('selection is capped to 8000 characters', () => {
  const request = decodeExtensionRequest(hashFor({ action: 'translate', text: 'x'.repeat(9000) }))
  assert.equal(request.text.length, 8000)
})


test('new browser actions become Ana write drafts', () => {
  for (const action of ['correct', 'shorter', 'friendly', 'formal', 'du', 'sie', 'explain', 'reply']) {
    const draft = extensionRequestToDraft({ action, text: 'Bitte prüfen', glossaryContext: 'Project Alpha' }, { target: 'German' })
    assert.equal(draft.writingMode, 'write')
    assert.match(draft.input, /Bitte prüfen/)
    assert.equal(draft.glossaryContext, 'Project Alpha')
  }
})

test('project glossary context survives the extension handoff', () => {
  const request = decodeExtensionRequest(hashFor({ version: 2, action: 'correct', text: 'Text', glossaryContext: 'S/4HANA Transformation', sourceTitle: 'SAP' }))
  assert.equal(request.glossaryContext, 'S/4HANA Transformation')
  assert.equal(request.sourceTitle, 'SAP')
})
