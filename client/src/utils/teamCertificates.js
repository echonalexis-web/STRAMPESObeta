// Certificate helpers for the team profile page: date parsing, newest-first sorting,
// grouping by issuer and expiry labels. Dates in the member data are free text
// ("May 19, 2024", "2025"), so a year-only date counts as the END of that year.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "May 19, 2024" | "May 2024" | "2024" -> { year, month?, day?, end } or null.
// `end` is the last millisecond the date covers (used for sorting and expiry).
export function parseCertDate(value) {
  const text = String(value ?? "").trim();
  const m = text.match(/^(?:([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?)?(\d{4})$/);
  if (!m) return null;
  const year = Number(m[3]);
  const month = m[1] ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  if (m[1] && month < 0) return null;
  const day = m[2] ? Number(m[2]) : null;
  let end;
  if (month >= 0 && day) end = new Date(year, month, day, 23, 59, 59, 999).getTime();
  else if (month >= 0) end = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  else end = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
  return { year, month: month >= 0 ? month : null, day, end };
}

// Month and day are shown only when the source date has them.
export function formatCertDate(value) {
  const p = parseCertDate(value);
  if (!p) return String(value ?? "").trim();
  if (p.month === null) return String(p.year);
  if (!p.day) return `${MONTH_LABELS[p.month]} ${p.year}`;
  return `${MONTH_LABELS[p.month]} ${p.day}, ${p.year}`;
}

// Newest first. Unparseable dates go last. Equal dates keep their original order.
export function sortCertificates(certs) {
  return (certs || [])
    .map((cert, index) => ({ cert, index, end: parseCertDate(cert.year)?.end ?? -Infinity }))
    .sort((a, b) => (b.end - a.end) || (a.index - b.index))
    .map((x) => x.cert);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "CISCO Network Defense" -> "Network Defense" when the issuer is CISCO.
export function stripIssuerPrefix(title, issuer) {
  const t = String(title ?? "");
  if (!issuer) return t;
  const stripped = t.replace(new RegExp(`^${escapeRe(String(issuer).trim())}\\s*[-–—:·]?\\s+`, "i"), "").trim();
  return stripped || t;
}

function yearRange(certs) {
  const years = certs.map((c) => parseCertDate(c.year)?.year).filter(Boolean);
  if (!years.length) return "";
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

// Sorted rows for display. An issuer with `minGroup`+ certificates becomes one
// { type: "group" } row placed where its newest certificate would be; the rest are
// { type: "single" } rows. Titles inside a group have the issuer prefix removed.
export function buildCertificateRows(certs, minGroup = 3) {
  const sorted = sortCertificates(certs);
  const key = (c) => String(c.issuer || "").trim().toLowerCase();
  const counts = new Map();
  for (const c of sorted) if (key(c)) counts.set(key(c), (counts.get(key(c)) || 0) + 1);

  const rows = [];
  const groups = new Map();
  for (const cert of sorted) {
    const k = key(cert);
    if (k && counts.get(k) >= minGroup) {
      let group = groups.get(k);
      if (!group) {
        group = { type: "group", issuer: cert.issuer, items: [], range: "" };
        groups.set(k, group);
        rows.push(group);
      }
      group.items.push({ ...cert, name: stripIssuerPrefix(cert.name, cert.issuer) });
    } else {
      rows.push({ type: "single", cert });
    }
  }
  for (const g of groups.values()) g.range = yearRange(g.items);
  return rows;
}

// null when there is no expiry, { kind: "expired" } once it has passed,
// otherwise { kind: "expires", text: "Mar 2030" }.
export function expiryInfo(expires, now = Date.now()) {
  if (!expires) return null;
  const p = parseCertDate(expires);
  if (!p) return null;
  if (p.end < now) return { kind: "expired" };
  return { kind: "expires", text: p.month === null ? String(p.year) : `${MONTH_LABELS[p.month]} ${p.year}` };
}
