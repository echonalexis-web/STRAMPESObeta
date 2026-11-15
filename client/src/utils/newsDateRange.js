// Turns a date picked in <input type="date"> ("YYYY-MM-DD", the visitor's own
// calendar day) into the ISO timestamps the news list API filters on, so a day
// means the visitor's local day, not a UTC day.

const parseLocalDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return { y, m: m - 1, d };
};

export const localDayStartIso = (value) => {
  const day = parseLocalDay(value);
  if (!day) return undefined;
  const date = new Date(day.y, day.m, day.d, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const localDayEndIso = (value) => {
  const day = parseLocalDay(value);
  if (!day) return undefined;
  const date = new Date(day.y, day.m, day.d, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};
