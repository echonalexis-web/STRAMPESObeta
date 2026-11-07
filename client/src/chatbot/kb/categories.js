// Allowed `category` values for KB entries (plan Part B).
export const CATEGORIES = Object.freeze([
  'getting-started',
  'account-login',
  'profile',
  'resume-documents',
  'jobs-applications',
  'spes',
  'employer-verification',
  'post-and-manage-jobs',
  'messages-notifications',
  'settings-privacy',
  'report-appeal',
  'contact-peso',
  'admin-tools',
]);

export const KINDS = Object.freeze(['nav', 'faq', 'nav+faq']);
export const STATUSES = Object.freeze(['approved', 'draft']);
// Concrete roles; '*' in an entry's roles means all of these.
export const ROLE_NAMES = Object.freeze(['public', 'jobseeker', 'employer', 'admin', 'superadmin']);
