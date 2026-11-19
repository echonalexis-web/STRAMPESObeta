// CSV text for the browser exports. Kept free of the PDF libraries so it can be tested
// on its own. A cell that starts with = + - @ (or a tab or carriage return) is prefixed
// with an apostrophe so Excel and Sheets read it as text, never as a formula: a job title
// or company name typed by a user must not be able to run anything when an admin opens
// the file. Numbers produced by the code (counts) are left alone.

const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns, rows) => {
  const header = columns.map((col) => csvCell(col.label)).join(",");
  const body = rows.map((row) => columns.map((col) => csvCell(col.get(row))).join(",")).join("\n");
  return `${header}\n${body}`;
};

// Excel needs the byte order mark to open UTF-8 names with Filipino letters correctly.
export const CSV_BOM = "﻿";
