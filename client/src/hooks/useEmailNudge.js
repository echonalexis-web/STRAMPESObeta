import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readNudge,
  recordDismissal,
  markPromptSeen,
  markBackupStepDismissed,
} from "../utils/emailNudge";

const CHANGED_EVENT = "emailnudge:changed";

// Reads the per-user "add an email" reminder state (see utils/emailNudge.js) and
// keeps every component that uses it in step: the one-time prompt, the banner and
// the backup-codes card all see a dismissal at once, on this tab and on others.
export default function useEmailNudge(userId) {
  // Bumped by the change events below; the state itself lives in localStorage.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the refresh signal
  const nudge = useMemo(() => readNudge(userId), [userId, tick]);

  const announce = useCallback(() => window.dispatchEvent(new Event(CHANGED_EVENT)), []);

  const dismiss = useCallback(() => {
    recordDismissal(userId);
    announce();
  }, [announce, userId]);
  const markSeen = useCallback(() => {
    markPromptSeen(userId);
    announce();
  }, [announce, userId]);
  const dismissBackupStep = useCallback(() => {
    markBackupStepDismissed(userId);
    announce();
  }, [announce, userId]);

  return { nudge, dismiss, markSeen, dismissBackupStep };
}
