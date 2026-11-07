import "../styles/active-status.css";
import { useActiveStatus } from "../hooks/usePresence";

// Wraps an avatar and adds the green "active now" dot (white ring) in its
// corner, only when the user is active now. The dot is never the only signal:
// it carries visually hidden text. The wrapper sits OUTSIDE the avatar so an
// avatar's overflow:hidden cannot clip the dot.
export function ActiveAvatar({ userId, children, className = "" }) {
  const status = useActiveStatus(userId);
  return (
    <span className={`active-avatar ${className}`.trim()}>
      {children}
      {status.showDot ? (
        <span className="active-dot">
          <span className="ds-sr-only">{status.text}</span>
        </span>
      ) : null}
    </span>
  );
}

// "Active now · Jobseeker": the status (if visible) followed by a suffix such
// as the role. A hidden user shows only the suffix.
export function ActiveStatusLine({ userId, suffix = "", className = "" }) {
  const status = useActiveStatus(userId);
  const visible = status.kind !== "hidden";
  return (
    <>
      {visible ? <span className={`active-status-text is-${status.kind} ${className}`.trim()}>{status.text}</span> : null}
      {visible && suffix ? " · " : ""}
      {suffix}
    </>
  );
}

// Small status text: "Active now", "Active 15 minutes ago", "Inactive"...
// Renders nothing for hidden users (no text at all, not even "Inactive").
export function ActiveStatusText({ userId, className = "" }) {
  const status = useActiveStatus(userId);
  if (status.kind === "hidden") return null;
  return <span className={`active-status-text is-${status.kind} ${className}`.trim()}>{status.text}</span>;
}
