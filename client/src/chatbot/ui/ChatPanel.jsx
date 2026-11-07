import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../../hooks/useModalA11y.js';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';

// Desktop: non-modal popover (no trap, Esc closes). Mobile: full-screen modal
// sheet whose trap, scroll lock, Esc and focus restore come from useModalA11y.
export default function ChatPanel({ id, ctx, session, isMobile, onClose, onNavigate }) {
  const { t } = useTranslation();
  const ref = useRef(null);

  useModalA11y(isMobile, onClose, ref);

  useEffect(() => {
    if (isMobile || !ref.current) return;
    const input = ref.current.querySelector('input');
    if (input) input.focus();
  }, [isMobile]);

  const onKeyDown = (e) => {
    if (!isMobile && e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      id={id}
      ref={ref}
      className="cb-panel"
      role="dialog"
      aria-modal={isMobile ? 'true' : undefined}
      aria-label={t('chatbot.panelLabel')}
      onKeyDown={onKeyDown}
    >
      <header className="cb-header">
        <div className="cb-header__text">
          <h2 className="cb-header__title">{t('chatbot.title')}</h2>
          <span className="cb-header__badge">{t('chatbot.automated')}</span>
        </div>
        <button type="button" className="cb-close" onClick={onClose} aria-label={t('chatbot.close')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </header>
      <MessageList
        messages={session.messages}
        ctx={ctx}
        onPick={session.pickChip}
        onNavigate={onNavigate}
      />
      <Composer onSend={session.send} />
    </div>
  );
}
