import test from 'node:test'
import assert from 'node:assert/strict'
import { maskSensitiveText, restoreSensitiveText } from '../src/sensitiveMaskingCore.js'

test('masks synthetic identifiers and restores them exactly', () => {
  const original = 'Email demo@example.test, phone +99 123 4567890, Patient ID: TEST-ID-001.'
  const masked = maskSensitiveText(original)

  assert.equal(masked.items.length, 3)
  assert.doesNotMatch(masked.text, /demo@example\.test/)
  assert.doesNotMatch(masked.text, /\+99 123 4567890/)
  assert.doesNotMatch(masked.text, /TEST-ID-001/)
  assert.equal(restoreSensitiveText(masked.text, masked.items), original)
})

test('leaves ordinary business numbers intact', () => {
  const original = 'Order 1234567890 costs 4500 EUR and is due on 2026-10-04.'
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
