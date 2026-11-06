import { Link } from 'react-router-dom'

// One number with its label. Renders a link when `to` is given, a button when
// `onClick` is given, otherwise a static card. `attention` gives it the gold
// border used for "needs your action" counts.
//   <MetricCard icon={<Briefcase size={20} />} value={12} label="Active jobs" />
export default function MetricCard({
  icon,
  value,
  label,
  note,
  attention = false,
  to,
  onClick,
  className = '',
}) {
  const classes = ['ds-metric', attention ? 'ds-metric--attention' : '', className]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {icon ? (
        <span className="ds-metric__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ds-metric__value">{value}</span>
      <span className="ds-metric__label">{label}</span>
      {note ? <span className="ds-metric__note">{note}</span> : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    )
  }
  return <div className={classes}>{content}</div>
}
