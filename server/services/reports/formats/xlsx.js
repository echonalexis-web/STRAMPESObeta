// XLSX, written as a stream so memory stays flat for a 50,000-row report.
//   Sheet "Report"  cover: title, prepared by, role, office, generated at, report ID, dataset,
//                   filters, period, record count, purpose, notes
//   Sheet "Data"    header row (bold, frozen) and the rows
//   Sheet "_meta"   hidden: the same facts as canonical JSON, for tooling and for proving a file
// A text cell that starts with = + - @ (or a tab or carriage return) is written with a leading
// apostrophe so a spreadsheet reads it as text. Numbers stay numbers.

const { PassThrough } = require("stream");
const ExcelJS = require("exceljs");

const FORMULA_START = /^[=+\-@\t\r]/;
const safeText = (value) => (typeof value === "string" && FORMULA_START.test(value) ? `'${value}` : value);
const cell = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return safeText(String(value));
};

const COVER_KEYS = ["Report ID", "Prepared by", "Role", "Office or position", "Generated at", "Dataset", "Period"];

const columnWidth = (column, rows) => {
  let longest = String(column.label).length;
  for (const row of rows.slice(0, 200)) longest = Math.max(longest, String(row[column.key] ?? "").length);
  return Math.min(Math.max(longest + 2, 10), 60);
};

const renderXlsx = async (report) => {
  const chunks = [];
  const out = new PassThrough();
  out.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    out.on("end", resolve);
    out.on("error", reject);
  });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  const preparedBy = (report.meta.lines.find(([label]) => label === "Prepared by") || [])[1] || "";
  workbook.creator = preparedBy;
  workbook.created = new Date();

  // Cover
  const cover = workbook.addWorksheet("Report");
  cover.columns = [{ width: 26 }, { width: 90 }];
  const title = cover.addRow([cell(report.meta.title)]);
  title.font = { bold: true, size: 14 };
  title.commit();
  cover.addRow([]).commit();
  for (const [label, value] of report.meta.lines) {
    const row = cover.addRow([label, cell(value)]);
    if (COVER_KEYS.includes(label)) row.getCell(1).font = { bold: true };
    row.commit();
  }
  cover.commit();

  // Data
  const data = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  data.columns = report.columns.map((column) => ({ key: column.key, width: columnWidth(column, report.rows) }));
  const header = data.addRow(report.columns.map((column) => column.label));
  header.font = { bold: true };
  header.commit();
  for (const row of report.rows) data.addRow(report.columns.map((column) => cell(row[column.key]))).commit();
  data.commit();

  // Hidden facts
  const meta = workbook.addWorksheet("_meta", { state: "hidden" });
  const canonical = {
    schemaVersion: 1,
    title: report.meta.title,
    lines: report.meta.lines,
    columns: report.columns.map((column) => column.key),
    rows: report.rows.length,
  };
  meta.addRow([JSON.stringify(canonical)]).commit();
  meta.commit();

  await workbook.commit();
  await finished;
  return Buffer.concat(chunks);
};

module.exports = {
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  extension: "xlsx",
  render: renderXlsx,
};
