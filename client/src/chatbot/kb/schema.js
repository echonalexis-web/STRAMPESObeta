// Documentation of the KB entry shape; kb/validate.js enforces it.
// Full rationale: docs/superpowers/plans/2026-11-07-faq-navigation-chatbot.md Part B.
//
// {
//   id:       'jobseeker.profile.edit',   // unique, '<audience>.<topic>.<action>'
//   category: 'profile',                  // kb/categories.js CATEGORIES
//   kind:     'nav',                      // 'nav' | 'faq' | 'nav+faq'
//   roles:    ['jobseeker'],              // 'public' | 'jobseeker' | 'employer' | 'admin' | 'superadmin' | '*'
//   q:        { en, fil },                // <= 120 chars
//   a:        { en, fil },                // <= 600 chars, plain text, \n\n = paragraph
//   steps:    { en: [], fil: [] },        // optional, equal length, each <= 160 chars
//   keywords: { en: [..>=2], fil: [..>=2] },
//   target:   'profile.edit',             // optional route id (never a raw path)
//   targets:  [],                         // optional, max 2 extra route ids
//   followUps: [],                        // up to 3 entry ids visible to the same roles
//   contact:  false,                      // true appends the PESO contact card
//   status:   'approved' | 'draft',       // drafts never match
//   policy:   null | 'POL-NN',            // approved requires null; draft requires an id
//   reviewedAt: 'YYYY-MM-DD', reviewedBy: 'role or initials, never an email',
//   priority: 0,
// }
export const LIMITS = Object.freeze({
  q: 120,
  a: 600,
  step: 160,
  minKeywords: 2,
  maxTargets: 2,
  maxFollowUps: 3,
  maxAgeDays: 365,
  staleDiagnosticDays: 180,
});
