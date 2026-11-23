// Export reviewed, time-aligned meeting segments as standard SRT subtitles.
// Speaker names are included so exported subtitles retain meeting context.
export function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return [hours, minutes, secs].map(n => String(n).padStart(2, '0')).join(':') + ',' + String(millis).padStart(3, '0')
}

export function meetingSegmentsToSrt(segments = [], speakerNames = {}) {
  return segments.filter(segment => String(segment?.text || '').trim()).map((segment, index) => {
    const start = Math.max(0, Number(segment.start) || 0)
    const end = Math.max(start + 0.5, Number(segment.end) || start + 3)
    const speaker = String(speakerNames[segment.speaker] || segment.speaker || '').trim()
    const spoken = String(segment.text).trim().replace(/\r\n?/g, '\n')
    return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${speaker ? speaker + ': ' : ''}${spoken}\n`
  }).join('\n')
}
