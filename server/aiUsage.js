const cleanBearer = req => {
  const value = String(req?.headers?.authorization || '').trim()
  return value.toLowerCase().startsWith('bearer ') ? value : ''
}

const supabaseConfig = () => ({
  url: String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''),
})

const textRates = model => {
  const value = String(model || '').toLowerCase()
  if (value.includes('gpt-5.6-sol') || value === 'gpt-5.6') return { input: 4, cached: 0.4, output: 20 }
  if (value.includes('gpt-5.6-luna')) return { input: 0.2, cached: 0.02, output: 1.2 }
  return null
}

const realtimeRates = model => {
  const value = String(model || '').toLowerCase()
  if (value.includes('gpt-realtime-2.1')) {
    return { textInput: 4, textCached: 0.4, textOutput: 24, audioInput: 32, audioCached: 0.4, audioOutput: 64 }
  }
  return null
}

const number = value => Math.max(0, Number(value || 0) || 0)

export function responseUsageCost(model, usage = {}) {
  const rates = textRates(model)
  if (!rates) return 0
  const input = number(usage.input_tokens)
  const cached = Math.min(input, number(usage.input_tokens_details?.cached_tokens ?? usage.input_token_details?.cached_tokens))
  const output = number(usage.output_tokens)
  return ((input - cached) * rates.input + cached * rates.cached + output * rates.output) / 1_000_000
}

export function realtimeUsageCost(model, usage = {}) {
  const rates = realtimeRates(model)
  if (!rates) return 0
  const input = number(usage.input_tokens)
  const output = number(usage.output_tokens)
  const inputDetails = usage.input_token_details || usage.input_tokens_details || {}
  const outputDetails = usage.output_token_details || usage.output_tokens_details || {}
  const audioIn = number(inputDetails.audio_tokens)
  const textIn = Math.max(0, number(inputDetails.text_tokens) || (input - audioIn))
  const cached = Math.min(input, number(inputDetails.cached_tokens))
  const cachedDetails = inputDetails.cached_tokens_details || {}
  const cachedAudio = Math.min(audioIn, number(cachedDetails.audio_tokens))
  const cachedText = Math.min(textIn, Math.max(0, cached - cachedAudio))
  const audioOut = number(outputDetails.audio_tokens)
  const textOut = Math.max(0, number(outputDetails.text_tokens) || (output - audioOut))
  return (
    (textIn - cachedText) * rates.textInput +
    cachedText * rates.textCached +
    (audioIn - cachedAudio) * rates.audioInput +
    cachedAudio * rates.audioCached +
    textOut * rates.textOutput +
    audioOut * rates.audioOutput
  ) / 1_000_000
}

export function transcriptionUsageCost(model, usage = {}) {
  const value = String(model || '').toLowerCase()
  const seconds = number(usage.seconds ?? usage.duration_seconds ?? usage.audio_seconds ?? usage.duration)
  if (seconds > 0) {
    const perMinute = value.includes('gpt-transcribe') ? 0.0045
      : value.includes('mini-transcribe') ? 0.003
        : value.includes('transcribe') ? 0.006
          : 0
    if (perMinute) return { cost: (seconds / 60) * perMinute, seconds }
  }
  const input = number(usage.input_tokens)
  const output = number(usage.output_tokens)
  if (value.includes('gpt-4o-transcribe')) return { cost: (input * 2.5 + output * 10) / 1_000_000, seconds: 0 }
  return { cost: 0, seconds: 0 }
}

async function currentUser(auth) {
  if (!auth) return null
  const { url, key } = supabaseConfig()
  if (!url || !key) return null
  try {
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } })
    if (!response.ok) return null
    const data = await response.json()
    return data?.id ? data : null
  } catch {
    return null
  }
}

export async function logAiUsage(req, {
  feature = 'other',
  model = '',
  usage = {},
  estimatedCostUsd,
  audioSeconds = 0,
  metadata = {},
} = {}) {
  const auth = cleanBearer(req)
  if (!auth) return false
  const { url, key } = supabaseConfig()
  if (!url || !key) return false

  try {
    const user = await currentUser(auth)
    if (!user?.id) return false

    const inputDetails = usage.input_token_details || usage.input_tokens_details || {}
    const outputDetails = usage.output_token_details || usage.output_tokens_details || {}
    const inputTokens = number(usage.input_tokens)
    const cachedInputTokens = Math.min(inputTokens, number(inputDetails.cached_tokens))
    const outputTokens = number(usage.output_tokens)
    const audioInputTokens = number(inputDetails.audio_tokens)
    const audioOutputTokens = number(outputDetails.audio_tokens)
    const calculated = estimatedCostUsd == null ? responseUsageCost(model, usage) : number(estimatedCostUsd)

    const response = await fetch(`${url}/rest/v1/ana_ai_usage_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: auth,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: user.id,
        feature: String(feature || 'other').slice(0, 80),
        model: String(model || '').slice(0, 120),
        input_tokens: Math.round(inputTokens),
        cached_input_tokens: Math.round(cachedInputTokens),
        output_tokens: Math.round(outputTokens),
        audio_input_tokens: Math.round(audioInputTokens),
        audio_output_tokens: Math.round(audioOutputTokens),
        audio_seconds: number(audioSeconds),
        estimated_cost_usd: Number(calculated.toFixed(8)),
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
      }),
    })
    return response.ok
  } catch {
    return false
  }
}
