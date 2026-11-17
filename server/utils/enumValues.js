// One list for the profile choices that more than one layer checks (models,
// validators, controllers). "Not applicable" values are for students and people
// who have not graduated yet (for example SPES applicants).

const WORK_EXPERIENCE_VALUES = [
  "Fresh Graduate",
  "Less than 1 year",
  "1–3 years",
  "3–5 years",
  "5+ years",
  "Not applicable",
];

const EMPLOYMENT_STATUS_VALUES = ["employed", "unemployed", "not_applicable", "Prefer not to say"];
const EMPLOYMENT_TYPE_VALUES = ["wage", "self"];
const UNEMPLOYMENT_REASON_VALUES = [
  "fresh_grad",
  "finished_contract",
  "resigned",
  "retired",
  "laidoff_local",
  "laidoff_abroad",
  "lost_informal_work",
  "not_applicable",
];

module.exports = {
  WORK_EXPERIENCE_VALUES,
  EMPLOYMENT_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  UNEMPLOYMENT_REASON_VALUES,
};
