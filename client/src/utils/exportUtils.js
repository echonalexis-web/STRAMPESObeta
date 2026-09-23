import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";

const BRAND_NAME = "STRAM PESO";
const BRAND_COLOR = [6, 95, 70]; // matches TREND_COLORS.registrations used across admin charts

export const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns, rows) => {
  const header = columns.map((col) => csvCell(col.label)).join(",");
  const body = rows.map((row) => columns.map((col) => csvCell(col.get(row))).join(",")).join("\n");
  return `${header}\n${body}`;
};

export const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportCsv = ({ filename, columns, rows }) => {
  const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8;" });
  downloadBlob(filename, blob);
};

const formatTimestamp = () =>
  new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Builds and downloads a branded PDF table report (header band, title,
 * generated timestamp + applied filters, striped table, page footer).
 * `filters` is an optional array of { label, value } pairs; falsy/empty
 * values are skipped so unset filters don't clutter the report.
 */
export const exportPdfTable = ({ title, subtitle, filters = [], columns, rows, filename, orientation = "landscape" }) => {
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 32;

  const activeFilters = filters.filter((f) => f && f.value !== undefined && f.value !== null && f.value !== "");
  const filtersLine = activeFilters.length
    ? `Filters: ${activeFilters.map((f) => `${f.label} = ${f.value}`).join("  ·  ")}`
    : "Filters: none";

  const drawHeader = () => {
    doc.setFontSize(14);
    doc.setTextColor(...BRAND_COLOR);
    doc.setFont(undefined, "bold");
    doc.text(BRAND_NAME, margin, 28);

    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.setFont(undefined, "normal");
    doc.text("CONFIDENTIAL — For internal use", pageWidth - margin, 28, { align: "right" });

    doc.setDrawColor(...BRAND_COLOR);
    doc.setLineWidth(1);
    doc.line(margin, 36, pageWidth - margin, 36);

    doc.setFontSize(16);
    doc.setTextColor(20, 20, 20);
    doc.setFont(undefined, "bold");
    doc.text(title, margin, 58);

    if (subtitle) {
      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.setTextColor(90, 90, 90);
      doc.text(subtitle, margin, 74);
    }

    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.setFont(undefined, "normal");
    doc.text(`Generated: ${formatTimestamp()}`, margin, subtitle ? 88 : 76);
    doc.text(filtersLine, margin, subtitle ? 102 : 90);
  };

  const startY = subtitle ? 112 : 100;

  autoTable(doc, {
    startY,
    margin: { top: 40, left: margin, right: margin, bottom: 36 },
    head: [columns.map((col) => col.label)],
    body: rows.map((row) => columns.map((col) => {
      const value = col.get(row);
      return value === null || value === undefined || value === "" ? "—" : String(value);
    })),
    theme: "striped",
    headStyles: { fillColor: BRAND_COLOR, textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 5 },
    didDrawPage: drawHeader,
  });

  // Page counts aren't final until every page has been created, so the
  // "Page X of Y" footer is stamped in a second pass over the finished doc.
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 16,
      { align: "right" },
    );
  }

  doc.save(filename);
};

/**
 * Rasterizes a DOM node (a styled resume/cover-letter preview) and paginates
 * it across A4 pages. Text is rasterized rather than embedded as selectable
 * PDF text — an accepted tradeoff for reusing the already-installed
 * html2canvas + jsPDF pair instead of building a from-scratch text layout
 * engine; rendering at scale >= 2 keeps it crisp for on-screen reading and
 * printing.
 *
 * The page is embedded as JPEG, not PNG: a resume/cover letter is solid
 * white background plus text, and JPEG's lossy compression collapses those
 * large flat regions to a fraction of PNG's lossless size (a plain page was
 * hitting ~9MB as a 2x-scale PNG; JPEG at quality 0.9 is imperceptibly
 * different for this kind of content but far smaller) — there's no
 * transparency in play here for JPEG's lack of an alpha channel to matter.
 */
const renderHtmlNodeToPdfDoc = async (node, scale = 2, jpegQuality = 0.9) => {
  const canvas = await html2canvas(node, { scale, useCORS: true, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/jpeg", jpegQuality);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightRendered = 0;
  doc.addImage(imgData, "JPEG", 0, 0, imgWidth, imgHeight);
  heightRendered += pageHeight;

  while (heightRendered < imgHeight) {
    doc.addPage();
    doc.addImage(imgData, "JPEG", 0, -heightRendered, imgWidth, imgHeight);
    heightRendered += pageHeight;
  }

  return doc;
};

export const exportHtmlNodeToPdf = async ({ node, filename, scale = 2 }) => {
  const doc = await renderHtmlNodeToPdfDoc(node, scale);
  doc.save(filename);
};

// Same rendering pipeline as exportHtmlNodeToPdf, but returns the PDF as a
// Blob instead of triggering a browser download — used when the generated
// document needs to be uploaded (e.g. "Save to Profile") rather than saved
// locally.
export const renderHtmlNodeToPdfBlob = async ({ node, scale = 2 }) => {
  const doc = await renderHtmlNodeToPdfDoc(node, scale);
  return doc.output("blob");
};
