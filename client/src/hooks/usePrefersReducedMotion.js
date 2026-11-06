import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// True while the user prefers reduced motion. Used to switch off JS-driven
// animation that CSS cannot reach (for example Recharts' isAnimationActive).
export default function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia(QUERY)
    const onChange = (event) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
