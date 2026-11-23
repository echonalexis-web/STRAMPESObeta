// PDF output: the embedded font covers the peso sign and Filipino letters, the title block and
// footer are on the page, and the cap and layout rules hold. A rendered sample was also read
// back with pdf.js once, outside the repo: it extracted "₱12,500.00", "Niño", "Peña" and
// "Ñandú Café" (see REPORTS_BUILD_STATUS.md). Here the same facts are checked structurally,
// with no extra dependency.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const fs = require("fs");
const { execFileSync } = require("child_process");
const { FORMAT_RENDERERS } = require("../services/reports/formats");
const pdf = FORMAT_RENDERERS.pdf;

// pdfmake cannot be loaded inside Jest (fontkit is an ES module), so rendering runs in a plain
// Node process, as in production. buildDefinition is pure and is called in-process.
const CHILD = require("path").join(__dirname, "..", "testSupport", "renderPdfChild.js");
const renderInChild = (report, options) =>
  Buffer.from(execFileSync(process.execPath, [CHILD], { input: JSON.stringify({ report, options }), maxBuffer: 200 * 1024 * 1024, encoding: "utf8" }), "base64");

// Minimal TrueType reader: does the font's cmap (format 4, BMP) map this code point to a glyph?
const hasGlyph = (buffer, codePoint) => {
  const tables = buffer.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < tables; i += 1) {
    const at = 12 + i * 16;
    if (buffer.toString("ascii", at, at + 4) === "cmap") cmapOffset = buffer.readUInt32BE(at + 8);
  }
  if (cmapOffset < 0) return false;
  const count = buffer.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < count; i += 1) {
    const sub = cmapOffset + buffer.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    if (buffer.readUInt16BE(sub) !== 4) continue;
    const segCount = buffer.readUInt16BE(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + segCount * 2 + 2;
    const deltas = starts + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    for (let seg = 0; seg < segCount; seg += 1) {
      if (codePoint > buffer.readUInt16BE(ends + seg * 2)) continue;
      if (codePoint < buffer.readUInt16BE(starts + seg * 2)) break;
      const offset = buffer.readUInt16BE(rangeOffsets + seg * 2);
      if (offset === 0) return ((codePoint + buffer.readInt16BE(deltas + seg * 2)) & 0xffff) !== 0;
      const glyphAt = rangeOffsets + seg * 2 + offset + (codePoint - buffer.readUInt16BE(starts + seg * 2)) * 2;
      return buffer.readUInt16BE(glyphAt) !== 0;
    }
  }
  return false;
};

const report = (overrides = {}) => ({
  meta: {
    title: "Employer ranking: 2026 Q4",
    lines: [
      ["Report ID", "RPT-20261120-ABCDEFGH"],
      ["Prepared by", "Niño Dela Peña"],
      ["Role", "admin"],
      ["Note", "Average pay ₱12,500.00 (Ñandú Café)"],
    ],
  },
  columns: [{ key: "a", label: "Employer" }, { key: "b", label: "Salary (₱)" }],
  rows: [{ a: "Niño's Café", b: "₱12,500.00" }],
  ...overrides,
});

describe("embedded font", () => {
  test("the font files exist and have the peso sign and Filipino letters", () => {
    for (const file of [pdf.FONT_FILES.normal, pdf.FONT_FILES.bold]) {
      expect(fs.existsSync(file)).toBe(true);
      const buffer = fs.readFileSync(file);
      for (const codePoint of [0x20b1, 0xf1, 0xd1, 0xe9, 0xfa, 0x41]) expect(hasGlyph(buffer, codePoint)).toBe(true);
      // and the reader is not just saying yes: a private-use code point has no glyph
      expect(hasGlyph(buffer, 0xe000)).toBe(false);
    }
  });

  test("the licence ships with the font", () => {
    expect(fs.readFileSync(require("path").join(__dirname, "..", "assets", "fonts", "OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
  });
});

describe("pdf renderer", () => {
  test("is a PDF with the font embedded, and the peso sign and ñ are mapped to text", async () => {
    const bytes = renderInChild(report(), { compress: false });
    expect(bytes.slice(0, 5).toString()).toBe("%PDF-");
    const raw = bytes.toString("latin1");
    expect(raw).toMatch(/BaseFont\s*\/[A-Z]{6}\+NotoSans/);
    // The ToUnicode map lists the characters the text uses: U+20B1 (peso) and U+00F1 (ñ).
    expect(raw).toMatch(/20B1/i);
    expect(raw).toMatch(/00F1/i);
  });

  test("the compressed default is a valid PDF too", async () => {
    const bytes = renderInChild(report());
    expect(bytes.slice(0, 5).toString()).toBe("%PDF-");
    expect(bytes.slice(-6).toString()).toContain("%%EOF");
  });

  test("page 1 has the title block with the prepared-by facts and a Reviewed by line", () => {
    const definition = pdf.buildDefinition(report());
    const json = JSON.stringify(definition.content);
    expect(json).toContain("Employer ranking: 2026 Q4");
    expect(json).toContain("Niño Dela Peña");
    expect(json).toContain("Report ID");
    expect(json).toContain("Reviewed by:");
    expect(definition.info).toMatchObject({ author: "Niño Dela Peña", subject: "RPT-20261120-ABCDEFGH" });
  });

  test("every page has a footer with the report ID and page x of y", () => {
    const footer = pdf.buildDefinition(report()).footer(2, 5);
    const json = JSON.stringify(footer);
    expect(json).toContain("RPT-20261120-ABCDEFGH");
    expect(json).toContain("Page 2 of 5");
  });

  test("the table repeats its header on every page and keeps rows whole", () => {
    const table = pdf.buildDefinition(report()).content.find((block) => block.table && block.table.headerRows === 1).table;
    expect(table.headerRows).toBe(1);
    expect(table.dontBreakRows).toBe(true);
    expect(table.body[0].map((cellDef) => cellDef.text)).toEqual(["Employer", "Salary (₱)"]);
  });

  test("a wide report is landscape and an empty one says so", () => {
    const columns = Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, label: `C${i}` }));
    expect(pdf.buildDefinition(report({ columns, rows: [] })).pageOrientation).toBe("landscape");
    expect(pdf.buildDefinition(report()).pageOrientation).toBe("portrait");
    expect(JSON.stringify(pdf.buildDefinition(report({ rows: [] })).content)).toContain("No records for these filters.");
  });

  test("a report of 2,000 rows renders across several pages", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ a: `Employer ${i}`, b: `₱${i},000.00` }));
    const bytes = renderInChild(report({ rows }), { compress: false });
    const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(10);
  }, 60000);

  test("it never loads a URL or a file outside the font folder", () => {
    const definition = JSON.stringify(pdf.buildDefinition(report({ rows: [{ a: "http://example.com/x.png", b: "1" }] })));
    expect(definition).not.toMatch(/"image"|"svg"/);
  });
});

describe("through the service", () => {
  test("pdf is a registered format with its own row cap", () => {
    const { EXPORT_ROW_CAPS } = require("../services/analytics/config");
    expect(Object.keys(FORMAT_RENDERERS).sort()).toEqual(["csv", "pdf", "xlsx"]);
    expect(EXPORT_ROW_CAPS.pdf).toBe(2000);
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.extension).toBe("pdf");
  });
});
