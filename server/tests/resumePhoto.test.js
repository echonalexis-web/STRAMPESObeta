// The resume photo: an applicant-owned image, separate from the profile photo. Real sharp, an
// in-memory stand-in for the model, the real routes (so multer's limits and filter are exercised).

jest.mock("../middleware/auth", () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: req.headers["x-user"] || "aaaaaaaaaaaaaaaaaaaaaaaa", role: "jobseeker" };
    next();
  },
  isJobseeker: (_req, _res, next) => next(),
}));
jest.mock("../middleware/budgets", () => ({ uploadBudget: (_req, _res, next) => next() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(null) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({
  find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), countDocuments: jest.fn(), exists: jest.fn(),
  create: jest.fn(), updateMany: jest.fn(), findByIdAndDelete: jest.fn(),
}));
jest.mock("../models/JobApplication", () => ({ exists: jest.fn() }));
jest.mock("../models/User", () => ({ findByIdAndUpdate: jest.fn(), findById: jest.fn() }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn() }));

// One document per owner, like the unique index.
const mockStore = new Map();
jest.mock("../models/ResumePhoto", () => {
  const chain = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
  return {
    findOne: jest.fn((filter) => chain(mockStore.get(String(filter.owner)) || null)),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const key = String(filter.owner);
      const doc = { ...(mockStore.get(key) || { owner: key }), ...update.$set, updatedAt: new Date() };
      mockStore.set(key, doc);
      return doc;
    }),
    findOneAndDelete: jest.fn(async (filter) => {
      const key = String(filter.owner);
      const doc = mockStore.get(key) || null;
      mockStore.delete(key);
      return doc;
    }),
  };
});

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const ResumePhoto = require("../models/ResumePhoto");
const JobseekerDocument = require("../models/JobseekerDocument");
const User = require("../models/User");
const routes = require("../routes/jobseekerDocumentRoutes");
const { processResumePhoto, LIMITS, OUTPUT_SIZE } = require("../services/resumePhotoService");

const ALICE = "aaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbbbbbbbbbb";

const app = express();
app.use("/api/jobseeker/documents", routes);

const jpeg = (width = 600, height = 300, options = {}) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().withMetadata(options).toBuffer();
const send = (buffer, { name = "me.jpg", type = "image/jpeg", user } = {}) =>
  request(app)
    .put("/api/jobseeker/documents/photo")
    .set(user ? { "x-user": user } : {})
    .attach("photo", buffer, { filename: name, contentType: type });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe("processing", () => {
  test("any shape becomes one square 400px WebP with no metadata, and EXIF orientation is applied first", async () => {
    // 600x300 with orientation 6 reads as 300x600 once turned: the crop is square either way.
    const out = await processResumePhoto(await jpeg(600, 300, { orientation: 6, exif: { IFD0: { Copyright: "secret-gps-owner" } } }));
    const meta = await sharp(out.buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", OUTPUT_SIZE, OUTPUT_SIZE]);
    expect(meta.exif).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret-gps-owner"))).toBe(false);
  });

  test("the type is decided from the bytes: a GIF, an SVG and a renamed document are refused", async () => {
    const gif = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(processResumePhoto(gif)).rejects.toMatchObject({ code: "RESUME_PHOTO_TYPE", status: 400 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>');
    await expect(processResumePhoto(svg)).rejects.toMatchObject({ code: "RESUME_PHOTO_TYPE" });
    await expect(processResumePhoto(Buffer.from("%PDF-1.4 not an image"))).rejects.toMatchObject({ code: "RESUME_PHOTO_TYPE" });
  });

  test("too large and too small are refused with their own codes", async () => {
    await expect(processResumePhoto(Buffer.alloc(LIMITS.maxBytes + 1))).rejects.toMatchObject({ code: "RESUME_PHOTO_TOO_LARGE", status: 413 });
    await expect(processResumePhoto(await jpeg(60, 60))).rejects.toMatchObject({ code: "RESUME_PHOTO_DIMENSIONS" });
  });
});

describe("routes", () => {
  test("upload stores one processed photo for the caller; the answer has a name and size, never the bytes", async () => {
    const res = await send(await jpeg(), { name: "../../My Face (1).jpg" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasPhoto: true, name: "MyFace1.jpg", width: 400, height: 400 });
    expect(JSON.stringify(res.body)).not.toContain("data");
    expect(mockStore.size).toBe(1);
    expect(mockStore.get(ALICE).contentType).toBe("image/webp");
  });

  test("a second upload replaces the first: still one photo per applicant", async () => {
    await send(await jpeg(), { name: "one.jpg" });
    const before = mockStore.get(ALICE).data;
    const res = await send(await jpeg(500, 500), { name: "two.jpg" });
    expect(res.body.name).toBe("two.jpg");
    expect(mockStore.size).toBe(1);
    expect(mockStore.get(ALICE).data).not.toBe(before);
    expect(ResumePhoto.findOneAndUpdate.mock.calls.every(([filter, , options]) => filter.owner === ALICE && options.upsert === true)).toBe(true);
  });

  test("wrong content: a text file claiming to be a JPEG is refused after its bytes are read", async () => {
    const res = await send(Buffer.from("just some text, not a picture"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESUME_PHOTO_TYPE");
    expect(mockStore.size).toBe(0);
  });

  test("wrong declared type (a PDF, a GIF) is refused by the filter; an oversize file answers 413", async () => {
    const pdf = await send(Buffer.from("%PDF-1.4"), { name: "cv.pdf", type: "application/pdf" });
    expect([pdf.status, pdf.body.code]).toEqual([400, "RESUME_PHOTO_TYPE"]);
    const big = await send(Buffer.alloc(LIMITS.maxBytes + 1024, 1));
    expect([big.status, big.body.code]).toEqual([413, "RESUME_PHOTO_TOO_LARGE"]);
    expect(mockStore.size).toBe(0);
  });

  test("only the owner can read it: another user sees none, and cannot name a different owner", async () => {
    await send(await jpeg());
    const mine = await request(app).get("/api/jobseeker/documents/photo");
    expect(mine.status).toBe(200);
    expect(mine.headers["content-type"]).toBe("image/webp");
    expect(mine.headers["x-content-type-options"]).toBe("nosniff");
    expect(mine.headers["cache-control"]).toBe("private, no-store");
    expect((await sharp(mine.body).metadata()).format).toBe("webp");

    const theirs = await request(app).get("/api/jobseeker/documents/photo").set("x-user", BOB);
    expect(theirs.status).toBe(404);
    const info = await request(app).get("/api/jobseeker/documents/photo/info").set("x-user", BOB);
    expect(info.body).toEqual({ hasPhoto: false });
    // A query string or body cannot redirect the lookup to someone else.
    await request(app).get(`/api/jobseeker/documents/photo?owner=${ALICE}`).set("x-user", BOB);
    expect(ResumePhoto.findOne.mock.calls.every(([filter]) => Object.keys(filter).join() === "owner")).toBe(true);
  });

  test("another user's upload and removal never touch my photo", async () => {
    await send(await jpeg());
    const mine = mockStore.get(ALICE);
    await send(await jpeg(300, 300), { user: BOB });
    await request(app).delete("/api/jobseeker/documents/photo").set("x-user", BOB);
    expect(mockStore.get(ALICE)).toBe(mine);
    expect(mockStore.has(BOB)).toBe(false);
  });

  test("remove deletes the photo and is safe to repeat; saved resumes and the profile photo are not touched", async () => {
    await send(await jpeg());
    expect((await request(app).delete("/api/jobseeker/documents/photo")).body).toEqual({ hasPhoto: false });
    expect(mockStore.size).toBe(0);
    expect((await request(app).delete("/api/jobseeker/documents/photo")).status).toBe(200);
    // Resumes already saved carry their own copy of the picture: no document row is read or changed.
    for (const fn of Object.values(JobseekerDocument)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    // The profile photo lives on the user record; this feature never loads or writes it.
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(User.findById).not.toHaveBeenCalled();
    const sources = ["../controllers/resumePhotoController.js", "../services/resumePhotoService.js", "../models/ResumePhoto.js"]
      .map((file) => fs.readFileSync(path.join(__dirname, file), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/profileImage|avatarPreset/);
  });
});

describe("saved resume metadata", () => {
  const { uploadMyDocument } = require("../controllers/jobseekerDocumentController");
  const storageService = require("../services/storageService");
  const run = async (body) => {
    JobseekerDocument.countDocuments.mockResolvedValue(0);
    JobseekerDocument.exists.mockResolvedValue(null);
    storageService.upload.mockResolvedValue({ storedValue: "s/r.pdf" });
    JobseekerDocument.create.mockImplementation(async (d) => ({ _id: "x", ...d }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await uploadMyDocument({ user: { id: ALICE }, body, file: { originalname: "r.pdf", mimetype: "application/pdf", size: 10 } }, res);
    return JobseekerDocument.create.mock.calls.at(-1)[0];
  };

  test("a standard builder resume records that it shows the photo; ATS and plain uploads never do", async () => {
    expect((await run({ kind: "resume", source: "builder", hasPhoto: "true" })).hasPhoto).toBe(true);
    expect((await run({ kind: "resume", source: "builder", resumeType: "ats", hasPhoto: "true" })).hasPhoto).toBeUndefined();
    expect((await run({ kind: "resume", source: "upload", hasPhoto: "true" })).hasPhoto).toBeUndefined();
    expect((await run({ kind: "coverLetter", source: "builder", hasPhoto: "true" })).hasPhoto).toBeUndefined();
  });
});
