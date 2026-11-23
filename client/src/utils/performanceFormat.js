// "up 3", "down 1" or "no change": the change is written in words, never by an arrow or a
// colour alone. null (no previous figure) is shown as nothing.
export function changeText(t, change) {
  if (change === null || change === undefined) return "";
  if (change > 0) return t("analyticsDash.performance.up", { n: change });
  if (change < 0) return t("analyticsDash.performance.down", { n: Math.abs(change) });
  return t("analyticsDash.performance.same");
}
