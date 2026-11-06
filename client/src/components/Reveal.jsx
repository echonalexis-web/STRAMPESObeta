import { useRef } from 'react'
import useReveal from '../hooks/useReveal'

// Wraps content that should fade/slide in once on first view. Renders a plain
// element when motion is off. Do not wrap fixed or sticky UI, table rows,
// forms or modals; keep it to first-paint cards and sections (<= ~30/page).
//   <Reveal as="li" index={i}>…</Reveal>
export default function Reveal({ as: Tag = 'div', index = 0, className = '', children, ...rest }) {
  const ref = useRef(null)
  useReveal(ref, index)
  return (
    <Tag ref={ref} className={`mx-reveal ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  )
}
