// Label of one breakdown cell; unknown keys fall back to the raw value.
export function cellLabel(t, breakdownKey, key, { section, dataset } = {}) {
  const lookup = (path) => {
    const text = t(`analyticsDash.${path}.${key}`, { defaultValue: "" });
    return text || key;
  };
  if (breakdownKey === "status") {
    if (dataset === "spes") return lookup("spesStatuses");
    return section === "applicants" ? lookup("applicationStatuses") : lookup("jobStatuses");
  }
  if (breakdownKey === "verification") return lookup("verificationValues");
  if (breakdownKey === "accountStatus") return lookup("accountStatuses");
  if (breakdownKey === "workNature") return lookup("workNatures");
  if (breakdownKey === "ageBracket" || breakdownKey === "ageTier") return key === "unknown" ? lookup("ageValues") : key;
  return key;
}

