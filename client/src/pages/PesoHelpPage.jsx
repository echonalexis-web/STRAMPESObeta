import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FaArrowLeft, FaQuestionCircle } from 'react-icons/fa';
import '../styles/settings.css';
import '../styles/chatbot.css';
import '../styles/peso-help.css';
import ChatView from '../chatbot/ui/ChatView.jsx';
import PesoHelpFloatingToggle from '../chatbot/ui/PesoHelpFloatingToggle.jsx';
import { useChatContext } from '../chatbot/ui/useChatContext.js';
import { useChatSession } from '../chatbot/ui/useChatSession.js';

const DESKTOP_QUERY = '(min-width: 768px)';

// PESO Help as a full page (Settings > PESO Help). The same bot as the
// floating widget: same engine, FAQ, role-aware links and scope, rendered
// through the shared ChatView. The floating widget never renders on this path
// (chatbot/ui/hiddenPaths.js), so there is only ever one chat on screen.
//
// Conversation: this page has its own session (not shared with the widget,
// whose state lives inside the widget). Like the widget it is memory-only:
// nothing typed here is sent or saved, and it is gone when the tab closes.
export default function PesoHelpPage() {
  const { t } = useTranslation();
  const ctx = useChatContext();
  const session = useChatSession(ctx);
  const chatRef = useRef(null);

  // Desktop only: put the cursor in the input without scrolling anything.
  // Phones skip it so the keyboard does not pop up over the answer.
  useEffect(() => {
    if (!ctx.ready || !window.matchMedia(DESKTOP_QUERY).matches) return;
    chatRef.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [ctx.ready]);

  return (
    <div className="set cbp">
      <div className="cbp__col">
        <header className="set__pagehead">
          <span className="set__pagehead-icon" aria-hidden="true">
            <FaQuestionCircle />
          </span>
          <div className="cbp__headtext">
            <h1>{t('chatbot.title')}</h1>
            <p>{t('chatbot.automated')}</p>
          </div>
          <Link className="cbp__back" to="/settings">
            <FaArrowLeft aria-hidden="true" /> {t('chatbot.page.back')}
          </Link>
        </header>

        <section className="cbp__pref" aria-label={t('chatbot.page.prefLabel')}>
          <PesoHelpFloatingToggle />
        </section>

        {ctx.ready ? (
          <section className="cbp__chat" aria-label={t('chatbot.panelLabel')} ref={chatRef}>
            <ChatView ctx={ctx} session={session} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
