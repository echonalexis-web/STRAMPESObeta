// Upload limits on the SPES apply chain: size (413), type (415), file count (400) and a
// valid upload. Storage is not involved: the chain under test stops at the handler.

const express = require("express");
const request = require("supertest");

const { spesSlotsUpload, spesSingleUpload, validateSpesFiles } = require("../middleware/spesUpload");
const {
  ALL_SLOTS,
  SPES_DOC_MAX_BYTES,
  SPES_MAX_FILES_PER_APPLICATION,
  SPES_SLOTS,
} = require("../utils/spesDocuments");

const PDF = Buffer.from("%PDF-1.4\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const app = () => {
  const a = express();
  a.post("/apply", spesSlotsUpload, validateSpesFiles, (req, res) =>
    res.json({ ok: true, slots: Object.keys(req.files || {}) })
  );
  a.post("/documents", spesSingleUpload, validateSpesFiles, (req, res) => res.json({ ok: true, name: req.file.originalname }));
  return a;
};

const pdf = (r, slot, name = "doc.pdf") => r.attach(slot, PDF, { filename: name, contentType: "application/pdf" });

describe("SPES document upload limits", () => {
  test("the shared limits are 5 MB and four files per application", () => {
    expect(SPES_DOC_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(SPES_MAX_FILES_PER_APPLICATION).toBe(4);
    expect(SPES_MAX_FILES_PER_APPLICATION).toBeLessThan(ALL_SLOTS.length);
  });

  test("a valid upload (PDF and PNG in different slots) passes", async () => {
    const r = request(app()).post("/apply");
    pdf(r, SPES_SLOTS.FORM2);
    r.attach(SPES_SLOTS.PROOF_OF_AGE, PNG, { filename: "id.png", contentType: "image/png" });
    const res = await r;
    expect(res.status).toBe(200);
    expect(res.body.slots.sort()).toEqual([SPES_SLOTS.FORM2, SPES_SLOTS.PROOF_OF_AGE].sort());
  });

  test("a file over 5 MB is refused with 413 SPES_FILE_TOO_LARGE", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(SPES_DOC_MAX_BYTES)]);
    const res = await request(app())
      .post("/apply")
      .attach(SPES_SLOTS.FORM2, big, { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("SPES_FILE_TOO_LARGE");
    expect(res.body.message).toMatch(/5 MB/);
  });

  test("a file of exactly the limit is accepted", async () => {
    const exact = Buffer.concat([PDF, Buffer.alloc(SPES_DOC_MAX_BYTES - PDF.length)]);
    const res = await request(app())
      .post("/apply")
      .attach(SPES_SLOTS.FORM2, exact, { filename: "exact.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
  });

  test.each([
    ["a GIF", Buffer.from("GIF89a"), "a.gif", "image/gif"],
    ["a Word file", Buffer.from("PK"), "a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("%s is refused with 415 SPES_FILE_TYPE", async (_label, buf, filename, contentType) => {
    const res = await request(app()).post("/apply").attach(SPES_SLOTS.FORM2, buf, { filename, contentType });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe("SPES_FILE_TYPE");
  });

  test("a script renamed to .png (wrong signature) is refused with 415", async () => {
    const res = await request(app())
      .post("/apply")
      .attach(SPES_SLOTS.FORM2, Buffer.from("<script>alert(1)</script>"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe("SPES_FILE_TYPE");
  });

  test("more files than one application can carry is refused with SPES_TOO_MANY_FILES", async () => {
    const r = request(app()).post("/apply");
    for (const slot of ALL_SLOTS) pdf(r, slot, `${slot}.pdf`); // five files, cap is four
    const res = await r;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_TOO_MANY_FILES");
  });

  test("two files in one slot are refused", async () => {
    const r = request(app()).post("/apply");
    pdf(r, SPES_SLOTS.FORM2, "a.pdf");
    pdf(r, SPES_SLOTS.FORM2, "b.pdf");
    const res = await r;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_FILE_UNEXPECTED");
  });

  test("a file in an unknown field is refused", async () => {
    const res = await pdf(request(app()).post("/apply"), "resume");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SPES_FILE_UNEXPECTED");
  });

  test("replacing one document enforces the same size and type limits", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(SPES_DOC_MAX_BYTES)]);
    const tooBig = await request(app()).post("/documents").attach("file", big, { filename: "b.pdf", contentType: "application/pdf" });
    expect(tooBig.status).toBe(413);
    const wrong = await request(app()).post("/documents").attach("file", Buffer.from("GIF89a"), { filename: "a.gif", contentType: "image/gif" });
    expect(wrong.status).toBe(415);
    const ok = await pdf(request(app()).post("/documents"), "file");
    expect(ok.status).toBe(200);
  });
});
