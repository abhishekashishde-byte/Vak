import test from 'node:test'
import assert from 'node:assert/strict'
import { completionGate } from '../src/lib/talkTrust.js'
import { scenarios } from './talkTrust.scenarios.js'

for (const scenario of scenarios) {
  test(`Talk for Me trust: ${scenario.name}`, () => {
    const result = completionGate(scenario.facts, scenario.options)
    assert.equal(result.accepted, scenario.accepted)

    if (scenario.unresolved) {
      assert.deepEqual(result.unresolved.map(item => item.key), scenario.unresolved)
    }

    if (scenario.issueCodes) {
      assert.deepEqual(result.issues.map(item => item.code), scenario.issueCodes)
    }
  })
}

test('Talk for Me trust: malformed fact input does not crash the gate', () => {
  const result = completionGate([null, undefined, false], {})
  assert.equal(result.accepted, true)
  assert.deepEqual(result.unresolved, [])
})

test('Talk for Me trust: observed always remains unresolved even with a value', () => {
  const result = completionGate([
    { key: 'time', label: 'Departure time', required: true, risk: 'high', status: 'observed', value: '18:40' },
  ])
  assert.equal(result.accepted, false)
  assert.equal(result.unresolved[0].status, 'observed')
})
