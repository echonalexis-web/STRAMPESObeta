// Helpers for the report history dialog.

const ROLLING = ["7d", "30d", "90d", "12m"];

// "Set up again": the scope (the filter bar's period and municipality) a history row was made with.
// A rolling preset ("30d") is re-used as a preset; any other period (a year, a quarter, a custom range)
// becomes the same two days as a custom range, since that is what the filter bar offers.
// It only describes a scope: nothing is exported by it.
export function setupScope(item) {
  const type = item && item.period ? item.period.type : null;
  const municipality = (item && item.municipality) || "";
  if (ROLLING.includes(type)) return { preset: type, from: "", to: "", municipality };
  if (item && item.period && item.period.from && item.period.to) return { preset: "custom", from: item.period.from, to: item.period.to, municipality };
  return { preset: "30d", from: "", to: "", municipality };
}

// The period column: a rolling preset keeps its name, anything else is just its two days.
export function periodText(item, t) {
  const period = item && item.period;
  if (!period) return "";
  const days = period.from && period.to ? `${period.from} – ${period.to}` : "";
  if (ROLLING.includes(period.type)) return `${t("adminAnalytics.filter.last", { period: t(`adminAnalytics.filter.periods.${period.type}`) })}${days ? ` (${days})` : ""}`;
  return days;
}
