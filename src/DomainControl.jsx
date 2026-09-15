import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { DOMAIN_OPTIONS, domainLabel, getDomainState, setDomainMode, subscribeDomain } from './domainEngine.js'

export default function DomainControl() {
  const [state, setState] = useState(getDomainState)

  useEffect(() => subscribeDomain(setState), [])

  const autoLabel = useMemo(() => {
    if (state.mode !== 'auto') return domainLabel(state.active)
    const primary = domainLabel(state.active)
    const secondary = state.secondary ? ` + ${domainLabel(state.secondary)}` : ''
    return state.active === 'general' ? 'Auto' : `Auto · ${primary}${secondary}`
  }, [state])

  return <label className="ana-domain-control" title="Ana's active domain context">
    <BrainCircuit size={15}/>
    <span className="ana-domain-control-copy"><small>Context</small><strong>{autoLabel}</strong></span>
    <select
      aria-label="Ana domain context"
      value={state.mode}
      onChange={event => setState(setDomainMode(event.target.value))}
    >
      {DOMAIN_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>
}
