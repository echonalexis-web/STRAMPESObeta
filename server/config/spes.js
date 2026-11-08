// Tunable SPES policy values. Read once at startup; override with env vars.
// These are placeholders pending confirmation from PESO / the adviser, kept in
// one place so they are easy to change later.

const toBool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
};

module.exports = {
  // 15-17 applicants must give a guardian name and contact number. Pending
  // confirmation of PESO's consent rule; set SPES_GUARDIAN_REQUIRED=false to relax.
  guardianRequiredForMinors: toBool(process.env.SPES_GUARDIAN_REQUIRED, true),

  // How long SPES applications and their documents are kept. Placeholder of 5
  // years, to be confirmed by PESO. Nothing is deleted automatically yet; this
  // value is exposed for the future retention job and the privacy notice.
  retentionYears: Number(process.env.SPES_RETENTION_YEARS) || 5,
};
