import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

const ChatLauncher = forwardRef(function ChatLauncher({ open, panelId, onToggle }, ref) {
  const { t } = useTranslation();
  return (
    <button
      ref={ref}
      type="button"
      className="cb-launcher"
      aria-label={t(open ? 'chatbot.close' : 'chatbot.open')}
      aria-expanded={open}
      aria-controls={panelId}
      aria-haspopup="dialog"
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M9.2 9.3a2.8 2.8 0 1 1 4.3 2.4c-.9.6-1.5 1.1-1.5 2.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="17" r="1.2" fill="currentColor" />
      </svg>
    </button>
  );
});

export default ChatLauncher;
