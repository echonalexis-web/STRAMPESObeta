// White-box branch coverage for server/middleware/upload.js.
// multer is mocked so the file filters, error mappers and size limits can be
// exercised directly. Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks
// like a defect or gap (see docs/WHITE_BOX_TEST_REPORT.md).

let mockNextError = null;
jest.mock("multer", () => {
  const instances = [];
  const make = (opts) => {
    const run = (req, res, cb) => cb(mockNextError);
    const inst = { opts, single: jest.fn(() => run), array: jest.fn(() => run) };
    instances.push(inst);
    return inst;
  };
  const multer = jest.fn(make);
  multer.memoryStorage = jest.fn(() => "memory-storage");
  multer.__instances = instances;
  return multer;
});
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn() }));
jest.mock("../services/bannerTemplateImageService", () => ({ LIMITS: { maxBytes: 1000 }, PROFILES: { avatar: { maxBytes: 500 } } }));

const multer = require("multer");
const storage = require("../services/storageService");
const up = require("../middleware/upload");
const { makeRes } = require("../testUtils/httpMocks");

const instances = multer.__instances;
const byLimit = (fileSize, files) => instances.find((i) => i.opts.limits.fileSize === fileSize && (files === undefined || i.opts.limits.files === files));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF = Buffer.from("%PDF-1.4");
const GIF89 = Buffer.from("GIF89a....");
const GIF87 = Buffer.from("GIF87a....");
const DOC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const file = (o = {}) => ({ originalname: "cv.pdf", mimetype: "application/pdf", size: 100, buffer: PDF, ...o });

beforeEach(() => {
  mockNextError = null;
  storage.upload.mockReset();
  storage.remove.mockReset();
  storage.remove.mockResolvedValue();
});

// ---------------------------------------------------------------------------
describe("fileFilter (generic uploads)", () => {
  const run = (f) => {
    const cb = jest.fn();
    up.fileFilter({}, f, cb);
    return cb;
  };

  test.each(Object.keys(up.ALLOWED_FILE_TYPES))("WB-UPL-01 mime %s is allowed", (mimetype) => {
    const cb = run({ mimetype, originalname: "a.bin" });
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  test.each([["image/svg+xml"], ["text/html"], ["application/x-msdownload"], ["application/javascript"], [""], [undefined]])("WB-UPL-02 mime %p is rejected with a helpful error", (mimetype) => {
    const cb = run({ mimetype, originalname: "a.bin" });
    const [err, accepted] = cb.mock.calls[0];
    expect(accepted).toBe(false);
    expect(err.message).toMatch(/^Invalid file type\. Allowed: image\/jpeg/);
  });

  test("WB-UPL-03 the client file name is reduced to its base name and stripped of everything except letters, digits, dot and hyphen", () => {
    const f = { mimetype: "application/pdf", originalname: "../../etc/pass wd (1)_é.pdf" };
    run(f);
    expect(f.originalname).toBe("passwd1.pdf");
    const g = { mimetype: "application/pdf", originalname: "C:\\evil\\x.pdf" };
    run(g);
    expect(g.originalname).not.toMatch(/[\\/ ]/);
  });
});

// ---------------------------------------------------------------------------
describe("multer configuration", () => {
  test("WB-UPL-04 generic uploaders use memory storage with a 5 MB cap and file-count limits 1, 5 and 4", () => {
    const generic = instances.filter((i) => i.opts.fileFilter === up.fileFilter);
    expect(generic.map((i) => i.opts.limits.files).sort()).toEqual([1, 4, 5]);
    generic.forEach((i) => {
      expect(i.opts.limits.fileSize).toBe(5 * 1024 * 1024);
      expect(i.opts.storage).toBe("memory-storage");
    });
    expect(up.MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  test("WB-UPL-05 singleFileUpload builds a one-file uploader for the named field", () => {
    const before = instances.length;
    up.singleFileUpload("resume");
    const added = instances[instances.length - 1];
    expect(instances.length).toBe(before + 1);
    expect(added.opts.limits.files).toBe(1);
    expect(added.single).toHaveBeenCalledWith("resume");
  });

  describe("avatar uploader (2 MB, JPG/PNG/WEBP only)", () => {
    const inst = () => byLimit(2 * 1024 * 1024, 1);
    const filter = (f) => {
      const cb = jest.fn();
      inst().opts.fileFilter({}, f, cb);
      return cb.mock.calls[0];
    };

    test.each([["image/jpeg"], ["image/jpg"], ["image/png"], ["image/webp"]])("WB-UPL-06 %s accepted and the name sanitised", (mimetype) => {
      const f = { mimetype, originalname: "../my pic.png" };
      expect(filter(f)).toEqual([null, true]);
      expect(f.originalname).toBe("mypic.png");
    });

    test.each([["image/gif"], ["application/pdf"], ["image/svg+xml"]])("WB-UPL-07 %s rejected", (mimetype) => {
      const [err, ok] = filter({ mimetype, originalname: "a" });
      expect(ok).toBe(false);
      expect(err.message).toBe("Profile picture must be a JPG, PNG, or WEBP image");
    });

    test("WB-UPL-08 exported limits", () => {
      expect(up.AVATAR_MAX_FILE_SIZE).toBe(2 * 1024 * 1024);
      expect(up.AVATAR_FILE_TYPES).toEqual(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
      expect(up.avatarUpload).toBe(inst());
    });
  });

  describe("cover uploader (3 MB, JPG/PNG/WEBP)", () => {
    const inst = () => byLimit(3 * 1024 * 1024, 1);

    test("WB-UPL-09 filter accepts images and rejects others with the COVER_IMAGE_TYPE code", () => {
      const ok = jest.fn();
      inst().opts.fileFilter({}, { mimetype: "image/png" }, ok);
      expect(ok).toHaveBeenCalledWith(null, true);
      const bad = jest.fn();
      inst().opts.fileFilter({}, { mimetype: "image/gif" }, bad);
      expect(bad.mock.calls[0][0].code).toBe("COVER_IMAGE_TYPE");
      expect(bad.mock.calls[0][1]).toBe(false);
      expect(up.COVER_MAX_FILE_SIZE).toBe(3 * 1024 * 1024);
    });

    test.each([
      [null, "next"], [{ code: "LIMIT_FILE_SIZE" }, 413], [{ code: "COVER_IMAGE_TYPE" }, 400], [{ code: "SOMETHING_ELSE" }, 400], [new Error("no code"), 400],
    ])("WB-UPL-10 singleCoverUpload maps multer error %j to %s", (error, outcome) => {
      mockNextError = error;
      const res = makeRes();
      const next = jest.fn();
      up.singleCoverUpload({}, res, next);
      if (outcome === "next") return expect(next).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(outcome);
      const body = res.json.mock.calls[0][0];
      expect(body.code).toBe(error.code === "LIMIT_FILE_SIZE" ? "COVER_IMAGE_TOO_LARGE" : error.code === "COVER_IMAGE_TYPE" ? "COVER_IMAGE_TYPE" : "COVER_IMAGE_REQUIRED");
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("template / avatar-preset uploaders (SVG or PNG)", () => {
    const templateInst = () => instances.find((i) => i.opts.limits.fileSize === 1000 && i.opts.limits.files === 1);
    const presetInst = () => instances.find((i) => i.opts.limits.fileSize === 500 && i.opts.limits.files === 1);

    test("WB-UPL-11 limits: single uploads take 1 file, built-in installs take up to 40 with a larger manifest field", () => {
      expect(templateInst().opts.limits).toMatchObject({ files: 1, fields: 8, fieldSize: 2048, parts: 13 });
      const builtIn = instances.filter((i) => i.opts.limits.files === 40);
      expect(builtIn).toHaveLength(2);
      builtIn.forEach((i) => expect(i.opts.limits).toMatchObject({ fieldSize: 128 * 1024, parts: 52 }));
    });

    test.each([["image/png"], ["IMAGE/SVG+XML"], ["image/svg+xml"]])("WB-UPL-12 mime %s accepted (case-insensitive)", (mimetype) => {
      const cb = jest.fn();
      templateInst().opts.fileFilter({}, { mimetype }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    test.each([["image/jpeg"], ["text/html"], [undefined]])("WB-UPL-13 mime %p rejected with the prefix-specific type code", (mimetype) => {
      const cb = jest.fn();
      presetInst().opts.fileFilter({}, { mimetype }, cb);
      expect(cb.mock.calls[0][0].code).toBe("AVATAR_IMAGE_TYPE");
      const cb2 = jest.fn();
      templateInst().opts.fileFilter({}, { mimetype }, cb2);
      expect(cb2.mock.calls[0][0].code).toBe("TEMPLATE_IMAGE_TYPE");
    });

    test.each([
      ["singleTemplateImageUpload", "TEMPLATE_IMAGE_"], ["singleAvatarPresetImageUpload", "AVATAR_IMAGE_"],
      ["bannerBuiltInImagesUpload", "TEMPLATE_IMAGE_"], ["avatarBuiltInImagesUpload", "AVATAR_IMAGE_"],
    ])("WB-UPL-14 %s maps errors with the %s prefix", (name, prefix) => {
      const cases = [
        [null, null, null],
        [{ code: "LIMIT_FILE_SIZE" }, 413, `${prefix}TOO_LARGE`],
        [{ code: `${prefix}TYPE` }, 400, `${prefix}TYPE`],
        [{ code: "OTHER" }, 400, `${prefix}REQUIRED`],
      ];
      for (const [error, status, code] of cases) {
        mockNextError = error;
        const res = makeRes();
        const next = jest.fn();
        up[name]({}, res, next);
        if (!error) {
          expect(next).toHaveBeenCalled();
        } else {
          expect(res.status).toHaveBeenCalledWith(status);
          expect(res.json.mock.calls[0][0].code).toBe(code);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
describe("generateSecureFilename", () => {
  test("WB-UPL-15 uuid prefix, sanitised base (max 30 chars) and the canonical extension for the mime type", () => {
    const name = up.generateSecureFilename({ mimetype: "application/pdf", originalname: "My R\u00e9sum\u00e9 (final)!.pdf" });
    expect(name).toMatch(/^[0-9a-f-]{36}_MyRsumfinal\.pdf$/);
    const long = up.generateSecureFilename({ mimetype: "image/png", originalname: `${"a".repeat(80)}.png` });
    expect(long).toMatch(/_a{30}\.png$/);
  });

  test("WB-UPL-16 unknown mime falls back to the original extension; missing name becomes 'file'", () => {
    expect(up.generateSecureFilename({ mimetype: "application/x-unknown", originalname: "data.bin" })).toMatch(/_data\.bin$/);
    expect(up.generateSecureFilename({ mimetype: "image/png" })).toMatch(/_file\.png$/);
    expect(up.generateSecureFilename({ mimetype: "x/y" })).toMatch(/_file$/);
  });
});

// ---------------------------------------------------------------------------
describe("matchesDeclaredType (magic bytes)", () => {
  test.each([
    ["image/jpeg", JPG, true], ["image/jpg", JPG, true], ["image/png", PNG, true], ["image/gif", GIF89, true], ["image/gif", GIF87, true],
    ["application/pdf", PDF, true], ["application/msword", DOC, true], [DOCX, ZIP, true], [DOCX, Buffer.from([0x50, 0x4b, 0x05, 0x06]), true],
    [DOCX, Buffer.from([0x50, 0x4b, 0x07, 0x08]), true], ["image/webp", WEBP, true],
  ])("WB-UPL-17 %s with matching bytes passes", (mime, buf, expected) => {
    expect(up.matchesDeclaredType(buf, mime)).toBe(expected);
  });

  test.each([
    ["image/png", JPG], ["image/jpeg", PNG], ["application/pdf", Buffer.from("<html>")], ["application/pdf", Buffer.from("%PD")], ["image/gif", Buffer.from("GIF90a")],
    ["application/msword", ZIP], [DOCX, PDF], ["image/webp", Buffer.from("RIFFxxxxWAVE....")], ["image/webp", Buffer.from("RIFF")], ["image/webp", PNG],
  ])("WB-UPL-18 %s with mismatching/truncated bytes fails", (mime, buf) => {
    expect(up.matchesDeclaredType(buf, mime)).toBe(false);
  });

  test("WB-UPL-19 an empty or missing buffer always fails; a type with no registered signature is let through", () => {
    expect(up.matchesDeclaredType(Buffer.alloc(0), "application/pdf")).toBe(false);
    expect(up.matchesDeclaredType(undefined, "application/pdf")).toBe(false);
    expect(up.matchesDeclaredType(null, "image/webp")).toBe(false);
    expect(up.matchesDeclaredType(Buffer.from("anything"), "application/x-novel")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("validateFile", () => {
  const run = (req) => {
    const res = makeRes();
    const next = jest.fn();
    up.validateFile(req, res, next);
    return { res, next, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
  };

  test("WB-UPL-20 no files (no req.file, empty array, empty object, nothing) is 400", () => {
    for (const req of [{}, { files: [] }, { files: {} }, { files: "x" }]) {
      const r = run(req);
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("No file uploaded");
    }
  });

  test("WB-UPL-21 a valid single file (req.file), an array, and a field map are all accepted", () => {
    expect(run({ file: file() }).next).toHaveBeenCalled();
    expect(run({ files: [file(), file({ mimetype: "image/png", originalname: "p.png", buffer: PNG })] }).next).toHaveBeenCalled();
    expect(run({ files: { resume: [file()], coverLetterFile: [file()] } }).next).toHaveBeenCalled();
  });

  test("WB-UPL-22 size boundary: exactly 5 MB passes, one byte over fails with the file name", () => {
    expect(run({ file: file({ size: 5 * 1024 * 1024 }) }).next).toHaveBeenCalled();
    const r = run({ file: file({ size: 5 * 1024 * 1024 + 1, originalname: "big.pdf" }) });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("File big.pdf exceeds 5MB limit");
  });

  test("WB-UPL-23 a mime type outside the allow-list is 400", () => {
    const r = run({ file: file({ mimetype: "text/html", originalname: "x.html" }) });
    expect(r.body.message).toBe("File x.html has an invalid type");
  });

  test.each([".exe", ".bat", ".sh", ".php", ".asp", ".js", ".html", ".htm", ".JS", ".Php"])("WB-UPL-24 a dangerous extension %s is refused even with an allowed mime type", (ext) => {
    const r = run({ file: file({ originalname: `evil${ext}` }) });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("File type is not allowed");
  });

  test("WB-UPL-25 KNOWN-ISSUE (partial): only the LAST extension is checked, so 'evil.php.pdf' passes the extension rule (it is still held to the PDF magic bytes), and extensions such as .svg/.jsp/.py/.ps1 are not on the list", () => {
    expect(run({ file: file({ originalname: "evil.php.pdf" }) }).next).toHaveBeenCalled();
    expect(run({ file: file({ originalname: "x.jsp" }) }).next).toHaveBeenCalled();
    expect(run({ file: file({ originalname: "x.ps1" }) }).next).toHaveBeenCalled();
  });

  test("WB-UPL-26 a file whose bytes do not match its declared type (a script renamed .pdf) is refused", () => {
    const r = run({ file: file({ buffer: Buffer.from("<script>alert(1)</script>"), originalname: "resume.pdf" }) });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("File resume.pdf does not match its declared file type");
  });

  test("WB-UPL-27 a missing original name is tolerated; the first bad file in a batch stops the request", () => {
    expect(run({ file: file({ originalname: undefined }) }).next).toHaveBeenCalled();
    const r = run({ files: [file(), file({ size: 6 * 1024 * 1024, originalname: "b.pdf" }), file({ mimetype: "text/html" })] });
    expect(r.body.message).toBe("File b.pdf exceeds 5MB limit");
  });

  test("WB-UPL-28 req.file takes precedence over req.files", () => {
    const r = run({ file: file(), files: [file({ mimetype: "text/html" })] });
    expect(r.next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("persistUploads / persistFields", () => {
  const run = async (mw, req) => {
    const res = makeRes();
    const next = jest.fn();
    await mw(req, res, next);
    return { res, next, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
  };

  test("WB-UPL-29 persistUploads stores every file (single, array or field map) in ONE category for the owner and records the stored values", async () => {
    storage.upload.mockImplementation(async (f) => ({ storedValue: `s/${f.originalname}` }));
    const a = file({ originalname: "a.pdf" });
    const b = file({ originalname: "b.pdf" });
    const req = { user: { id: "u1" }, files: { x: [a], y: [b] } };
    const r = await run(up.persistUploads("docs"), req);
    expect(r.next).toHaveBeenCalled();
    expect(storage.upload).toHaveBeenCalledWith(a, { category: "docs", ownerId: "u1" });
    expect([a.storedValue, b.storedValue]).toEqual(["s/a.pdf", "s/b.pdf"]);
    expect(req.uploadedObjects).toEqual(["s/a.pdf", "s/b.pdf"]);
  });

  test("WB-UPL-30 persistUploads with no files calls next; with no user the owner id is undefined; earlier uploadedObjects are kept", async () => {
    const r = await run(up.persistUploads("docs"), {});
    expect(r.next).toHaveBeenCalled();
    storage.upload.mockResolvedValue({ storedValue: "s" });
    const req = { file: file(), uploadedObjects: ["prev"] };
    await run(up.persistUploads("docs"), req);
    expect(storage.upload.mock.calls[0][1].ownerId).toBeUndefined();
    expect(req.uploadedObjects).toEqual(["prev", "s"]);
  });

  test("WB-UPL-31 a storage failure part-way rolls back everything already stored and answers 502 (no next)", async () => {
    storage.upload.mockResolvedValueOnce({ storedValue: "s1" }).mockRejectedValueOnce(new Error("disk"));
    const req = { files: [file(), file()] };
    const r = await run(up.persistUploads("docs"), req);
    expect(r.status).toBe(502);
    expect(r.body.message).toBe("File storage upload failed. Please try again.");
    expect(r.next).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith("s1");
    expect(req.uploadedObjects).toEqual([]);
  });

  test("WB-UPL-32 persistFields uploads only the mapped fields that hold arrays, each into its own category", async () => {
    storage.upload.mockImplementation(async (f, o) => ({ storedValue: `${o.category}/${f.originalname}` }));
    const resume = file({ originalname: "r.pdf" });
    const cover = file({ originalname: "c.pdf" });
    const stray = file({ originalname: "stray.pdf" });
    const req = { user: { id: "u1" }, files: { resume: [resume], coverLetterFile: [cover], stray: [stray], notArray: "x" } };
    const r = await run(up.persistFields({ resume: "applicationResume", coverLetterFile: "applicationCover", missing: "m", notArray: "n" }), req);
    expect(r.next).toHaveBeenCalled();
    expect(resume.storedValue).toBe("applicationResume/r.pdf");
    expect(cover.storedValue).toBe("applicationCover/c.pdf");
    expect(stray.storedValue).toBeUndefined();
    expect(storage.upload).toHaveBeenCalledTimes(2);
  });

  test("WB-UPL-33 persistFields ignores an array-shaped req.files and a missing one", async () => {
    expect((await run(up.persistFields({ resume: "x" }), { files: [file()] })).next).toHaveBeenCalled();
    expect((await run(up.persistFields({ resume: "x" }), {})).next).toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  test("WB-UPL-34 persistFields rolls back and answers 502 on a storage failure", async () => {
    storage.upload.mockResolvedValueOnce({ storedValue: "s1" }).mockRejectedValueOnce(new Error("disk"));
    const req = { files: { resume: [file(), file()] } };
    const r = await run(up.persistFields({ resume: "x" }), req);
    expect(r.status).toBe(502);
    expect(storage.remove).toHaveBeenCalledWith("s1");
  });

  test("WB-UPL-35 rollback with nothing uploaded removes nothing", async () => {
    storage.upload.mockRejectedValue(new Error("disk"));
    await run(up.persistUploads("docs"), { files: [file()] });
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("cleanupUploadedFiles", () => {
  const setup = (req) => {
    const res = makeRes();
    const original = res.json;
    const next = jest.fn();
    up.cleanupUploadedFiles(req, res, next);
    return { res, original, next };
  };

  test("WB-UPL-36 an error response with uncommitted uploads deletes them; the response is passed through unchanged", () => {
    const req = { uploadedObjects: ["a", "b"] };
    const { res, original, next } = setup(req);
    expect(next).toHaveBeenCalled();
    res.statusCode = 400;
    res.json({ message: "bad" });
    expect(storage.remove).toHaveBeenCalledWith("a");
    expect(storage.remove).toHaveBeenCalledWith("b");
    expect(original).toHaveBeenCalledWith({ message: "bad" });
  });

  test("WB-UPL-37 a body flagged with `error` also counts as a failure, even with a 200 status", () => {
    const { res } = setup({ uploadedObjects: ["a"] });
    res.statusCode = 200;
    res.json({ error: "x" });
    expect(storage.remove).toHaveBeenCalledWith("a");
  });

  test("WB-UPL-38 success responses, committed uploads, and requests without uploads leave storage alone", () => {
    let s = setup({ uploadedObjects: ["a"] });
    s.res.statusCode = 200;
    s.res.json({ ok: true });
    s = setup({ uploadedObjects: ["a"], uploadsCommitted: true });
    s.res.statusCode = 500;
    s.res.json({ message: "late failure" });
    s = setup({ uploadedObjects: [] });
    s.res.statusCode = 400;
    s.res.json({});
    s = setup({});
    s.res.statusCode = 400;
    s.res.json(undefined);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
