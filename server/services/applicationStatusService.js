// The ONE place that changes a JobApplication's status. Every path that moves an
// application (employer update, employer bulk update, no-show reject, applicant withdraw,
// applicant re-apply) goes through here, so the dates the reports rely on are always set:
//
//   statusUpdatedAt   the last change (kept as before)
//   hiredAt           when the application became "hired"; cleared if the hire is undone
//   firstResponseAt   when the employer first acted on it (first move out of pending), set once
//
// server/tests/applicationStatusPaths.test.js proves every path uses this helper, and
// fails if code assigns application.status directly again.

const PENDING_VALUES = ["pending", "applied"];
const HIRED_VALUES = ["hired", "accepted"];
// Moves that count as the employer responding. Withdrawing is the applicant's own act.
const RESPONSE_VALUES = ["under_review", "reviewed", "shortlisted", "approved", "rejected", "hired", "accepted"];

const norm = (status) => String(status || "").trim().toLowerCase();

// Applies a new status and the dates that go with it. `application` is a Mongoose document
// (or any object with the same fields); the caller saves it.
const setApplicationStatus = (application, nextStatus, { now = new Date() } = {}) => {
  const previous = norm(application.status);
  const next = norm(nextStatus);

  application.status = nextStatus;
  application.statusUpdatedAt = now;

  if (!application.firstResponseAt && PENDING_VALUES.includes(previous) && RESPONSE_VALUES.includes(next)) {
    application.firstResponseAt = now;
  }

  const wasHired = HIRED_VALUES.includes(previous);
  const isHired = HIRED_VALUES.includes(next);
  if (isHired && !wasHired) {
    application.hiredAt = now;
    application.hiredAtApproximate = false;
  } else if (!isHired && wasHired) {
    // The hire was undone: it is no longer a hire, so it has no hire date.
    application.hiredAt = null;
    application.hiredAtApproximate = false;
  }
  return application;
};

// The fields that reset a row when a withdrawn application is re-submitted: it is a fresh
// application, so response and hire dates start over. Used inside `application.set({...})`.
const reactivationFields = () => ({
  status: "pending",
  statusUpdatedAt: null,
  hiredAt: null,
  hiredAtApproximate: false,
  firstResponseAt: null,
});

module.exports = { setApplicationStatus, reactivationFields, PENDING_VALUES, HIRED_VALUES, RESPONSE_VALUES };
