import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useFloatingHelpPref } from '../../hooks/useFloatingHelpPref.js';

// "Show PESO Help floating button" switch. Used in Settings > System
// Preferences and on the PESO Help page; both read and write the same stored
// value through useFloatingHelpPref, so they stay in sync. Uses the existing
// Settings toggle styles (settings.css).
export default function PesoHelpFloatingToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useFloatingHelpPref();
  const id = useId();
  return (
    <label className="set-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
      <span className="set-toggle__track" aria-hidden="true">
        <span className="set-toggle__thumb" />
      </span>
      <span className="set-toggle__text">
        <span className="set-toggle__label">{t('chatbot.pref.label')}</span>
        <span className="set-toggle__hint">{t('chatbot.pref.hint')}</span>
      </span>
    </label>
  );
}
