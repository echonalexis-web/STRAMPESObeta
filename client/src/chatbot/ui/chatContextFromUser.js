import { isJobVacancyEligibleAge, isSpesEligibleAge } from '../../utils/age.js';

const ROLES = ['jobseeker', 'employer', 'admin', 'superadmin'];

const LEGACY_ROLES = { employee: 'jobseeker', resident: 'jobseeker' };

export function localeFromLanguage(language) {
  const l = String(language || '').toLowerCase();
  return l.startsWith('fil') || l.startsWith('tl') ? 'fil' : 'en';
}

// Whitelist only: the user object itself is never returned.
export function mapUserToChatContext(user, language) {
  const locale = localeFromLanguage(language);
  const raw = user ? (LEGACY_ROLES[user.role] || user.role) : null;
  const role = ROLES.includes(raw) ? raw : 'public';
  const done =
    typeof user?.hasCompletedOnboarding === 'boolean'
      ? user.hasCompletedOnboarding
      : user?.onboardingComplete;
  return {
    role,
    onboardingDone: done !== false,
    mustChangePassword: user?.mustChangePassword === true,
    verifiedEmployer: role === 'employer' && user?.verificationStatus === 'verified',
    canViewJobs: isJobVacancyEligibleAge(user?.dateOfBirth),
    canApplySpes: isSpesEligibleAge(user?.dateOfBirth),
    locale,
  };
}

export function ctxKeyOf(ctx) {
  return [
    ctx.role,
    ctx.onboardingDone,
    ctx.mustChangePassword,
    ctx.verifiedEmployer,
    ctx.canViewJobs,
    ctx.canApplySpes,
    ctx.locale,
  ].join('|');
}
