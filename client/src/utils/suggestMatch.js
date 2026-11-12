// Matching for typeahead fields (Citizenship, civil service eligibility, PRC license).
// Case-insensitive, ignores accents and extra spaces, matches anywhere in the label,
// prefix matches first, at most `max` results. Pure: no component state here.

export const DEFAULT_MAX_SUGGESTIONS = 8;

// Lower-case, strip accents (NFD marks), turn any run of whitespace into one space.
export const foldText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Whitespace cleanup for a value the user typed (kept in their own casing and accents).
export const collapseSpaces = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function matchSuggestions(query, options, max = DEFAULT_MAX_SUGGESTIONS) {
  const q = foldText(query);
  if (!q || !Array.isArray(options)) return [];
  const prefix = [];
  const inside = [];
  const seen = new Set();
  for (const option of options) {
    const label = String(option ?? "");
    const folded = foldText(label);
    if (!folded || seen.has(folded)) continue;
    if (folded.startsWith(q)) {
      seen.add(folded);
      prefix.push(label);
    } else if (folded.includes(q)) {
      seen.add(folded);
      inside.push(label);
    }
  }
  return [...prefix, ...inside].slice(0, max);
}

// The list entry whose folded label equals the typed text, so a value that matches
// an option exactly (any case or accent) is stored as that option's own label.
export function canonicalOption(value, options) {
  const folded = foldText(value);
  if (!folded || !Array.isArray(options)) return null;
  return options.find((option) => foldText(option) === folded) || null;
}
