import { CircleAlert, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// Shared loading / empty / error block so every list or data view has a
// designed state. Strings default to common.* keys (en + fil) and can be
// overridden with `title` / `description`.
//   <StateBlock kind="loading" />
//   <StateBlock kind="empty" title={t('…')} description={t('…')} />
//   <StateBlock kind="error" onRetry={refetch} />
export default function StateBlock({
  kind = 'empty',
  title,
  description,
  onRetry,
  action,
  className = '',
}) {
  const { t } = useTranslation()
  const classes = ['ds-state', `ds-state--${kind}`, className].filter(Boolean).join(' ')

  if (kind === 'loading') {
    return (
      <div className={classes} role="status" aria-live="polite">
        <span className="ds-skeleton" aria-hidden="true" />
        <span className="ds-skeleton" aria-hidden="true" />
        <p className="ds-state__text">{title || t('common.loading')}</p>
      </div>
    )
  }

  const isError = kind === 'error'
  const Icon = isError ? CircleAlert : Inbox

  return (
    <div className={classes} role={isError ? 'alert' : undefined}>
      <span className="ds-state__icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <h3 className="ds-state__title">
        {title || (isError ? t('common.errorTitle') : t('common.emptyTitle'))}
      </h3>
      <p className="ds-state__text">
        {description || (isError ? t('common.errorDescription') : t('common.emptyDescription'))}
      </p>
      {onRetry || action ? (
        <div className="ds-state__actions">
          {action}
          {onRetry ? (
            <button type="button" className="ds-btn ds-btn--secondary" onClick={onRetry}>
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
