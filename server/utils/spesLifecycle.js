// SPES application lifecycle: one `status` field, explicit transitions.
//
//   submitted -> documents_review -> needs_resubmission -> documents_review ...
//   documents_review -> qualified -> evaluated -> result_recorded -> results_released
//   any pre-release state -> disqualified (reason required)
//   any pre-result state  -> withdrawn   (applicant)
//
// A result amended after release is an audited event, not a state.
// Older rows may still hold under_review / for_exam / for_interview; they are
// read through normalizeStatus().

const STATUS = Object.freeze({
  SUBMITTED: "submitted",
  DOCUMENTS_REVIEW: "documents_review",
  NEEDS_RESUBMISSION: "needs_resubmission",
  QUALIFIED: "qualified",
  EVALUATED: "evaluated",
  RESULT_RECORDED: "result_recorded",
  RESULTS_RELEASED: "results_released",
  WITHDRAWN: "withdrawn",
  DISQUALIFIED: "disqualified",
});

const LEGACY_STATUS = { under_review: STATUS.DOCUMENTS_REVIEW, for_exam: STATUS.QUALIFIED, for_interview: STATUS.QUALIFIED };

const ALL_STATUSES = [...Object.values(STATUS), ...Object.keys(LEGACY_STATUS)];

// Excluded applicants never count toward the results-release gate.
const EXCLUDED_STATUSES = [STATUS.WITHDRAWN, STATUS.DISQUALIFIED];

const normalizeStatus = (status) => LEGACY_STATUS[status] || status;

// Admin-triggered transitions (target statuses reachable from each state).
const ADMIN_TRANSITIONS = {
  [STATUS.SUBMITTED]: [STATUS.DOCUMENTS_REVIEW, STATUS.DISQUALIFIED],
  [STATUS.DOCUMENTS_REVIEW]: [STATUS.NEEDS_RESUBMISSION, STATUS.QUALIFIED, STATUS.DISQUALIFIED],
  [STATUS.NEEDS_RESUBMISSION]: [STATUS.DOCUMENTS_REVIEW, STATUS.DISQUALIFIED],
  [STATUS.QUALIFIED]: [STATUS.EVALUATED, STATUS.DISQUALIFIED],
  [STATUS.EVALUATED]: [STATUS.RESULT_RECORDED, STATUS.DISQUALIFIED],
  [STATUS.RESULT_RECORDED]: [STATUS.EVALUATED, STATUS.DISQUALIFIED],
  [STATUS.RESULTS_RELEASED]: [],
  [STATUS.WITHDRAWN]: [],
  [STATUS.DISQUALIFIED]: [],
};

// The applicant may withdraw until a result has been recorded.
const WITHDRAWABLE_FROM = [
  STATUS.SUBMITTED,
  STATUS.DOCUMENTS_REVIEW,
  STATUS.NEEDS_RESUBMISSION,
  STATUS.QUALIFIED,
  STATUS.EVALUATED,
];

const canAdminTransition = (from, to) => {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  if (f === t) return true; // no-op is always allowed
  return (ADMIN_TRANSITIONS[f] || []).includes(t);
};

const canWithdraw = (from) => WITHDRAWABLE_FROM.includes(normalizeStatus(from));

// States from which results may (still) be edited by scoring.
const CAN_RECORD_EVALUATION = [STATUS.QUALIFIED, STATUS.EVALUATED, STATUS.RESULT_RECORDED];

module.exports = {
  STATUS,
  ALL_STATUSES,
  EXCLUDED_STATUSES,
  CAN_RECORD_EVALUATION,
  normalizeStatus,
  canAdminTransition,
  canWithdraw,
};
