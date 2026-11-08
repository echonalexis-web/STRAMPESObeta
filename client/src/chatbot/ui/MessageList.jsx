import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import BotMessage, { Chips } from './BotMessage.jsx';
import { startersFor } from './starters.js';

// Policy: every time the panel opens, the log starts at the top, even when a
// conversation already exists. Change this one value to change the rule.
export const OPEN_SCROLL_TOP = 0;

// Within this many px of the bottom counts as "following the chat".
const NEAR_BOTTOM_PX = 80;

// Instant on purpose (no smooth scroll), so reduced-motion is honored too.
function setScrollTop(el, value) {
  el.scrollTop = value;
}

export default function MessageList({ messages, ctx, onPick, onNavigate }) {
  const { t } = useTranslation();
  const logRef = useRef(null);
  const lastMsgRef = useRef(null);
  const followRef = useRef(true);
  const prevCount = useRef(null);

  // Open: pin to the top before paint, then once more after first paint in
  // case chips/fonts changed the height.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    setScrollTop(el, OPEN_SCROLL_TOP);
    followRef.current = false;
    const raf = requestAnimationFrame(() => {
      if (prevCount.current === messages.length) setScrollTop(el, OPEN_SCROLL_TOP);
    });
    return () => cancelAnimationFrame(raf);
    // Mount only: this is the "opened" moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New content during a chat.
  useLayoutEffect(() => {
    const el = logRef.current;
    const first = prevCount.current === null;
    const previous = prevCount.current;
    prevCount.current = messages.length;
    if (!el || first || messages.length === previous) return;
    const last = messages[messages.length - 1];
    if (last.from === 'user') {
      // The user's own send always comes into view.
      setScrollTop(el, el.scrollHeight);
      followRef.current = true;
    } else if (followRef.current && lastMsgRef.current) {
      // Show the START of the reply, not its end.
      const top = lastMsgRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      setScrollTop(el, Math.max(0, top - 8));
    }
  }, [messages]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={logRef}
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
      {messages.map((m, i) =>
        m.from === 'user' ? (
          <div key={m.id} ref={i === messages.length - 1 ? lastMsgRef : null} className="cb-msg cb-msg--user">
            <span className="cb-sr">{t('chatbot.you')}: </span>
            <p className="cb-p">{m.text}</p>
          </div>
        ) : (
          <div key={m.id} ref={i === messages.length - 1 ? lastMsgRef : null} className="cb-msg cb-msg--bot">
            <span className="cb-sr">{t('chatbot.bot')}: </span>
            <BotMessage result={m.result} ctx={ctx} onPick={onPick} onNavigate={onNavigate} />
          </div>
        ),
      )}
      <div className="cb-end" />
    </div>
  );
}
