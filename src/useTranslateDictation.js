import { useEffect, useRef, useState } from 'react'

const MAX_RECORDING_MS = 55_000

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read the voice recording.'))
    reader.readAsDataURL(blob)
  })
}

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

export function useTranslateDictation({ onTranscript, onError }) {
  const [state, setState] = useState('idle')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const mountedRef = useRef(true)
  const transcriptRef = useRef(onTranscript)
  const errorRef = useRef(onError)

  transcriptRef.current = onTranscript
  errorRef.current = onError

  const cleanupStream = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
  }

  const finishRecording = async recorder => {
    const mimeType = recorder.mimeType || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []
    cleanupStream()

    if (!blob.size) {
      if (mountedRef.current) setState('idle')
      errorRef.current?.('No speech was captured. Please try again.')
      return
    }

    if (mountedRef.current) setState('transcribing')
    try {
      const audio = await blobToBase64(blob)
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, mimeType }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Voice typing failed.')
      const text = String(data?.text || '').trim()
      if (!text) throw new Error('No speech was detected. Please try again.')
      transcriptRef.current?.(text)
    } catch (error) {
      errorRef.current?.(error?.message || 'Voice typing failed. Please try again.')
    } finally {
      recorderRef.current = null
      if (mountedRef.current) setState('idle')
    }
  }

  const start = async () => {
    if (state !== 'idle') return
    if (!navigator.onLine) {
      errorRef.current?.('Voice typing needs an internet connection.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      errorRef.current?.('Voice typing is not supported by this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = preferredMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunksRef.current.push(event.data)
      })
      recorder.addEventListener('stop', () => finishRecording(recorder), { once: true })
      recorder.addEventListener('error', () => {
        cleanupStream()
        recorderRef.current = null
        if (mountedRef.current) setState('idle')
        errorRef.current?.('Voice typing stopped unexpectedly. Please try again.')
      }, { once: true })
      recorder.start()
      setState('recording')
      timerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, MAX_RECORDING_MS)
    } catch (error) {
      cleanupStream()
      recorderRef.current = null
      setState('idle')
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
      errorRef.current?.(denied ? 'Microphone access is needed for voice typing.' : (error?.message || 'Could not start the microphone.'))
    }
  }

  const stop = () => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const toggle = () => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }

  useEffect(() => () => {
    mountedRef.current = false
    if (timerRef.current) clearTimeout(timerRef.current)
    const recorder = recorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      try { if (recorder.state === 'recording') recorder.stop() } catch {}
    }
    cleanupStream()
  }, [])

  const supported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
  return { state, start, stop, toggle, supported }
}
