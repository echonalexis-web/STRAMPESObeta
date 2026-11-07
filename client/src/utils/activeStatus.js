// Messenger-style "active status": shared constants and the label logic.
// Everything tunable is in ACTIVE_STATUS below so the thresholds live in one
// place, not scattered across components.

export const ACTIVE_STATUS = Object.freeze({
  // --- activity tracking (components/ActiveStatusReporter.jsx) ---
  // At most one repeated "active" message per this long.
  ACTIVITY_THROTTLE_MS: 30 * 1000,
  // While active, a heartbeat is sent this often so the server does not
  // expire the user. The server's grace period is longer than this.
  HEARTBEAT_MS: 30 * 1000,
  // No interaction for this long means idle.
  IDLE_AFTER_MS: 2 * 60 * 1000,
  // A hidden tab becomes idle after this short delay.
  HIDDEN_IDLE_DELAY_MS: 15 * 1000,

  // --- label cutoffs (getActiveStatusLabel) ---
  // Labels are recomputed this often without refetching anything.
  LABEL_REFRESH_MS: 60 * 1000,
  // Under 1 minute ago        -> "Active just now"
  JUST_NOW_UNDER_MS: 60 * 1000,
  // 1 to 59 minutes ago       -> "Active N minute(s) ago"
  MINUTES_UNDER_MS: 60 * 60 * 1000,
  // 1 to 23 hours ago         -> "Active N hour(s) ago"
  HOURS_UNDER_MS: 24 * 60 * 60 * 1000,
  // 24 to 47 hours ago        -> "Active yesterday"; 48 hours or more -> "Inactive"
  YESTERDAY_UNDER_MS: 48 * 60 * 60 * 1000,
});

// Socket.IO event names; must match server/services/activeStatusService.js.
export const PRESENCE_EVENTS = Object.freeze({
  UPDATE: "presence:update",
  SNAPSHOT_REQUEST: "presence:snapshot:request",
  CHANGED: "presence:changed",
  SNAPSHOT: "presence:snapshot",
  RESET: "presence:reset",
});

const HIDDEN = Object.freeze({ kind: "hidden", text: "", showDot: false });

/**
 * @param {{state: "active"|"inactive"|"hidden", lastActiveAt: string|null}|null|undefined} status
 *        what the server told us about this user; missing or hidden shows nothing
 * @param {number} now  current time in ms
 * @param {(key: string, options?: object) => string} t  i18next translate function
 * @returns {{kind: "hidden"|"active"|"recent"|"inactive", text: string, showDot: boolean}}
 */
export const getActiveStatusLabel = (status, now, t) => {
  if (!status || status.state === "hidden") return HIDDEN;
  if (status.state === "active") {
    return { kind: "active", text: t("presence.activeNow"), showDot: true };
  }

  const last = status.lastActiveAt ? new Date(status.lastActiveAt).getTime() : NaN;
  if (Number.isNaN(last)) {
    return { kind: "inactive", text: t("presence.inactive"), showDot: false };
  }

  const elapsed = Math.max(0, now - last);
  const { JUST_NOW_UNDER_MS, MINUTES_UNDER_MS, HOURS_UNDER_MS, YESTERDAY_UNDER_MS } = ACTIVE_STATUS;

  if (elapsed < JUST_NOW_UNDER_MS) return { kind: "recent", text: t("presence.activeJustNow"), showDot: false };
  if (elapsed < MINUTES_UNDER_MS) {
    return { kind: "recent", text: t("presence.activeMinutes", { count: Math.floor(elapsed / 60000) }), showDot: false };
  }
  if (elapsed < HOURS_UNDER_MS) {
    return { kind: "recent", text: t("presence.activeHours", { count: Math.floor(elapsed / 3600000) }), showDot: false };
  }
  if (elapsed < YESTERDAY_UNDER_MS) return { kind: "recent", text: t("presence.activeYesterday"), showDot: false };
  return { kind: "inactive", text: t("presence.inactive"), showDot: false };
};
