// Route registry for the FAQ chatbot. Mirrors client/src/App.jsx; the drift test
// (registry.drift.test.js) fails when a static route is in neither ROUTES nor EXCLUDED.
//
// access: 'public' | 'auth'
// roles:  null = any logged-in role; else the same list as ProtectedRoute requiredRole
// gates:  subset of 'onboarding' | 'verifiedEmployer' | 'jobAge' | 'spesAge'
//         'onboarding' only marks employer routes that need completed onboarding
//         (routeNeedsCompletedOnboarding); jobseekers are gated on every auth route.
//
// labelKey: navbar.* where a fitting key exists, else chatbot.routes.<camelCaseId>
// (added to the locale files in Task 7).

const pub = (id, path, labelKey) => ({ id, path, labelKey, access: 'public', roles: null, gates: [] });
const auth = (id, path, labelKey, roles = null, gates = []) => ({
  id, path, labelKey, access: 'auth', roles, gates,
});

export const ROUTES = [
  // Public pages. Any visitor can be sent to these.
  pub('login', '/login', 'chatbot.routes.login'),
  pub('register', '/register', 'chatbot.routes.register'),
  pub('register-employer', '/register-employer', 'chatbot.routes.registerEmployer'),
  pub('forgot-password', '/forgot-password', 'chatbot.routes.forgotPassword'),
  // account-recovery is a static public route and the right answer for a visitor
  // who lost access to their email, so it is linkable (unlike the emailed-link
  // flows in EXCLUDED).
  pub('account-recovery', '/account-recovery', 'chatbot.routes.accountRecovery'),
  pub('about', '/about', 'chatbot.routes.about'),
  pub('news', '/news', 'navbar.newsFeed'),
  pub('privacy', '/privacy', 'chatbot.routes.privacy'),
  pub('terms', '/terms', 'chatbot.routes.terms'),
  pub('cookies', '/cookies', 'chatbot.routes.cookies'),

  // Any logged-in role.
  auth('change-password', '/change-password', 'chatbot.routes.changePassword'),
  auth('onboarding', '/onboarding', 'chatbot.routes.onboarding'),
  auth('messages', '/messages', 'navbar.messages'),
  auth('notifications', '/notifications', 'navbar.notifications'),
  auth('settings', '/settings', 'navbar.settings'),
  auth('profile', '/profile', 'navbar.myProfile'),
  auth('profile.favorites', '/profile/favorites', 'chatbot.routes.profileFavorites'),
  auth('profile.likes', '/profile/likes', 'chatbot.routes.profileLikes'),
  auth('profile.followers', '/profile/followers', 'chatbot.routes.profileFollowers'),
  auth('profile.edit', '/profile/edit', 'chatbot.routes.profileEdit'),
  // App.jsx has no requiredRole here; SPES age rules still apply to jobseekers.
  auth('spes.mine', '/spes/applications', 'navbar.mySpesApplications', null, ['spesAge']),
  // Jobseekers aged 15 and older can open the postings (31+ read-only), so no age gate.
  auth('spes.postings', '/spes/postings', 'navbar.spesPostings', ['jobseeker']),

  // Jobseeker only.
  auth('dashboard', '/dashboard', 'navbar.myDashboard', ['jobseeker']),
  auth('profile.documents', '/profile/documents', 'chatbot.routes.profileDocuments', ['jobseeker']),
  auth('profile.resume', '/profile/resume', 'chatbot.routes.profileResume', ['jobseeker']),
  auth('jobs', '/jobs', 'navbar.browseJobs', ['jobseeker'], ['jobAge']),
  auth('applications', '/applications', 'navbar.yourApplications', ['jobseeker'], ['jobAge']),

  // Jobseeker and employer: the full-page PESO Help (the widget is hidden for staff).
  auth('settings.peso-help', '/settings/peso-help', 'chatbot.routes.pesoHelp', ['jobseeker', 'employer']),

  // Employer only.
  auth('employer.dashboard', '/employer', 'navbar.employerDashboard', ['employer'], ['onboarding']),
  auth('post-job', '/post-job', 'navbar.postVacancy', ['employer'], ['onboarding', 'verifiedEmployer']),
];

// Static App.jsx routes the bot never links to.
export const EXCLUDED = [
  // Role-dependent redirect, not a destination.
  '/',
  // Alias of /employer.
  '/employer-dashboard',
  // Redirects to /spes/postings (kept so old links work).
  '/spes',
  // Reached only by an emailed link or a system flow.
  '/account-suspended',
  '/confirm-email',
  '/verify-email',
  '/verify-recovery-email',
  '/reset-password',
  // Only exists while username sign-up is on.
  '/forgot-username',
  '/staff-account-recovery',
  // Phase 3 (admin/superadmin bot)
  '/admin',
  '/admin/account-recovery',
  '/admin/reports',
  '/admin/news',
  '/admin/news/create',
  '/admin/users',
  '/admin/users/moderation',
  '/admin/find-account',
  '/admin/verification',
  '/admin/job-monitoring',
  '/admin/spes',
  '/admin/spes/postings',
  '/admin/spes/postings/new',
  '/admin/spes/monitoring',
  '/admin/audit-logs',
  '/superadmin',
];

const BY_ID = new Map(ROUTES.map((r) => [r.id, r]));

export function getRoute(id) {
  return BY_ID.get(id);
}
