import { useEffect, useRef } from 'react'

// Shared parallax hook. Attach the returned ref to an element; it receives a
// `--parallax-y` CSS variable (px) that CSS can consume via
// `transform: translate3d(0, var(--parallax-y, 0px), 0)`.
// No-op under prefers-reduced-motion and below 768px.
const MAX_SHIFT = 40

export default function useParallax(speed = 0.15) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined' || !window.matchMedia) return undefined

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wide = window.matchMedia('(min-width: 768px)')
    let frame = 0
    let active = false

    const update = () => {
      frame = 0
      // Page scroller may be <body> (index.css sets overflow on html and body) or the window.
      const y = window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0
      // Clamp so the motion stays subtle on long pages.
      const shift = Math.min(y * speed, MAX_SHIFT)
      el.style.setProperty('--parallax-y', `${shift.toFixed(1)}px`)
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    const detach = () => {
      if (!active) return
      active = false
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      el.style.removeProperty('--parallax-y')
    }
    const sync = () => {
      if (reduce.matches || !wide.matches) {
        detach()
      } else if (!active) {
        active = true
        window.addEventListener('scroll', onScroll, { passive: true, capture: true })
        update()
      }
    }

    sync()
    reduce.addEventListener('change', sync)
    wide.addEventListener('change', sync)
    return () => {
      detach()
      reduce.removeEventListener('change', sync)
      wide.removeEventListener('change', sync)
    }
  }, [speed])

  return ref
}
