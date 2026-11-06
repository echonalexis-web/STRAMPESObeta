import { useLayoutEffect } from 'react'
import { registerReveal } from '../utils/motionController'

// Soft reveal-on-first-view for the element behind `ref` (give it className
// "mx-reveal", see styles/motion.css). Runs in a layout effect so the hidden
// state is applied before first paint instead of flashing visible first.
// `index` staggers siblings. Content stays fully visible when motion is off.
export default function useReveal(ref, index = 0) {
  useLayoutEffect(() => registerReveal(ref.current, index), [ref, index])
}
