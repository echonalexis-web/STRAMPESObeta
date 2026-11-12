// Whitespace cleanup for free-text profile fields that the wizard suggests values for
// (citizenship, civil service eligibility, PRC license). Values are kept as typed
// (casing and accents), only trimmed, collapsed to single spaces and length-capped.
// Existing saved values stay valid: nothing here rejects input.

const MAX_CITIZENSHIP = 50;
const MAX_LIST_NAME = 120;

const tidyText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const tidyCitizenship = (value) => tidyText(value, MAX_CITIZENSHIP);

// eligibilities[] and professionalLicenses[]: tidy each entry's `name`, keep the rest as is.
const tidyNamedList = (list) => {
  if (!Array.isArray(list)) return list;
  return list.map((entry) =>
    entry && typeof entry === "object" && typeof entry.name === "string"
      ? { ...entry, name: tidyText(entry.name, MAX_LIST_NAME) }
      : entry
  );
};

module.exports = { tidyText, tidyCitizenship, tidyNamedList, MAX_CITIZENSHIP, MAX_LIST_NAME };
