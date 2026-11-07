// Pages where the bot never renders. Includes every BARE_ROUTES path in App.jsx
// (account-suspended, change-password, profile/edit) and the form-heavy auth
// screens, where a bottom-right launcher could cover a submit button on small
// phones. Auth screens stay hidden until verified in a real browser at 320px.
export const HIDDEN_PATHS = Object.freeze([
  '/messages',
  '/profile/edit',
  '/onboarding',
  '/change-password',
  '/account-suspended',
  '/login',
  '/register',
  '/register-employer',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/confirm-email',
  '/verify-recovery-email',
  '/account-recovery',
  '/staff-account-recovery',
]);

export function isHiddenPath(pathname) {
  const p = String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  return HIDDEN_PATHS.some((h) => p === h || p.startsWith(`${h}/`));
}
