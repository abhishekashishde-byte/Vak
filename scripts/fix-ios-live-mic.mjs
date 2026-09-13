import fs from 'node:fs'

const path = 'src/LiveMode.jsx'
let text = fs.readFileSync(path, 'utf8')

const oldStart = `    try {
      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana Live.')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const pc = new RTCPeerConnection()`

const newStart = `    try {
      // iOS/WebKit requires microphone access to happen directly from the user's tap.
      // Acquire the mic before any network await so transient user activation is not lost.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mediaRef.current = stream
      startMeter(stream)

      const tokenResponse = await fetch('/api/realtime-token', { method: 'POST' })
      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData?.value) throw new Error(tokenData?.error || 'Could not start Ana Live.')

      const pc = new RTCPeerConnection()`

if (!text.includes(oldStart)) throw new Error('Live start anchor not found')
text = text.replace(oldStart, newStart)

const oldCatch = `    } catch (err) {
      setError(err.message || 'Could not start realtime interpretation.')
      stopSession(false)
    }`

const newCatch = `    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || /not allowed|permission denied|permission/i.test(String(err?.message || ''))
      setError(denied
        ? 'Microphone access is blocked for this website. Allow Microphone for Ana in your browser/site settings, then tap Start conversation again.'
        : (err?.message || 'Could not start realtime interpretation.'))
      stopSession(false)
    }`

if (!text.includes(oldCatch)) throw new Error('Live catch anchor not found')
text = text.replace(oldCatch, newCatch)

fs.writeFileSync(path, text)
