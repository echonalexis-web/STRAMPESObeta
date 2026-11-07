import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import '../../styles/chatbot.css';
import ChatErrorBoundary from './ChatErrorBoundary.jsx';
import ChatLauncher from './ChatLauncher.jsx';
import ChatPanel from './ChatPanel.jsx';
import { useChatContext } from './useChatContext.js';
import { useChatSession } from './useChatSession.js';
import { isHiddenPath } from './hiddenPaths.js';

const MESSENGER_OPEN_EVENT = 'floating-messenger:open';
const MOBILE_QUERY = '(max-width: 767.98px)';

function useIsMobile() {
  const get = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

function Widget() {
  const { pathname } = useLocation();
  const ctx = useChatContext();
  const session = useChatSession(ctx);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const launcherRef = useRef(null);
  const panelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    // Desktop popover has no focus restore of its own; mobile gets it from useModalA11y.
    if (launcherRef.current) launcherRef.current.focus();
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
  };

  // Opening the messenger closes the bot.
  useEffect(() => {
    const onMessenger = () => setOpen(false);
    window.addEventListener(MESSENGER_OPEN_EVENT, onMessenger);
    return () => window.removeEventListener(MESSENGER_OPEN_EVENT, onMessenger);
  }, []);

  const staff = ctx.role === 'admin' || ctx.role === 'superadmin';
  if (!ctx.ready || staff || isHiddenPath(pathname)) return null;

  const sheet = open && isMobile;
  return (
    <div className={`cb-root${sheet ? ' cb-root--sheet' : ''}`}>
      {open ? (
        <ChatPanel
          id={panelId}
          ctx={ctx}
          session={session}
          isMobile={isMobile}
          onClose={close}
          onNavigate={isMobile ? () => setOpen(false) : undefined}
        />
      ) : null}
      <ChatLauncher ref={launcherRef} open={open} panelId={panelId} onToggle={toggle} />
    </div>
  );
}

export default function ChatWidget() {
  return (
    <ChatErrorBoundary>
      <Widget />
    </ChatErrorBoundary>
  );
}
