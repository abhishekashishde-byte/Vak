import MeetingMode from './MeetingMode.jsx'
import MeetingIntelligence from './MeetingIntelligence.jsx'
import ZoomMeetingConnector from './ZoomMeetingConnector.jsx'

export default function MeetingWorkspace() {
  return <>
    <ZoomMeetingConnector />
    <MeetingMode />
    <MeetingIntelligence />
  </>
}
