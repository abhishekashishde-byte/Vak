import { useEffect, useRef, useState } from 'react'
import { CloudOff, RadioTower } from 'lucide-react'
import { getNetworkState, subscribeNetworkState } from './networkResilience.js'

export default function NetworkStatus() {
  const [state, setState] = useState(getNetworkState)
  const [restored, setRestored] = useState(false)
  const previousOnlineRef = useRef(state.online)
  const timerRef = useRef(null)

  useEffect(() => {
    const unsubscribe = subscribeNetworkState(next => {
      const wasOffline = previousOnlineRef.current === false
      previousOnlineRef.current = next.online
      setState(next)
      if (wasOffline && next.online) {
        setRestored(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setRestored(false), 3200)
      }
    })
    return () => {
      unsubscribe()
      clearTimeout(timerRef.current)
    }
  }, [])

  if (!state.online) {
    return <div className="ana-network-banner offline" role="status">
      <CloudOff size={15}/><span><strong>You’re offline.</strong> Typed translation drafts stay saved. Voice, documents and Ana’s cloud translation need a connection.</span>
    </div>
  }

  if (state.weak) {
    return <div className="ana-network-banner weak" role="status">
      <RadioTower size={15}/><span><strong>Weak connection.</strong> Translation drafts stay saved; live voice may pause or need to reconnect.</span>
    </div>
  }

  if (restored) {
    return <div className="ana-network-banner restored" role="status">
      <RadioTower size={15}/><span><strong>Back online.</strong> Ana can continue normally.</span>
    </div>
  }

  return null
}
