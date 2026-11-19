// Minimal CSV writer for exports. Quotes every field, doubles embedded quotes,
// and neutralizes spreadsheet formula injection: a value that starts with
// = + - @ (or a tab / carriage return) is prefixed with an apostrophe so Excel
// and Sheets read it as text, not a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value) => {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const toCsv = (columns, rows) => {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","));
  // BOM so Excel opens UTF-8 names (Filipino) correctly.
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
};

module.exports = { toCsv, csvCell };
