// Mirrors client/src/routes/ProtectedRoute.jsx and JobVacancyAgeGate.jsx, in the
// same order: login, mustChangePassword, onboarding, employer verification,
// role mismatch, then the age gates. Public routes are not wrapped in
// ProtectedRoute, so they are always links.
import { getRoute } from './registry.js';

const link = (routeId) => {
  const r = getRoute(routeId);
  return { kind: 'link', routeId, path: r.path };
};

const blocked = (reason, alternative) => ({ kind: 'blocked', reason, alternative });

function needsCompletedOnboarding(role, route) {
  if (role === 'jobseeker') return route.id !== 'onboarding';
  if (role === 'employer') return route.gates.includes('onboarding');
  return false;
}

export function resolveLink(routeId, ctx) {
  const route = getRoute(routeId);
  if (!route) return { kind: 'hidden' };
  if (route.access === 'public') return link(routeId);

  const { role } = ctx;
  if (role === 'public') return { kind: 'login', path: '/login' };

  if (ctx.mustChangePassword && routeId !== 'change-password') {
    return blocked('password', link('change-password'));
  }

  if (ctx.onboardingDone === false && needsCompletedOnboarding(role, route)) {
    return blocked('onboarding', link('onboarding'));
  }

  if (role === 'employer' && !ctx.verifiedEmployer && route.gates.includes('verifiedEmployer')) {
    return blocked('verification', link('profile'));
  }

  if (route.roles && !route.roles.includes(role)) return { kind: 'hidden' };

  if (role === 'jobseeker') {
    if (route.gates.includes('jobAge') && !ctx.canViewJobs) {
      return blocked('age-min', link(ctx.canApplySpes ? 'spes.mine' : 'news'));
    }
    if (route.gates.includes('spesAge') && !ctx.canApplySpes) {
      // Over the SPES ceiling can browse jobs; otherwise (too young / unknown DOB) point to news.
      return ctx.canViewJobs
        ? blocked('age-max', link('jobs'))
        : blocked('age-min', link('news'));
    }
  }

  return link(routeId);
}
