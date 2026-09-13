import { useEffect, useState } from 'react'
import { CloudOff, RadioTower } from 'lucide-react'
import { getNetworkState, subscribeNetworkState } from './networkResilience.js'

export default function NetworkStatus() {
  const [state, setState] = useState(getNetworkState)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    let timer
    return subscribeNetworkState(next => {
      const wasOffline = state.online === false
      setState(next)
      if (wasOffline && next.online) {
        setRestored(true)
        clearTimeout(timer)
        timer = setTimeout(() => setRestored(false), 3200)
      }
    })
  }, [state.online])

  if (!state.online) {
    return <div className="ana-network-banner offline" role="status">
      <CloudOff size={15}/><span><strong>You’re offline.</strong> Ana will keep your current work. Voice, documents and cloud translation need a connection.</span>
    </div>
  }

  if (state.weak) {
    return <div className="ana-network-banner weak" role="status">
      <RadioTower size={15}/><span><strong>Weak connection.</strong> Ana will preserve your work if the connection drops; live voice may need to reconnect.</span>
    </div>
  }

  if (restored) {
    return <div className="ana-network-banner restored" role="status">
      <RadioTower size={15}/><span><strong>Back online.</strong> Ana can continue normally.</span>
    </div>
  }

  return null
}
