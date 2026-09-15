import test from 'node:test'
import assert from 'node:assert/strict'
import { maskSensitiveText, mayContainSensitiveText, restoreSensitiveText } from '../src/sensitiveMaskingCore.js'

test('masks high-confidence synthetic identifiers and restores them exactly', () => {
  const original = 'Email demo@example.test, phone +99 123 4567890, Patient ID: TEST-ID-001.'
  const masked = maskSensitiveText(original)

  assert.equal(masked.items.length, 3)
  assert.doesNotMatch(masked.text, /demo@example\.test/)
  assert.doesNotMatch(masked.text, /\+99 123 4567890/)
  assert.doesNotMatch(masked.text, /TEST-ID-001/)
  assert.equal(restoreSensitiveText(masked.text, masked.items), original)
})

test('fast path rejects ordinary translation text', () => {
  const original = 'Please confirm the production order date, quantity, work center and delivery time.'
  assert.equal(mayContainSensitiveText(original), false)
  assert.deepEqual(maskSensitiveText(original), { text: original, items: [] })
})

test('leaves ordinary business and SAP-style numbers intact', () => {
  const original = 'Order 1234567890, material 123456789012345678, amount 4500 EUR, due 2026-10-04, reference 123-45-6789.'
  const masked = maskSensitiveText(original)

  assert.equal(masked.items.length, 0)
  assert.equal(masked.text, original)
})

test('does not mask an invalid IBAN-shaped technical value', () => {
  const original = 'Technical reference DE00123456789012345678 should remain unchanged.'
  const masked = maskSensitiveText(original)

  assert.equal(masked.items.length, 0)
  assert.equal(masked.text, original)
})

test('supports unique placeholder numbering across separately masked fields', () => {
  const first = maskSensitiveText('demo@example.test', 0)
  const second = maskSensitiveText('other@example.test', first.items.length)

  assert.equal(first.items[0].token, '[[ANA_PRIVATE_1]]')
  assert.equal(second.items[0].token, '[[ANA_PRIVATE_2]]')
})
