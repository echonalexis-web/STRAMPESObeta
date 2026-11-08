// SPES document slots and lifecycle helpers shared by the applicant and admin
// screens. Mirrors server/utils/spesDocuments.js and spesLifecycle.js; the server
// is the authority and re-validates everything.

export const SPES_SLOTS = Object.freeze({
  FORM2: "form2",
  PROOF_OF_AGE: "proof_of_age",
  PROOF_OF_FINANCIAL: "proof_of_financial_status",
  PROOF_OF_ACADEMIC: "proof_of_academic_standing",
  OSY_CERT: "osy_certification",
});

export const ALL_SPES_SLOTS = Object.values(SPES_SLOTS);

export const isOsyApplication = (app) => app?.applicantType === "osy" || app?.isOutOfSchoolYouth === true;

// Slots this program requires for this applicant type (defaults when the
// program does not narrow the list). Same rules as the server.
export const requiredSlotsFor = (spes, applicantType) => {
  const isOsy = applicantType === "osy";
  const configured = Array.isArray(spes?.requiredSlots) ? spes.requiredSlots.filter((s) => ALL_SPES_SLOTS.includes(s)) : [];
  const base =
    configured.length > 0
      ? configured
      : [
          SPES_SLOTS.FORM2,
          SPES_SLOTS.PROOF_OF_AGE,
          SPES_SLOTS.PROOF_OF_FINANCIAL,
          isOsy ? SPES_SLOTS.OSY_CERT : SPES_SLOTS.PROOF_OF_ACADEMIC,
        ];
  return base.filter((slot) => {
    if (slot === SPES_SLOTS.PROOF_OF_ACADEMIC) return !isOsy;
    if (slot === SPES_SLOTS.OSY_CERT) return isOsy;
    return true;
  });
};

// Legacy statuses read through the new lifecycle (the server does the same).
const LEGACY = { under_review: "documents_review", for_exam: "qualified", for_interview: "qualified" };
export const normalizeSpesStatus = (status) => LEGACY[status] || status;

// Visual stage of the applicant tracker.
export const SPES_STAGE_KEYS = ["submitted", "documents_review", "qualified", "evaluated", "results_released"];
const STAGE_INDEX = {
  submitted: 0,
  documents_review: 1,
  needs_resubmission: 1,
  qualified: 2,
  evaluated: 3,
  result_recorded: 3,
  results_released: 4,
};
export const spesStageIndex = (status) => STAGE_INDEX[normalizeSpesStatus(status)] ?? 0;

// Applicant may still change documents in these statuses.
export const DOCS_EDITABLE = ["submitted", "documents_review", "needs_resubmission"];
export const canEditDocs = (status) => DOCS_EDITABLE.includes(normalizeSpesStatus(status));

// Applicant may withdraw until a result has been recorded.
export const WITHDRAWABLE = ["submitted", "documents_review", "needs_resubmission", "qualified", "evaluated"];
export const canWithdrawStatus = (status) => WITHDRAWABLE.includes(normalizeSpesStatus(status));

// Mirrors the server's extension/size rule for SPES uploads.
export const SPES_ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
export const SPES_MAX_FILE_SIZE = 5 * 1024 * 1024;

export const checkSpesFile = (file) => {
  if (!file) return "SPES_DOCS_MISSING";
  if (!SPES_ALLOWED_MIME.includes(file.type)) return "SPES_FILE_TYPE";
  if (file.size > SPES_MAX_FILE_SIZE) return "SPES_FILE_TOO_LARGE";
  return null;
};
