import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import BotMessage, { Chips } from './BotMessage.jsx';
import { startersFor } from './starters.js';

// Policy: every time the chat opens, the log starts at the top, even when a
// conversation already exists. Change this one value to change the rule.
export const OPEN_SCROLL_TOP = 0;

// Breathing room above the message a scroll aligns to.
const ALIGN_GAP_PX = 8;

// Instant on purpose (no smooth scroll), so reduced-motion is honored too.
function setScrollTop(el, value) {
  el.scrollTop = value;
}

// Shared by the floating panel and the PESO Help page (via ChatView).
export default function MessageList({ messages, ctx, onPick, onNavigate }) {
  const { t } = useTranslation();
  const logRef = useRef(null);
  const lastIdRef = useRef(null); // id of the newest message already handled

  const lastId = messages.length ? messages[messages.length - 1].id : 0;

  // Open: pin to the top before paint, then once more after the first paint in
  // case chips or fonts changed the height.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    setScrollTop(el, OPEN_SCROLL_TOP);
    const idAtOpen = lastId;
    const raf = requestAnimationFrame(() => {
      if (lastIdRef.current === idAtOpen) setScrollTop(el, OPEN_SCROLL_TOP);
    });
    return () => cancelAnimationFrame(raf);
    // Mount only: this is the "opened" moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New content while chatting. Every append here comes from the user's own
  // action (sending a question or tapping a chip) and the reply is added in the
  // same step, so the log always follows. It aligns the START of the new
  // content (the user's message, then the reply right under it) to the top of
  // the log: short exchanges end up fully in view, and a long reply is read
  // from its first line, not its end.
  useLayoutEffect(() => {
    const el = logRef.current;
    const previous = lastIdRef.current;
    lastIdRef.current = lastId;
    if (!el || previous === null || lastId === previous) return;
    if (lastId < previous) {
      setScrollTop(el, OPEN_SCROLL_TOP); // conversation was reset
      return;
    }
    const firstNew = messages.find((m) => m.id > previous);
    const node = firstNew ? el.querySelector(`[data-mid="${firstNew.id}"]`) : null;
    if (!node) return;
    const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    setScrollTop(el, Math.max(0, offset - ALIGN_GAP_PX));
  }, [lastId, messages]);

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
      {messages.map((m) =>
        m.from === 'user' ? (
          <div key={m.id} data-mid={m.id} className="cb-msg cb-msg--user">
            <span className="cb-sr">{t('chatbot.you')}: </span>
            <p className="cb-p">{m.text}</p>
          </div>
        ) : (
          <div key={m.id} data-mid={m.id} className="cb-msg cb-msg--bot">
            <span className="cb-sr">{t('chatbot.bot')}: </span>
            <BotMessage result={m.result} ctx={ctx} onPick={onPick} onNavigate={onNavigate} />
          </div>
        ),
      )}
      <div className="cb-end" />
    </div>
  );
}
