import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

export default function SensitiveMaskingNotice() {
  const [count, setCount] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    const handler = event => {
      const next = Number(event.detail?.count || 0)
      if (!next) return
      setCount(next)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCount(0), 3600)
    }
    window.addEventListener('ana-sensitive-data-masked', handler)
    return () => {
      window.removeEventListener('ana-sensitive-data-masked', handler)
      clearTimeout(timerRef.current)
    }
  }, [])

  if (!count) return null
  return <div className="ana-sensitive-mask-notice" role="status">
    <ShieldCheck size={14}/>
    <span>Ana protected {count} sensitive {count === 1 ? 'value' : 'values'} locally before cloud processing.</span>
  </div>
}
