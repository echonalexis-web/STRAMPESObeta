// View helpers for the phone-width compact job card. No business rules here:
// every value (percent, tier, met and total must-haves, missing list) is
// computed by the server and only read.

// What the collapsed card shows about the match, and which action state the
// expanded card ends with. Inputs are exactly what VacancyCard already has.
export function compactCardModel({ checklist = null, matchAvailable = true, tier = "na", applied = false, canApply = true } = {}) {
  const hasChecklist = Boolean(matchAvailable && checklist);
  const showMatch = Boolean(matchAvailable) && tier !== "na";
  const total = hasChecklist ? Number(checklist.totalMustHaves || 0) : 0;
  const met = hasChecklist ? Number(checklist.metMustHaves || 0) : 0;
  const missing = hasChecklist && Array.isArray(checklist.missingRequired) ? checklist.missingRequired : [];

  // "mustHaves": a count to show. "noMustHaves": a match exists but the job
  // lists no must-haves. "details": no match to show (no skills on file).
  let toggleKind = "details";
  if (showMatch) toggleKind = total > 0 ? "mustHaves" : "noMustHaves";

  // Why the person cannot apply right now, so it is visible even when collapsed.
  let blocked = null;
  if (applied) blocked = "applied";
  else if (!canApply) blocked = "age";

  return { showMatch, hasChecklist, toggleKind, met, total, missing, blocked };
}

export const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
