const TOKEN_RE = /\[\[ANA_PRIVATE_(\d+)\]\]/g

function luhnValid(candidate = '') {
  const digits = String(candidate).replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alternate = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index])
    if (alternate) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    alternate = !alternate
  }
  return sum % 10 === 0
}

function placeholder(index) {
  return `[[ANA_PRIVATE_${index}]]`
}

function addReplacement(state, value, type) {
  const exact = String(value || '')
  if (!exact) return exact
  const existing = state.reverse.get(exact)
  if (existing) return existing
  const token = placeholder(state.startAt + state.items.length + 1)
  state.items.push({ token, value: exact, type })
  state.reverse.set(exact, token)
  return token
}

function replaceWhole(text, regex, type, state, validator) {
  return text.replace(regex, match => {
    if (validator && !validator(match)) return match
    return addReplacement(state, match, type)
  })
}

function replaceLabelled(text, regex, type, state) {
  return text.replace(regex, (match, prefix, value) => {
    if (!value) return match
    return `${prefix}${addReplacement(state, value, type)}`
  })
}

export function maskSensitiveText(value = '', startAt = 0) {
  const state = { items: [], reverse: new Map(), startAt: Number(startAt || 0) }
  let text = String(value || '')
  if (!text) return { text, items: [] }

  text = replaceWhole(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'email', state)
  text = replaceWhole(text, /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi, 'iban', state, match => {
    const compact = match.replace(/\s/g, '')
    return compact.length >= 15 && compact.length <= 34
  })
  text = replaceWhole(text, /\b\d{3}-\d{2}-\d{4}\b/g, 'ssn', state)
  text = replaceWhole(text, /\+\d(?:[\s().-]*\d){6,14}\b/g, 'phone', state, match => {
    const count = match.replace(/\D/g, '').length
    return count >= 7 && count <= 15
  })
  text = replaceWhole(text, /\b(?:\d[ -]*?){13,19}\b/g, 'payment-card', state, luhnValid)

  const labelledId = /((?:patient|case|account|policy|customer|contract|passport|claim|insurance|member|tax)\s*(?:id|number|no\.?|#)|(?:patienten|fall|konto|policen|kunden|vertrags|pass|schaden|versicherten|steuer)(?:nummer|nr\.?|[- ]?id)|aktenzeichen)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9./_-]{4,30})/gi
  text = replaceLabelled(text, labelledId, 'labelled-id', state)

  return { text, items: state.items }
}

export function restoreSensitiveText(value = '', items = []) {
  if (!items?.length) return String(value || '')
  const map = new Map(items.map(item => [item.token, item.value]))
  return String(value || '').replace(TOKEN_RE, match => map.get(match) || match)
}
