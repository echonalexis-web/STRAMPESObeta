// Which account state a directory row is in, and which buttons it gets.
// Mirrors the server: deletion is a marker (deletedAt) on top of an inactive
// account, so it wins over suspended / deactivated when both are true.

export const DELETE_REASONS = [
  "policy_violation",
  "fraud_or_fake",
  "duplicate_account",
  "user_request",
  "inactive",
  "other",
];

export function getAccountState(user) {
  if (!user) return "active";
  if (user.deletedAt) return "deleted";
  if (user.isActive === false) {
    if (user.accountStatus === "banned") return "banned";
    if (user.accountStatus === "deactivated") return "deactivated";
    return "suspended";
  }
  return "active";
}

// Active -> Deactivate. Inactive (suspended, banned or self-deactivated) ->
// Reactivate and Delete. Deleted -> Restore only. Staff rows get nothing.
export function getAvailableActions(user) {
  const state = getAccountState(user);
  const staff = user && (user.role === "admin" || user.role === "superadmin");
  if (staff) return { deactivate: false, reactivate: false, delete: false, restore: false };
  return {
    deactivate: state === "active",
    reactivate: state === "suspended" || state === "banned" || state === "deactivated",
    delete: state === "suspended" || state === "banned" || state === "deactivated",
    restore: state === "deleted",
  };
}

// The delete button unlocks only with a reason and the exact username or email.
export function canConfirmDelete({ user, reason, typed }) {
  if (!user || !DELETE_REASONS.includes(reason)) return false;
  const given = String(typed || "").trim().toLowerCase();
  if (!given) return false;
  return [user.username, user.email]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === given);
}

// What the confirmation asks the admin to type: the username if there is one,
// otherwise the email.
export function confirmationTarget(user) {
  return (user && (user.username || user.email)) || "";
}
