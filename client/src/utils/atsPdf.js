// ATS-friendly resume PDF: real, selectable text on one column. No images, icons, tables or
// text boxes, one standard font, standard headings, one date format, contact details as plain text.
//
// The studio's canvas is an editable HTML document. The standard export draws that HTML into a
// picture (see exportUtils), which hiring software cannot read. This file instead reads the
// canvas's TEXT, in the order the applicant arranged it, and writes it with jsPDF's text API, so
// the PDF carries the words themselves.

import { jsPDF } from "jspdf";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 2021-03 / 2021-03-15 / 2021/03 -> "Mar 2021". Anything else is left as the applicant wrote it.
export const normalizeDates = (text) =>
  String(text || "").replace(/\b(\d{4})[-/](0[1-9]|1[0-2])(?:[-/](?:0[1-9]|[12]\d|3[01]))?\b/g, (_m, year, month) => `${MONTHS[Number(month) - 1]} ${year}`);

// Standard fonts only cover Latin-1 plus a few punctuation marks; anything else would print as
// garbage, so it becomes "?" instead.
const printable = (text) =>
  String(text || "")
    .replace(/[\u2010\u2011\u2212]/g, "-")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/[^\u0020-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, "?");

const clean = (text) => normalizeDates(String(text || "").replace(/\s+/g, " ").trim());

// Plain-text lines of an element: <br> and block children start a new line.
const linesOf = (element) => {
  const lines = [""];
  const walk = (node) => {
    if (node.nodeType === 3) {
      lines[lines.length - 1] += node.textContent;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      lines.push("");
      return;
    }
    const block = ["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4"].includes(tag);
    if (block && lines[lines.length - 1].trim()) lines.push("");
    node.childNodes.forEach(walk);
    if (block && lines[lines.length - 1].trim()) lines.push("");
  };
  walk(element);
  return lines.map(clean).filter(Boolean);
};

// The document as a flat list of blocks: name, headline, contact, then heading + body lines for
// every section that is switched on, in the order they currently appear.
export const extractAtsBlocks = (root) => {
  const blocks = [];
  const name = root.querySelector(".resume-doc__header h2");
  if (name && clean(name.textContent)) blocks.push({ type: "name", text: clean(name.textContent) });
  const headline = root.querySelector(".resume-doc__title");
  if (headline && clean(headline.textContent)) blocks.push({ type: "headline", text: clean(headline.textContent) });
  const contact = root.querySelector(".resume-doc__contact");
  if (contact && clean(contact.textContent)) {
    blocks.push({ type: "contact", text: clean(contact.textContent).replace(/\s*[·|]\s*/g, " | ") });
  }

  root.querySelectorAll(".resume-doc__section[data-section]").forEach((section) => {
    if (section.style.display === "none") return;
    const heading = section.querySelector("h3");
    const body = [];
    section.childNodes.forEach((child) => {
      if (child === heading || child.nodeType !== 1) return;
      const bullets = child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol";
      if (bullets) child.querySelectorAll("li").forEach((li) => linesOf(li).forEach((text) => body.push({ type: "bullet", text })));
      else linesOf(child).forEach((text) => body.push({ type: "para", text }));
    });
    if (!body.length) return; // an empty section would only leave a bare heading
    blocks.push({ type: "heading", text: clean(heading?.textContent) || "" });
    blocks.push(...body);
  });
  return blocks;
};

const MARGIN = 54;
const SIZES = { name: 20, headline: 12, contact: 10, heading: 12, para: 10.5, bullet: 10.5 };

// Writes the blocks with jsPDF text and returns the finished doc.
export const buildAtsPdf = (blocks) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const ensure = (needed) => {
    if (y + needed > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  blocks.forEach((block, index) => {
    const size = SIZES[block.type] || 10.5;
    const bold = block.type === "name" || block.type === "heading";
    const lineHeight = size * 1.35;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);

    if (block.type === "heading") {
      y += index === 0 ? 0 : 10;
      ensure(lineHeight * 3); // keep a heading with at least its first lines
    }
    const indent = block.type === "bullet" ? 14 : 0;
    const text = printable(block.text);
    const wrapped = doc.splitTextToSize(text, width - indent);
    wrapped.forEach((line, lineIndex) => {
      ensure(lineHeight);
      if (block.type === "bullet" && lineIndex === 0) doc.text("-", MARGIN + 2, y + size);
      doc.text(line, MARGIN + indent, y + size);
      y += lineHeight;
    });
    if (block.type === "name" || block.type === "contact") y += 2;
    if (block.type === "heading") {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y - 2, pageWidth - MARGIN, y - 2);
      y += 4;
    }
  });

  return doc;
};

// Straight from the canvas element to a PDF Blob with real text.
export const renderAtsPdfBlob = (root) => buildAtsPdf(extractAtsBlocks(root)).output("blob");
