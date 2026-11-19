// Reporting periods in Asia/Manila time: year, quarter, month or a custom range.
// Every boundary is Manila midnight turned into a UTC instant, so a record made at
// 23:30 on 31 December Manila time belongs to the old year even though it is already
// 1 January in UTC. The offset is read from Intl for each date (utils/age.js does the
// same), never hard-coded.

const { MANILA_TZ, getManilaToday } = require("../../utils/age");
const { LIMITS } = require("./config");
const { invalidPeriod } = require("./errors");

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANILA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Civil date and time in Manila for an instant.
const manilaParts = (date) => {
  const parts = {};
  for (const part of partsFormatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

// How far Manila is ahead of UTC at an instant, in milliseconds.
const manilaOffsetMs = (instant) => {
  const p = manilaParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

// The UTC instant at which a Manila civil date starts. Month and day may overflow
// (month 13 is January of the next year), which is how "start of the next period" is built.
const startOfManilaDay = (year, month, day) => {
  const naive = Date.UTC(year, month - 1, day);
  const first = naive - manilaOffsetMs(new Date(naive));
  return new Date(naive - manilaOffsetMs(new Date(first)));
};

const currentManilaYear = (now = new Date()) => getManilaToday(now).year;

const pad = (n) => String(n).padStart(2, "0");

// "2026-11-20 14:05 (Asia/Manila)": the form used on every report.
const formatManilaStamp = (date) => {
  const p = manilaParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${MANILA_TZ})`;
};

const formatManilaDate = (date) => {
  const p = manilaParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

const toInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return NaN;
  const text = String(value).trim();
  return /^-?\d+$/.test(text) ? Number(text) : NaN;
};

const parseCivilDate = (value, label) => {
  const match = typeof value === "string" ? value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw invalidPeriod(`${label} must be a date like 2026-03-31.`);
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw invalidPeriod(`${label} is not a real date.`);
  }
  return { year: y, month: m, day: d };
};

const QUARTER_LABELS = ["Q1 (Jan to Mar)", "Q2 (Apr to Jun)", "Q3 (Jul to Sep)", "Q4 (Oct to Dec)"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const boundsFor = ({ type, year, quarter, month, fromParts, toParts }) => {
  if (type === "year") {
    return { from: startOfManilaDay(year, 1, 1), to: startOfManilaDay(year + 1, 1, 1), label: String(year) };
  }
  if (type === "quarter") {
    const startMonth = (quarter - 1) * 3 + 1;
    return {
      from: startOfManilaDay(year, startMonth, 1),
      to: startOfManilaDay(year, startMonth + 3, 1),
      label: `${year} ${QUARTER_LABELS[quarter - 1]}`,
    };
  }
  if (type === "month") {
    return {
      from: startOfManilaDay(year, month, 1),
      to: startOfManilaDay(year, month + 1, 1),
      label: `${MONTH_NAMES[month - 1]} ${year}`,
    };
  }
  // custom: both days included, so the end is the start of the day after.
  const from = startOfManilaDay(fromParts.year, fromParts.month, fromParts.day);
  const to = startOfManilaDay(toParts.year, toParts.month, toParts.day + 1);
  return { from, to, label: `${formatManilaDate(from)} to ${formatManilaDate(new Date(to.getTime() - 1))}` };
};

// The period right before this one, same kind and length.
const previousSpec = (spec) => {
  if (spec.type === "year") return { type: "year", year: spec.year - 1 };
  if (spec.type === "quarter") {
    return spec.quarter === 1 ? { type: "quarter", year: spec.year - 1, quarter: 4 } : { type: "quarter", year: spec.year, quarter: spec.quarter - 1 };
  }
  if (spec.type === "month") {
    return spec.month === 1 ? { type: "month", year: spec.year - 1, month: 12 } : { type: "month", year: spec.year, month: spec.month - 1 };
  }
  return null;
};

// periodBounds({ type, year, quarter, month, from, to }, now)
//   type: "year" (default), "quarter", "month" or "custom" (from and to as YYYY-MM-DD, both included).
// Returns { type, year, quarter, month, from, to (exclusive), label, isPartial, isFuture, asOf,
//           previous: { from, to, label } | null, previousSameElapsedTo }.
const periodBounds = (input = {}, now = new Date()) => {
  const type = input.type || "year";
  if (!["year", "quarter", "month", "custom"].includes(type)) throw invalidPeriod("Unknown period type.");
  const thisYear = currentManilaYear(now);

  const spec = { type };
  let fromParts = null;
  let toParts = null;

  if (type === "custom") {
    fromParts = parseCivilDate(input.from, "From");
    toParts = parseCivilDate(input.to, "To");
    spec.fromParts = fromParts;
    spec.toParts = toParts;
  } else {
    const rawYear = toInt(input.year);
    const year = rawYear === null ? thisYear : rawYear;
    if (!Number.isInteger(year) || year < 2000 || year > thisYear + 1) throw invalidPeriod("Year is out of range.");
    spec.year = year;
    if (type === "quarter") {
      const quarter = toInt(input.quarter);
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw invalidPeriod("Quarter must be 1, 2, 3 or 4.");
      spec.quarter = quarter;
    }
    if (type === "month") {
      const month = toInt(input.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw invalidPeriod("Month must be 1 to 12.");
      spec.month = month;
    }
  }

  const bounds = boundsFor(spec);
  if (bounds.to <= bounds.from) throw invalidPeriod("The end of the period is before its start.");
  const spanDays = (bounds.to - bounds.from) / 86400000;
  if (spanDays > LIMITS.maxPeriodYears * 366) throw invalidPeriod(`A period can cover at most ${LIMITS.maxPeriodYears} years.`);

  const isFuture = now < bounds.from;
  const isPartial = !isFuture && now < bounds.to;
  const asOf = isPartial ? now : isFuture ? bounds.from : bounds.to;

  let previous = null;
  const prevSpec = previousSpec(spec);
  if (prevSpec) {
    previous = boundsFor(prevSpec);
  } else {
    // custom: the same number of days immediately before.
    const length = bounds.to.getTime() - bounds.from.getTime();
    const from = new Date(bounds.from.getTime() - length);
    previous = { from, to: bounds.from, label: `${formatManilaDate(from)} to ${formatManilaDate(new Date(bounds.from.getTime() - 1))}` };
  }
  // For a period still in progress: the same elapsed stretch of the previous one.
  let previousSameElapsedTo = null;
  if (isPartial) {
    const elapsed = now.getTime() - bounds.from.getTime();
    previousSameElapsedTo = new Date(Math.min(previous.from.getTime() + elapsed, previous.to.getTime()));
  }

  return {
    type,
    year: spec.year || null,
    quarter: spec.quarter || null,
    month: spec.month || null,
    from: bounds.from,
    to: bounds.to,
    label: bounds.label,
    isPartial,
    isFuture,
    asOf,
    previous,
    previousSameElapsedTo,
  };
};

// Reads the period out of a query string: period=year|quarter|month|custom, year, quarter, month, from, to.
const parsePeriodQuery = (query = {}, now = new Date()) => {
  const text = (value) => (typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined);
  return periodBounds(
    {
      type: text(query.period) || undefined,
      year: text(query.year),
      quarter: text(query.quarter),
      month: text(query.month),
      from: text(query.from),
      to: text(query.to),
    },
    now
  );
};

// Which calendar quarter (1 to 4) an instant is in, in Manila.
const manilaQuarter = (date) => Math.floor((manilaParts(date).month - 1) / 3) + 1;

module.exports = {
  MANILA_TZ,
  manilaParts,
  startOfManilaDay,
  currentManilaYear,
  formatManilaStamp,
  formatManilaDate,
  manilaQuarter,
  periodBounds,
  parsePeriodQuery,
};
