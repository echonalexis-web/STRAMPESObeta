import useParallaxLayer from '../hooks/useParallaxLayer'

// Green gradient hero with two ring outlines that drift slower than the page
// (parallax on the decorative layer only). No photography required.
//   <PageHero large title="Good morning," accent="Alexis." body="…"
//             actions={<Link className="ds-btn ds-btn--gold">…</Link>}
//             aside={<>…float card…</>} />
// `aside` renders a white floating card and switches the hero to two columns
// from 1024px. `accent` is the last headline line, solid gold (not gradient).
export default function PageHero({
  title,
  accent,
  body,
  actions,
  aside,
  large = false,
  titleAs = 'h1',
  as = 'section',
  className = '',
  ...rest
}) {
  // Capitalized locals so JSX can use them (the lint config ignores unused
  // capitalized variables, but not destructured parameter aliases).
  const Title = titleAs
  const Tag = as
  const ringsRef = useParallaxLayer(0.12)
  const classes = ['ds-hero', large ? 'ds-hero--lg' : '', aside ? 'ds-hero--split' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={classes} {...rest}>
      <div ref={ringsRef} className="ds-hero__rings mx-parallax" aria-hidden="true" />
      <div className="ds-hero__body">
        <Title className="ds-hero__title">
          {title}
          {accent ? (
            <>
              {' '}
              <em>{accent}</em>
            </>
          ) : null}
        </Title>
        {body ? <p className="ds-hero__lead">{body}</p> : null}
        {actions ? <div className="ds-hero__actions">{actions}</div> : null}
      </div>
      {aside ? <aside className="ds-hero__float">{aside}</aside> : null}
    </Tag>
  )
}
