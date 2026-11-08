// Typed document slots for a SPES application (RA 7323 as amended, DOLE DO 175-17).

const SPES_SLOTS = Object.freeze({
  FORM2: "form2", // SPES Form 2, duly accomplished, with recent 2x2 ID photos
  PROOF_OF_AGE: "proof_of_age", // PSA/LCR birth certificate or a government ID showing the date of birth
  PROOF_OF_FINANCIAL: "proof_of_financial_status", // parents' latest ITR OR certificate of tax exemption / low income / indigence
  PROOF_OF_ACADEMIC: "proof_of_academic_standing", // students: Form 138, class card or registrar's certification
  OSY_CERT: "osy_certification", // out-of-school youth: SWDO / Barangay certification
});

const ALL_SLOTS = Object.values(SPES_SLOTS);

const APPLICANT_TYPES = Object.freeze({ STUDENT: "student", OSY: "osy" });

// Slots every applicant must provide, by applicant type. The academic and OSY
// slots swap; the other three are common to both.
const defaultRequiredSlots = (applicantType) => [
  SPES_SLOTS.FORM2,
  SPES_SLOTS.PROOF_OF_AGE,
  SPES_SLOTS.PROOF_OF_FINANCIAL,
  applicantType === APPLICANT_TYPES.OSY ? SPES_SLOTS.OSY_CERT : SPES_SLOTS.PROOF_OF_ACADEMIC,
];

// Slots required for this applicant on this program. A program may narrow or
// reorder the list through spes.requiredSlots; unknown values are ignored and a
// slot that does not fit the applicant type is dropped.
// `program` is a posting (or a legacy announcement-shaped object with a `spes` subdocument).
const requiredSlotsFor = (program, applicantType) => {
  const raw = program?.requiredSlots ?? program?.spes?.requiredSlots;
  const configured = Array.isArray(raw) ? raw.filter((s) => ALL_SLOTS.includes(s)) : [];
  const base = configured.length > 0 ? configured : defaultRequiredSlots(applicantType);
  return base.filter((slot) => {
    if (slot === SPES_SLOTS.PROOF_OF_ACADEMIC) return applicantType !== APPLICANT_TYPES.OSY;
    if (slot === SPES_SLOTS.OSY_CERT) return applicantType === APPLICANT_TYPES.OSY;
    return true;
  });
};

// SPES uploads: PDF and photos only, 5 MB each (the global cap in upload.js).
const SPES_ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

module.exports = {
  SPES_SLOTS,
  ALL_SLOTS,
  APPLICANT_TYPES,
  SPES_ALLOWED_MIME,
  defaultRequiredSlots,
  requiredSlotsFor,
};
