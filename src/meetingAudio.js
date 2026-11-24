const SAMPLE_RATE = 16000
const PART_FRAMES = 300 * SAMPLE_RATE

function encodeWav(buffer, start, end) {
  const frameCount = end - start
  const bytes = new ArrayBuffer(44 + frameCount * 2)
  const view = new DataView(bytes)
  for (const [offset, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < tag.length; i += 1) view.setUint8(offset + i, tag.charCodeAt(i))
  }
  view.setUint32(4, bytes.byteLength - 8, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, frameCount * 2, true)

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
  for (let frame = start; frame < end; frame += 1) {
    let sample = 0
    for (const channel of channels) sample += channel[frame]
    sample = Math.max(-1, Math.min(1, sample / channels.length))
    view.setInt16(44 + (frame - start) * 2, sample * (sample < 0 ? 32768 : 32767), true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

export async function* meetingAudioParts(recording, maxBytes) {
  if (recording.size <= maxBytes) {
    yield { audio: recording, offset: 0 }
    return
  }

  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (!OfflineContext) throw new Error('This browser cannot split long recordings.')
  const context = new OfflineContext(1, 1, SAMPLE_RATE)
  const buffer = await context.decodeAudioData(await recording.arrayBuffer())
  for (let start = 0; start < buffer.length; start += PART_FRAMES) {
    yield { audio: encodeWav(buffer, start, Math.min(start + PART_FRAMES, buffer.length)), offset: start / SAMPLE_RATE }
  }
}

// Each MediaRecorder instance writes its own playable container.
export function startMeetingAudioCapture(createRecorder, onPart, { maxBytes = 22_000_000, now = () => performance.now() } = {}) {
  const startedAt = now()
  const pending = []
  let current
  let cancelled = false
  let failure

  function startPart() {
    const recorder = createRecorder()
    const pieces = []
    const offset = (now() - startedAt) / 1000
    let bytes = 0
    let report = true
    const stopped = new Promise(resolve => {
      recorder.addEventListener('stop', () => {
        if (report && !cancelled && bytes) {
          onPart({ audio: new Blob(pieces, { type: recorder.mimeType || pieces[0].type }), offset })
        }
        resolve()
      }, { once: true })
    })
    const part = { recorder, stopped }
    recorder.addEventListener('error', () => {
      failure ||= new Error('Audio capture stopped unexpectedly.')
    })
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data?.size || !report || cancelled) return
      pieces.push(data)
      bytes += data.size
      if (bytes < maxBytes || current !== part || recorder.state !== 'recording' || failure) return
      try {
        current = startPart()
        recorder.stop()
      } catch (error) {
        failure = error
      }
    })
    try {
      recorder.start(1000)
    } catch (error) {
      report = false
      throw error
    }
    pending.push(stopped)
    return part
  }

  current = startPart()
  return {
    async stop({ discard = false } = {}) {
      cancelled ||= discard
      const part = current
      current = null
      if (part && part.recorder.state !== 'inactive') part.recorder.stop()
      await Promise.all(pending)
      if (failure && !discard) throw failure
    },
  }
}
