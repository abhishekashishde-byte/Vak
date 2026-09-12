let observer
let recorder
let activeStream
let chunks = []
let activeButton

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('Could not read voice note'))
    reader.readAsDataURL(blob)
  })
}

function setReactTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, value)
  else textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus()
}

function stopTracks() {
  activeStream?.getTracks?.().forEach(track => track.stop())
  activeStream = null
}

function setButtonState(button, state) {
  button.dataset.state = state
  if (state === 'recording') {
    button.setAttribute('aria-label', 'Stop voice briefing')
    button.title = 'Stop and transcribe'
    button.innerHTML = '<span class="brief-voice-dot"></span>'
  } else if (state === 'transcribing') {
    button.setAttribute('aria-label', 'Transcribing voice briefing')
    button.title = 'Transcribing…'
    button.innerHTML = '<span class="brief-voice-spinner"></span>'
  } else {
    button.setAttribute('aria-label', 'Speak your briefing')
    button.title = 'Speak instead of typing'
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8"/></svg>'
  }
}

async function transcribe(blob, textarea, button) {
  try {
    setButtonState(button, 'transcribing')
    const audio = await toBase64(blob)
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm' }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not transcribe your voice')

    const spoken = String(data.text || '').trim()
    if (!spoken) throw new Error('No speech was detected')
    const existing = String(textarea.value || '').trim()
    setReactTextareaValue(textarea, existing ? `${existing} ${spoken}` : spoken)
  } catch (error) {
    console.error('[Ana briefing voice]', error)
    button.title = error.message || 'Voice input failed'
  } finally {
    setButtonState(button, 'idle')
    stopTracks()
    recorder = null
    activeButton = null
    chunks = []
  }
}

async function startRecording(textarea, button) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    button.title = 'Voice recording is not supported in this browser'
    return
  }

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const preferred = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ].find(type => MediaRecorder.isTypeSupported?.(type))

    recorder = preferred ? new MediaRecorder(activeStream, { mimeType: preferred }) : new MediaRecorder(activeStream)
    chunks = []
    activeButton = button
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || preferred || 'audio/webm' })
      transcribe(blob, textarea, button)
    }
    recorder.onerror = () => {
      setButtonState(button, 'idle')
      stopTracks()
      recorder = null
      activeButton = null
      chunks = []
    }

    recorder.start()
    setButtonState(button, 'recording')
  } catch (error) {
    console.error('[Ana briefing voice]', error)
    button.title = 'Microphone permission is required'
    setButtonState(button, 'idle')
    stopTracks()
  }
}

function addVoiceButton() {
  const row = document.querySelector('.brief-input-row')
  if (!row || row.querySelector('.brief-voice-btn')) return
  const textarea = row.querySelector('textarea')
  const sendButton = row.querySelector('button')
  if (!textarea || !sendButton) return

  row.classList.add('has-voice-input')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'brief-voice-btn'
  setButtonState(button, 'idle')

  button.addEventListener('click', async event => {
    event.preventDefault()
    if (button.dataset.state === 'transcribing') return
    if (button.dataset.state === 'recording') {
      try { recorder?.stop() } catch {}
      return
    }
    if (recorder && activeButton && activeButton !== button) {
      try { recorder.stop() } catch {}
    }
    await startRecording(textarea, button)
  })

  row.insertBefore(button, sendButton)
}

function initialise() {
  addVoiceButton()
  observer = new MutationObserver(addVoiceButton)
  observer.observe(document.body, { childList: true, subtree: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise, { once: true })
else initialise()
