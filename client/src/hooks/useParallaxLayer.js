import { useEffect, useRef } from 'react'
import { registerLayer } from '../utils/motionController'

// Parallax for a decorative leaf element (hero rings, header art, cover). The
// returned ref goes on the element; give it className "mx-parallax" (see
// styles/motion.css). The shared controller does the scrolling work, so any
// number of layers cost one scroll listener and one rAF per frame. A no-op
// under reduced motion, below 768px and on low-power devices.
// Never attach to tables, forms, modals, or a wrapper of fixed/sticky UI.
export default function useParallaxLayer(speed = 0.12, max) {
  const ref = useRef(null)
  useEffect(() => registerLayer(ref.current, { speed, max }), [speed, max])
  return ref
}
