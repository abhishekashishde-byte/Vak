import test from 'node:test'
import assert from 'node:assert/strict'
import { domainPrompt, resolveDomain, transcriptionDomainPrompt } from '../api/_domain.js'

test('detects SAP terminology without literal-language confusion', () => {
  const result = resolveDomain('Bitte MIGO prüfen. Der Wareneingang und die Bewegungsart stimmen nicht.', { mode: 'auto' })
  assert.equal(result.active, 'sap')
  assert.ok(result.confidence > 0.7)
  const prompt = domainPrompt(result)
  assert.match(prompt, /Wareneingang = Goods Receipt/)
  assert.match(prompt, /T-code/)
})

test('detects medical forms from German clinical terminology', () => {
  const result = resolveDomain('Anamnese: Haben Sie Vorerkrankungen? Nehmen Sie Medikamente oder Blutverdünner?', { mode: 'auto' })
  assert.equal(result.active, 'medical')
  assert.ok(result.confidence > 0.7)
  assert.match(domainPrompt(result), /MEDICAL DOMAIN CONTEXT/)
})

test('supports overlapping SAP and finance context', () => {
  const result = resolveDomain('In SAP prüfen wir MIGO, Wareneingang, Kostenstelle, Rechnung und Umsatzsteuer.', { mode: 'auto' })
  assert.equal(result.active, 'sap')
  assert.equal(result.secondary, 'finance')
})

test('manual domain selection is a hard lock', () => {
  const result = resolveDomain('MIGO Wareneingang T-code SAP', { mode: 'medical', active: 'medical' })
  assert.equal(result.active, 'medical')
  assert.equal(result.mode, 'medical')
  assert.equal(result.confidence, 1)
})

test('ordinary language stays general when evidence is weak', () => {
  const result = resolveDomain('Please send me the updated note tomorrow morning.', { mode: 'auto', active: 'general' })
  assert.equal(result.active, 'general')
  assert.equal(result.detected, false)
})

test('transcription prompt reflects active specialist domain', () => {
  const result = resolveDomain('Anamnese Diagnose Medikament', { mode: 'auto' })
  assert.match(transcriptionDomainPrompt(result), /medical/i)
  assert.match(transcriptionDomainPrompt(result), /medication/i)
})
