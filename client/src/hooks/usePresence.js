import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { PresenceContext } from "../context/presenceContext";
import { getActiveStatusLabel } from "../utils/activeStatus";

const FALLBACK = { statuses: {}, now: 0, refreshSnapshot: () => {} };

// Raw presence context; safe outside the provider (everything hidden).
export const usePresence = () => useContext(PresenceContext) || FALLBACK;

// The label for one user: { kind, text, showDot }. A missing or hidden status
// shows nothing. It recomputes every minute from the same lastActiveAt, with
// no refetch.
export const useActiveStatus = (userId) => {
  const { t } = useTranslation();
  const { statuses, now } = usePresence();
  if (!userId) return getActiveStatusLabel(null, now, t);
  return getActiveStatusLabel(statuses[String(userId)], now, t);
};
