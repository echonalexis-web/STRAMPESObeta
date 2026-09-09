// Shared option lists for the structured "basic requirements" block on a job
// posting. Kept in sync with the server: education levels mirror the
// `User.educationalAttainment` enum and `JobVacancy.minEducationLevel`.

import { SKILL_CATEGORIES } from "./skills";

export const EDUCATION_LEVELS = [
  "Elementary Graduate",
  "High School Graduate",
  "Senior High School Graduate",
  "Vocational / TESDA",
  "College Undergraduate",
  "College Graduate",
  "Master's Degree",
  "Doctorate",
];

// Common Philippine credentials employers ask for. These are added to the job's
// `qualifications[]` as `{ type: "license" | "certification", value }`, so the
// matcher scores them against the jobseeker's NSRP licenses / eligibilities /
// TESDA trainings.
export const COMMON_CREDENTIALS = [
  { value: "TESDA National Certificate (NC II)", type: "certification" },
  { value: "TESDA National Certificate (NC III)", type: "certification" },
  { value: "PRC Professional License", type: "license" },
  { value: "Professional Driver's License", type: "license" },
  { value: "Non-Professional Driver's License", type: "license" },
  { value: "Food Handler's Certificate", type: "certification" },
  { value: "Barangay Clearance", type: "certification" },
  { value: "NBI Clearance", type: "certification" },
  { value: "Police Clearance", type: "certification" },
  { value: "Medical / Fit-to-Work Certificate", type: "certification" },
  { value: "First Aid / BLS Certificate", type: "certification" },
  { value: "Seafarer's Identification and Record Book (SIRB)", type: "license" },
];

// Language-requirement rows on the basic-requirements block. The stored value is
// the first element; `Other` stays the canonical value (it lines up with the
// jobseeker profile's "Others" language row for matching) but reads as
// "Local Dialect" in the UI.
export const REQUIREMENT_LANGUAGES = ["English", "Filipino", "Other"];

export const LANGUAGE_LABELS = {
  English: "English",
  Filipino: "Filipino",
  Other: "Local Dialect",
};

// The four proficiency modes an employer can require per language.
export const LANGUAGE_MODES = ["read", "write", "speak", "understand"];

// ---------------------------------------------------------------------------
// "Manage Qualifications" modal — the browsable pill palette, grouped into the
// tabs the employer sees. Every entry is `{ value, type }` where `type` is one
// of the qualification types the matcher understands (skill / certification /
// license). The "All" tab is the union of these and is assembled in the editor.
// ---------------------------------------------------------------------------
const skillsOf = (...labels) =>
  labels
    .flatMap((label) => SKILL_CATEGORIES.find((c) => c.label === label)?.skills || [])
    .map((value) => ({ value, type: "skill" }));

const credsOf = (...values) =>
  values
    .map((v) => COMMON_CREDENTIALS.find((c) => c.value === v))
    .filter(Boolean);

export const MODAL_TAG_GROUPS = [
  {
    id: "soft",
    label: "Soft Skills",
    items: skillsOf("Soft skills"),
  },
  {
    id: "trades",
    label: "Trades & Service",
    items: skillsOf(
      "Trades & Manual Work",
      "Retail & Sales",
      "Healthcare & Caregiving",
      "Clerical / Office"
    ),
  },
  {
    id: "tesda",
    label: "TESDA & Certifications",
    items: credsOf(
      "TESDA National Certificate (NC II)",
      "TESDA National Certificate (NC III)",
      "PRC Professional License",
      "Professional Driver's License",
      "Non-Professional Driver's License",
      "Food Handler's Certificate",
      "Medical / Fit-to-Work Certificate",
      "First Aid / BLS Certificate",
      "Seafarer's Identification and Record Book (SIRB)"
    ),
  },
  {
    id: "clearances",
    label: "Government Clearances",
    items: credsOf("Barangay Clearance", "NBI Clearance", "Police Clearance"),
  },
];
