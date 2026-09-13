import fs from 'node:fs'

const path = 'src/TalkForMeRealtime.jsx'
let text = fs.readFileSync(path, 'utf8')

const oldStart = `    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana voice.')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const pc = new RTCPeerConnection()`

const newStart = `    try {
      // Keep microphone access directly attached to the user's Start tap on iOS/WebKit.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana voice.')

      const pc = new RTCPeerConnection()`

if (!text.includes(oldStart)) throw new Error('Talk start anchor not found')
text = text.replace(oldStart, newStart)

fs.writeFileSync(path, text)
