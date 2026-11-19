// Pure helpers for the Browse Jobs industries filter (kept out of the
// component so they can be unit-tested without a DOM).

// `filters.industry` is normally an array, but an older persisted value may
// be a single string.
export const normalizeIndustries = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
};

export const toggleIndustry = (list, industry) =>
  list.includes(industry) ? list.filter((item) => item !== industry) : [...list, industry];

// Adds the user's preferred industries to the selection without dropping
// anything already chosen or duplicating an entry.
export const addPreferredIndustries = (list, preferred) => {
  const next = [...list];
  (preferred || []).forEach((industry) => {
    if (industry && !next.includes(industry)) next.push(industry);
  });
  return next;
};
