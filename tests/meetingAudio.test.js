import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meetingAudioParts, startMeetingAudioCapture } from '../src/meetingAudio.js'

test('short recordings use their original container', async () => {
  const audio = new Blob(['recording'], { type: 'audio/mp4' })
  for await (const part of meetingAudioParts(audio, 24 * 1024 * 1024)) {
    assert.equal(part.audio, audio)
    assert.equal(part.offset, 0)
  }
})

test('long recordings produce complete WAV files below the request limit', async t => {
  const frames = new Float32Array(300 * 16000 + 4)
  const originalContext = globalThis.OfflineAudioContext
  t.after(() => { globalThis.OfflineAudioContext = originalContext })
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() {
      return { numberOfChannels: 1, length: frames.length, getChannelData: () => frames }
    }
  }
  const parts = []
  for await (const part of meetingAudioParts(new Blob(['oversized']), 1)) parts.push(part)
  assert.deepEqual(parts.map(part => part.offset), [0, 300])
  assert.deepEqual(parts.map(part => part.audio.size), [9600044, 52])
  for (const { audio } of parts) {
    assert.equal(audio.type, 'audio/wav')
    const header = await audio.slice(0, 44).arrayBuffer()
    assert.equal(new TextDecoder().decode(header.slice(0, 4)), 'RIFF')
    assert.equal(new DataView(header).getUint32(40, true), audio.size - 44)
  }
})

test('live capture opens a new container at the size limit and flushes the final part', async () => {
  class Recorder extends EventTarget {
    mimeType = 'audio/webm'
    state = 'inactive'

    start() { this.state = 'recording' }
    stop() {
      assert.equal(this.state, 'recording')
      this.state = 'inactive'
      queueMicrotask(() => this.dispatchEvent(new Event('stop')))
    }
    data(text) {
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([text]) }))
    }
  }

  const recorders = [], parts = []
  let time = 0
  const capture = startMeetingAudioCapture(() => {
    const recorder = new Recorder()
    recorders.push(recorder)
    return recorder
  }, part => parts.push(part), { maxBytes: 6, now: () => time })

  recorders[0].data('abc')
  assert.equal(recorders.length, 1)
  time = 2000
  recorders[0].data('def')
  assert.equal(recorders[1].state, 'recording')
  recorders[1].data('ghi')
  await capture.stop()
  assert.deepEqual(await Promise.all(parts.map(part => part.audio.text())), ['abcdef', 'ghi'])
  assert.deepEqual(parts.map(part => part.offset), [0, 2])
})
