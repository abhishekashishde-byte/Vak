let installed = false
let connecting = null
let peer = null
let channel = null
let remoteAudio = null
let currentUtterance = null
let currentResponseId = null
let nativeSpeak = null
let nativeCancel = null

const languageName = code => {
  const value = String(code || '').toLowerCase()
  if (value.startsWith('de')) return 'German'
  if (value.startsWith('hi')) return 'Hindi'
  if (value.startsWith('fr')) return 'French'
  if (value.startsWith('es')) return 'Spanish'
  if (value.startsWith('it')) return 'Italian'
  if (value.startsWith('en-in')) return 'natural Indian English/Hinglish pronunciation'
  return 'English'
}

const cleanupConnection = () => {
  try { channel?.close() } catch {}
  try { peer?.close() } catch {}
  try {
    if (remoteAudio) {
      remoteAudio.pause?.()
      remoteAudio.srcObject = null
    }
  } catch {}
  channel = null
  peer = null
  remoteAudio = null
  connecting = null
  currentResponseId = null
}

const failCurrent = error => {
  const utterance = currentUtterance
  currentUtterance = null
  currentResponseId = null
  if (utterance?.onerror) {
    try { utterance.onerror({ error: error?.message || 'realtime-voice-error' }) } catch {}
  }
}

const finishCurrent = () => {
  const utterance = currentUtterance
  currentUtterance = null
  currentResponseId = null
  if (utterance?.onend) {
    try { utterance.onend({}) } catch {}
  }
}

async function connectRealtimeVoice() {
  if (channel?.readyState === 'open' && peer?.connectionState !== 'failed') return
  if (connecting) return connecting

  connecting = (async () => {
    const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData?.value) {
      throw new Error(tokenData?.error || 'Could not start Ana voice.')
    }

    const pc = new RTCPeerConnection()
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.playsInline = true
    audio.setAttribute('aria-hidden', 'true')
    audio.style.display = 'none'
    document.body.appendChild(audio)

    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = event => {
      audio.srcObject = event.streams[0]
      audio.play?.().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) cleanupConnection()
    }

    const dc = pc.createDataChannel('ana-natural-voice')
    dc.addEventListener('message', message => {
      let event
      try { event = JSON.parse(message.data) } catch { return }

      if (event.type === 'response.created') {
        currentResponseId = event.response?.id || currentResponseId
      }

      if (event.type === 'response.done') {
        const id = event.response?.id
        if (!currentResponseId || !id || id === currentResponseId) finishCurrent()
      }

      if (event.type === 'error') {
        failCurrent(new Error(event.error?.message || 'Ana voice error.'))
      }
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${tokenData.value}`,
        'Content-Type': 'application/sdp',
      },
    })
    const answer = await sdpResponse.text()
    if (!sdpResponse.ok) throw new Error(answer || 'Could not connect Ana voice.')
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ana voice connection timed out.')), 10000)
      dc.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      dc.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Ana voice connection failed.')) }, { once: true })
    })

    peer = pc
    channel = dc
    remoteAudio = audio

    dc.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: 'You are Ana’s voice renderer. Speak only the requested text. Never answer, translate, paraphrase, add, remove, or explain content. Sound natural, calm, human and conversational rather than like text-to-speech.',
        audio: { output: { voice: 'marin' } },
      },
    }))
  })()

  try {
    await connecting
  } catch (error) {
    cleanupConnection()
    throw error
  } finally {
    connecting = null
  }
}

async function speakRealtime(utterance) {
  const text = String(utterance?.text || '').trim()
  if (!text) {
    utterance?.onend?.({})
    return
  }

  try {
    await connectRealtimeVoice()
    if (!channel || channel.readyState !== 'open') throw new Error('Ana voice is not connected.')

    if (currentUtterance) {
      try { channel.send(JSON.stringify({ type: 'response.cancel' })) } catch {}
    }

    currentUtterance = utterance
    currentResponseId = null
    const language = languageName(utterance.lang)
    const pace = Number(utterance.rate || 1) < 0.9 ? 'slightly slower than normal' : Number(utterance.rate || 1) > 1.08 ? 'slightly brisk' : 'natural conversational pace'

    channel.send(JSON.stringify({
      type: 'response.create',
      response: {
        instructions: `Speak the text below EXACTLY as written. Do not translate or paraphrase it. Use native, natural ${language} pronunciation, ${pace}, human phrasing and appropriate intonation from the punctuation and meaning. Avoid a robotic or announcer-like delivery.\n\nTEXT TO SPEAK:\n${text}`,
      },
    }))
  } catch (error) {
    currentUtterance = null
    currentResponseId = null
    if (nativeSpeak) {
      try { nativeSpeak(utterance) } catch { utterance?.onerror?.({ error: error?.message || 'voice-error' }) }
    } else {
      utterance?.onerror?.({ error: error?.message || 'voice-error' })
    }
  }
}

export function installAnaNaturalVoice() {
  if (installed || typeof window === 'undefined' || !window.speechSynthesis || !window.RTCPeerConnection) return
  installed = true

  const synthesis = window.speechSynthesis
  nativeSpeak = synthesis.speak.bind(synthesis)
  nativeCancel = synthesis.cancel.bind(synthesis)

  try {
    synthesis.speak = utterance => { speakRealtime(utterance) }
    synthesis.cancel = () => {
      const active = currentUtterance
      currentUtterance = null
      currentResponseId = null
      try {
        if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'response.cancel' }))
      } catch {}
      try {
        if (remoteAudio) {
          remoteAudio.pause?.()
          remoteAudio.currentTime = 0
          remoteAudio.play?.().catch(() => {})
        }
      } catch {}
      if (active?.onend) {
        try { active.onend({ cancelled: true }) } catch {}
      }
    }
  } catch {
    installed = false
    nativeSpeak = null
    nativeCancel = null
  }
}

export function closeAnaNaturalVoice() {
  if (currentUtterance) {
    try { channel?.send(JSON.stringify({ type: 'response.cancel' })) } catch {}
  }
  currentUtterance = null
  cleanupConnection()
}
