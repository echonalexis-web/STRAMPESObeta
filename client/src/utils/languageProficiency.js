// Pure helpers for the Language / Dialect Proficiency table. The stored shape is
// unchanged: { English|Filipino|Others: { read, write, speak, understand } }.

export const LANGUAGE_ROWS = ["English", "Filipino", "Others"];
export const LANGUAGE_SKILL_KEYS = ["read", "write", "speak", "understand"];

export const emptyLanguageRow = () => ({ read: false, write: false, speak: false, understand: false });

// "all" when every skill is ticked, "none" when no skill is ticked, else "some".
export const rowState = (row) => {
  const ticked = LANGUAGE_SKILL_KEYS.filter((key) => Boolean(row?.[key])).length;
  if (ticked === LANGUAGE_SKILL_KEYS.length) return "all";
  return ticked === 0 ? "none" : "some";
};

// Ticks (or clears) all four skills of one language. Returns a new object.
export const setRow = (value, language, checked) => ({
  ...value,
  [language]: {
    ...emptyLanguageRow(),
    ...LANGUAGE_SKILL_KEYS.reduce((row, key) => ({ ...row, [key]: Boolean(checked) }), {}),
  },
});

// Flips one skill of one language. Returns a new object.
export const toggleSkill = (value, language, skillKey) => ({
  ...value,
  [language]: { ...emptyLanguageRow(), ...(value?.[language] || {}), [skillKey]: !value?.[language]?.[skillKey] },
});

// A click on the "All" box: when it is not fully ticked (none or some) it ticks
// everything; when it is fully ticked it clears everything.
export const nextAllChecked = (row) => rowState(row) !== "all";
