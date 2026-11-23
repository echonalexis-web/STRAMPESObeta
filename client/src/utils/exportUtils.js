import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// Table exports (CSV and PDF lists) now come from the server report generator.
// This module keeps the browser download helper and the resume/cover-letter PDF helpers.

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
