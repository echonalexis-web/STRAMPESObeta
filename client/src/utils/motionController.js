// Shared motion controller for parallax layers and scroll reveals.
//
// One passive capture scroll listener and one requestAnimationFrame per frame
// serve every registered layer; IntersectionObserver drives reveals and tells
// the controller which layers are on screen. The scroll handler reads
// scrollTop only — element rects are measured on registration, resize and
// when a layer enters view, never while scrolling. Output is a CSS variable
// (--mx-y) consumed by `transform` in styles/motion.css, so nothing here
// causes layout.
//
// Modes:
//   off     reduced motion, viewport < 768px, or no IntersectionObserver:
//           no class on <html>, no listeners, everything fully visible.
//   reveal  low-power (saveData, <=4GB memory, <=2 cores): reveals only.
//   full    parallax + reveals.
//
// The page scroller in this app is <body> (index.css/style.css give html and
// body `overflow-x: hidden` with a 100% height) — not always the window — so
// scroll events are captured and filtered to the document scroller, and the
// offset is read from both sources, like hooks/useParallax.js (which Home still
// uses and which stays untouched).

const MQ_REDUCE = '(prefers-reduced-motion: reduce)'
const MQ_WIDE = '(min-width: 768px)'
const DEFAULT_MAX = 32

const layers = new Map() // element -> { speed, max, rest, live, last }
const reveals = new Set()

let mqReduce = null
let mqWide = null
let started = false
let mode = 'off'
let attached = false
let scrollFrame = 0
let resizeFrame = 0
let revealObserver = null
let layerObserver = null

const hasDom = () => typeof window !== 'undefined' && typeof document !== 'undefined'

const scrollTop = () =>
  window.scrollY || document.body.scrollTop || document.documentElement.scrollTop || 0

function isLowPower() {
  const nav = window.navigator
  if (nav.connection && nav.connection.saveData) return true
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2) return true
  return false
}

function computeMode() {
  if (typeof window.IntersectionObserver === 'undefined') return 'off'
  if (!mqReduce || mqReduce.matches || !mqWide || !mqWide.matches) return 'off'
  return isLowPower() ? 'reveal' : 'full'
}

function getRevealObserver() {
  if (!revealObserver) {
    revealObserver = new window.IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.setAttribute('data-in', '')
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    )
  }
  return revealObserver
}

function measure(el, layer) {
  const rect = el.getBoundingClientRect()
  // rect already includes the layer's own translate, so remove it to get the
  // resting document position.
  const docTop = rect.top + scrollTop() - layer.last
  layer.rest = Math.max(0, docTop + rect.height / 2 - window.innerHeight / 2)
}

function getLayerObserver() {
  if (!layerObserver) {
    layerObserver = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const layer = layers.get(entry.target)
          if (!layer) return
          layer.live = entry.isIntersecting
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-mx-live', '')
            measure(entry.target, layer)
          } else {
            entry.target.removeAttribute('data-mx-live')
          }
        })
        schedule()
      },
      { rootMargin: '10% 0px' }
    )
  }
  return layerObserver
}

function update() {
  scrollFrame = 0
  if (mode !== 'full') return
  const y = scrollTop()
  layers.forEach((layer, el) => {
    if (!layer.live) return
    const raw = (y - layer.rest) * layer.speed
    const shift = Math.max(-layer.max, Math.min(layer.max, raw))
    if (Math.abs(shift - layer.last) < 0.1) return
    layer.last = shift
    el.style.setProperty('--mx-y', `${shift.toFixed(1)}px`)
  })
}

function schedule() {
  if (mode === 'full' && !scrollFrame) scrollFrame = window.requestAnimationFrame(update)
}

function onScroll(event) {
  const target = event.target
  // Capture phase sees every nested scroller (tables, sidebar, messenger);
  // only the page scroller moves layers.
  if (target !== document && target !== document.body && target !== document.documentElement) return
  schedule()
}

function onResize() {
  if (resizeFrame) return
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    layers.forEach((layer, el) => measure(el, layer))
    schedule()
  })
}

function attach() {
  if (attached) return
  attached = true
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', onResize, { passive: true })
}

function detach() {
  if (!attached) return
  attached = false
  window.removeEventListener('scroll', onScroll, { capture: true })
  window.removeEventListener('resize', onResize)
  if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  scrollFrame = 0
  resizeFrame = 0
}

function engage(el, layer) {
  layer.live = false
  getLayerObserver().observe(el)
  measure(el, layer)
}

function disengage(el, layer) {
  if (layerObserver) layerObserver.unobserve(el)
  layer.live = false
  layer.last = 0
  el.style.removeProperty('--mx-y')
  el.removeAttribute('data-mx-live')
}

function applyMode() {
  const next = computeMode()
  const root = document.documentElement
  mode = next

  if (next === 'off') {
    root.classList.remove('mx-on', 'mx-full')
  } else {
    root.classList.add('mx-on')
    root.classList.toggle('mx-full', next === 'full')
  }

  if (next === 'full') {
    layers.forEach((layer, el) => engage(el, layer))
    if (layers.size) attach()
  } else {
    detach()
    layers.forEach((layer, el) => disengage(el, layer))
  }

  reveals.forEach((el) => {
    if (next === 'off') el.setAttribute('data-in', '')
    else if (!el.hasAttribute('data-in')) getRevealObserver().observe(el)
  })
}

function start() {
  if (started || !hasDom()) return
  started = true
  mqReduce = window.matchMedia ? window.matchMedia(MQ_REDUCE) : null
  mqWide = window.matchMedia ? window.matchMedia(MQ_WIDE) : null
  if (mqReduce) mqReduce.addEventListener('change', applyMode)
  if (mqWide) mqWide.addEventListener('change', applyMode)
  applyMode()
}

// Register a decorative leaf element as a parallax layer. Returns cleanup.
export function registerLayer(el, { speed = 0.12, max = DEFAULT_MAX } = {}) {
  if (!hasDom() || !el) return () => {}
  start()
  const layer = { speed, max, rest: 0, live: false, last: 0 }
  layers.set(el, layer)
  if (mode === 'full') {
    engage(el, layer)
    attach()
  }
  return () => {
    disengage(el, layer)
    layers.delete(el)
    if (!layers.size) detach()
  }
}

// Register an element to fade/slide in once, the first time it enters view.
// `index` staggers siblings (capped at 11 steps of 40ms). Returns cleanup.
export function registerReveal(el, index = 0) {
  if (!hasDom() || !el) return () => {}
  start()
  el.style.setProperty('--mx-i', String(Math.max(0, Math.min(index, 11))))
  reveals.add(el)
  if (mode === 'off') el.setAttribute('data-in', '')
  else if (!el.hasAttribute('data-in')) getRevealObserver().observe(el)
  return () => {
    reveals.delete(el)
    if (revealObserver) revealObserver.unobserve(el)
  }
}

export function getMotionMode() {
  return mode
}
