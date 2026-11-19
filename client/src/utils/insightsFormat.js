// Small pure helpers for the Account insights panel.

// i18n keys cannot contain dots (they are path separators), so an audit action
// like "admin.user.deactivated" is looked up as "admin_user_deactivated".
export const actionKey = (action) => String(action || "").replace(/\./g, "_");

// Which sections of the insights apply, from the server's response shape.
export const insightsKind = (insights) => {
  if (insights?.jobseeker) return "jobseeker";
  if (insights?.employer) return "employer";
  return null;
};

// "Held until" label data for the lock line.
export const lockState = (security) => {
  if (!security || !security.lockedNow) return { locked: false, until: null };
  return { locked: true, until: security.lockedUntil || null };
};
