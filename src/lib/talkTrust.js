export const COMPLETE_STATUSES = new Set(['confirmed', 'unavailable'])

const text = value => String(value ?? '').trim()

export function completionGate(facts = [], options = {}) {
  const list = Array.isArray(facts) ? facts : []
  const unresolved = []
  const issues = []

  if (options.ownerDecisionPending) {
    issues.push({
      code: 'owner_decision_pending',
      label: 'Owner decision',
      message: 'A material owner decision is still pending.',
    })
  }

  for (const fact of list) {
    if (!fact || fact.required === false) continue

    const status = text(fact.status) || 'missing'
    const label = text(fact.label) || text(fact.key) || 'Required detail'
    const risk = fact.risk === 'high' ? 'high' : 'normal'

    if (!COMPLETE_STATUSES.has(status)) {
      unresolved.push({
        key: text(fact.key),
        label,
        status,
        risk,
      })
      continue
    }

    if (status === 'confirmed' && !text(fact.value)) {
      issues.push({
        code: 'confirmed_without_value',
        key: text(fact.key),
        label,
        risk,
        message: `${label} is marked confirmed but has no usable value.`,
      })
    }

    if (status === 'unavailable' && !text(fact.reason) && !text(fact.evidence)) {
      issues.push({
        code: 'unavailable_without_basis',
        key: text(fact.key),
        label,
        risk,
        message: `${label} is marked unavailable without a reason or evidence.`,
      })
    }
  }

  return {
    accepted: unresolved.length === 0 && issues.length === 0,
    unresolved,
    issues,
  }
}

export function trustSummary(facts = [], options = {}) {
  const gate = completionGate(facts, options)
  const required = (Array.isArray(facts) ? facts : []).filter(fact => fact && fact.required !== false)
  const resolved = required.filter(fact => COMPLETE_STATUSES.has(text(fact.status))).length
  return {
    ...gate,
    required: required.length,
    resolved,
  }
}
