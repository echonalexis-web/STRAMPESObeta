import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';

// The chat itself: the scrolling message log (with the notice and greeting)
// and the input row. Shared by the floating panel (ChatPanel) and the PESO
// Help page so both are the same bot with the same engine, FAQ and scope.
// It renders two flex children and expects a flex-column parent with a
// bounded height.
export default function ChatView({ ctx, session, onNavigate }) {
  return (
    <>
      <MessageList
        messages={session.messages}
        ctx={ctx}
        onPick={session.pickChip}
        onNavigate={onNavigate}
      />
      <Composer onSend={session.send} />
    </>
  );
}
