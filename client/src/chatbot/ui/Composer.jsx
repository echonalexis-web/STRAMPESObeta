import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MAX_INPUT = 200;
const SEND_COOLDOWN_MS = 600;

export default function Composer({ onSend }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [cooling, setCooling] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = (e) => {
    e.preventDefault();
    // Throttle: ignore sends during the cooldown (Enter included).
    if (cooling || !value.trim()) return;
    onSend(value);
    setValue('');
    setCooling(true);
    timer.current = setTimeout(() => setCooling(false), SEND_COOLDOWN_MS);
  };

  return (
    <form className="cb-composer" onSubmit={submit}>
      <label className="cb-sr" htmlFor="cb-input">
        {t('chatbot.inputLabel')}
      </label>
      <input
        id="cb-input"
        className="cb-input"
        type="text"
        value={value}
        maxLength={MAX_INPUT}
        placeholder={t('chatbot.placeholder')}
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="cb-send" disabled={cooling || !value.trim()} aria-label={t('chatbot.send')}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M3 11.5 21 3l-7.5 18-2.5-7.5z" fill="currentColor" />
        </svg>
      </button>
    </form>
  );
}
