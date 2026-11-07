// Shared defaults so KB files stay readable. `approved` entries are code-verified
// navigation answers; policy topics are written as drafts (see draft()).
export const REVIEWED_AT = '2026-11-08';
export const REVIEWED_BY = 'draft-by-claude-pending-PESO-review';

const base = {
  kind: 'nav',
  followUps: [],
  contact: false,
  status: 'approved',
  policy: null,
  reviewedAt: REVIEWED_AT,
  reviewedBy: REVIEWED_BY,
  priority: 0,
};

/** Approved navigation entry. */
export const entry = (o) => ({ ...base, ...o });

/**
 * Policy topic held back until PESO answers `policy`. Drafts never match; the
 * approved path for the topic is the contact-PESO entry.
 */
export const draft = (policy, o) => ({
  ...base,
  kind: 'faq',
  status: 'draft',
  policy,
  contact: true,
  reviewedAt: undefined,
  reviewedBy: undefined,
  ...o,
});
