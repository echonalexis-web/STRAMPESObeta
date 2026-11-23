// CSV: metadata as leading two-column rows, a blank row, then the header and the data.
// Readable in Excel, UTF-8 with a BOM so Filipino letters survive, and every cell goes
// through csvCell, which neutralizes spreadsheet formulas (= + - @ tab).

const { csvCell } = require("../../../utils/csv");

// report = { meta: { title, lines: [[label, value]] }, columns: [{ key, label }], rows: [{...}] }
const renderCsv = (report) => {
  const lines = [];
  lines.push([csvCell(report.meta.title)].join(","));
  for (const [label, value] of report.meta.lines) lines.push(`${csvCell(label)},${csvCell(value)}`);
  lines.push("");
  lines.push(report.columns.map((column) => csvCell(column.label)).join(","));
  for (const row of report.rows) lines.push(report.columns.map((column) => csvCell(row[column.key])).join(","));
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
};

module.exports = { contentType: "text/csv; charset=utf-8", extension: "csv", render: renderCsv };
