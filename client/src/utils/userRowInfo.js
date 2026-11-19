// Small pure helpers for a row of the superadmin user directory.
const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days left before a deleted account is removed for good (never negative).
export function removalDays(purgeAfter, now = Date.now()) {
  if (!purgeAfter) return null;
  const at = new Date(purgeAfter).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

// "No email" note: an account with no address on file (username-only sign-up).
export const hasNoEmail = (user) => !String(user?.email ?? "").trim();

export function formatDirectoryDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
