// server/data/governmentIdTypes.js
// Canonical government ID type list, shared by User.governmentIdType and
// the applicant profile form. Mirrors client/src/constants/governmentIdTypes.js
// — keep both in sync.
const GOVERNMENT_ID_TYPE_OTHER = "Other valid government-issued ID";

const VALID_GOVERNMENT_ID_TYPES = [
  "Driver's License",
  "Passport",
  "PhilHealth ID",
  "Philippine National ID",
  "SSS ID",
  "UMID",
  "Voter's ID",
  GOVERNMENT_ID_TYPE_OTHER,
];

module.exports = VALID_GOVERNMENT_ID_TYPES;
module.exports.GOVERNMENT_ID_TYPE_OTHER = GOVERNMENT_ID_TYPE_OTHER;
