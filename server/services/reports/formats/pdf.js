// PDF, for summaries and rankings (capped at 2,000 rows). Built with pdfmake and an embedded
// Noto Sans (SIL Open Font License, server/assets/fonts), because the standard PDF fonts cannot
// print the peso sign (U+20B1) or every Filipino letter. Nothing is fetched from the network.
//
// Page 1 has the title block with the "prepared by" facts and an empty "Reviewed by" line (the
// paper practice, without an approval workflow). Every page has a footer: report ID, page x of y.

const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "..", "..", "assets", "fonts");
const FONT = "NotoSans";
const FONT_FILES = {
  normal: path.join(FONT_DIR, "NotoSans_400Regular.ttf"),
  bold: path.join(FONT_DIR, "NotoSans_700Bold.ttf"),
  // The family has no italic files here; the regular face stands in so a style never fails.
  italics: path.join(FONT_DIR, "NotoSans_400Regular.ttf"),
  bolditalics: path.join(FONT_DIR, "NotoSans_700Bold.ttf"),
};

// pdfmake is loaded on first use, not at start-up: it pulls in fontkit (an ES module), and a
// report that is never a PDF should not pay for it.
let pdfmake = null;
let configured = false;
const configure = () => {
  if (configured) return;
  pdfmake = require("pdfmake");
  pdfmake.setFonts({ [FONT]: FONT_FILES });
  // Only the bundled font files may be read from disk.
  if (typeof pdfmake.setLocalAccessPolicy === "function") {
    pdfmake.setLocalAccessPolicy((target) => path.resolve(String(target)).startsWith(path.resolve(FONT_DIR) + path.sep));
  }
  // A report never loads an image or any other resource from a URL.
  if (typeof pdfmake.setUrlAccessPolicy === "function") pdfmake.setUrlAccessPolicy(() => false);
  configured = true;
};

const metaValue = (report, label) => ((report.meta.lines.find(([key]) => key === label) || [])[1] || "");

const text = (value) => (value === null || value === undefined ? "" : String(value));

// The document definition (exported for tests).
const buildDefinition = (report, { compress = true } = {}) => {
  const reportId = metaValue(report, "Report ID");
  const wide = report.columns.length > 6;
  const data = report.rows.length
    ? report.rows.map((row) => report.columns.map((column) => ({ text: text(row[column.key]), style: "cell" })))
    : [[{ text: "No records for these filters.", colSpan: report.columns.length, style: "cell", italics: true }, ...Array(Math.max(report.columns.length - 1, 0)).fill({})]];

  return {
    compress,
    pageSize: "A4",
    pageOrientation: wide ? "landscape" : "portrait",
    pageMargins: [36, 40, 36, 52],
    info: { title: report.meta.title, author: metaValue(report, "Prepared by"), subject: reportId, creator: "STRAM PESO" },
    defaultStyle: { font: FONT, fontSize: 9 },
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 8] },
      label: { bold: true, color: "#374151" },
      th: { bold: true, fillColor: "#e6ede9", fontSize: 9 },
      cell: { fontSize: 9 },
      review: { margin: [0, 18, 0, 14] },
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: reportId, alignment: "left", fontSize: 8, color: "#4b5d56" },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: "right", fontSize: 8, color: "#4b5d56" },
      ],
      margin: [36, 12, 36, 0],
    }),
    content: [
      { text: report.meta.title, style: "title" },
      {
        table: { widths: [120, "*"], body: report.meta.lines.map(([label, value]) => [{ text: label, style: "label" }, { text: text(value) }]) },
        layout: "noBorders",
      },
      { text: "Reviewed by: ______________________________    Date: ________________", style: "review" },
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: report.columns.map(() => "auto"),
          body: [report.columns.map((column) => ({ text: column.label, style: "th" })), ...data],
        },
        layout: "lightHorizontalLines",
      },
    ],
  };
};

const renderPdf = async (report, options) => {
  configure();
  const document = pdfmake.createPdf(buildDefinition(report, options));
  return Buffer.from(await document.getBuffer());
};

module.exports = {
  contentType: "application/pdf",
  extension: "pdf",
  render: renderPdf,
  FONT_FILES,
  buildDefinition,
};
