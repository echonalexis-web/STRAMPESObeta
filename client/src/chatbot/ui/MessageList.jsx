import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import BotMessage, { Chips } from './BotMessage.jsx';
import { startersFor } from './starters.js';

export default function MessageList({ messages, ctx, onPick, onNavigate }) {
  const { t } = useTranslation();
  const endRef = useRef(null);

  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div
      className="cb-log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={t('chatbot.messagesLabel')}
      tabIndex={0}
    >
      <div className="cb-msg cb-msg--bot cb-msg--notice">
        <p className="cb-p">{t('chatbot.notice')}</p>
      </div>
      {messages.length === 0 ? (
        <div className="cb-msg cb-msg--bot">
          <p className="cb-p">{t('chatbot.greeting')}</p>
          <Chips ids={startersFor(ctx.role)} ctx={ctx} onPick={onPick} />
        </div>
      ) : null}
      {messages.map((m) =>
        m.from === 'user' ? (
          <div key={m.id} className="cb-msg cb-msg--user">
            <span className="cb-sr">{t('chatbot.you')}: </span>
            <p className="cb-p">{m.text}</p>
          </div>
        ) : (
          <div key={m.id} className="cb-msg cb-msg--bot">
            <span className="cb-sr">{t('chatbot.bot')}: </span>
            <BotMessage result={m.result} ctx={ctx} onPick={onPick} onNavigate={onNavigate} />
          </div>
        ),
      )}
      <div ref={endRef} className="cb-end" />
    </div>
  );
}
