import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSrtTime, meetingSegmentsToSrt } from '../src/meetingSrt.js'

test('SRT timestamps format milliseconds correctly', () => {
  assert.equal(formatSrtTime(3661.125), '01:01:01,125')
  assert.equal(formatSrtTime(-2), '00:00:00,000')
})

test('SRT export retains timestamps, reviewed text and speaker names', () => {
  const srt = meetingSegmentsToSrt([
    { start: 0, end: 2.25, speaker: 'Speaker 1', text: 'Hallo zusammen.' },
    { start: 2.5, end: 4, speaker: 'Speaker 2', text: 'Good morning.' },
  ], { 'Speaker 1': 'Anna' })
  assert.match(srt, /1\n00:00:00,000 --> 00:00:02,250\nAnna: Hallo zusammen\./)
  assert.match(srt, /2\n00:00:02,500 --> 00:00:04,000\nSpeaker 2: Good morning\./)
})

test('SRT export ignores empty segments and repairs invalid end times', () => {
  const srt = meetingSegmentsToSrt([{ start: 10, end: 5, text: 'Continue' }, { start: 12, text: '  ' }])
  assert.match(srt, /00:00:10,000 --> 00:00:10,500/)
  assert.doesNotMatch(srt, /\n2\n/)
})
