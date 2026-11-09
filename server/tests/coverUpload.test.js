// Employer cover upload: image processing (real sharp), the upload and remove
// controllers, and staff moderation (two removals end the upload right).

jest.mock("../models/User", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock("../models/BannerTemplate", () => ({ find: jest.fn() }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const User = require("../models/User");
const BannerTemplate = require("../models/BannerTemplate");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const { singleCoverUpload } = require("../middleware/upload");
const service = require("../services/coverImageService");
const bannerService = require("../services/bannerTemplateService");
const controller = require("../controllers/coverController");

const jpeg = (w = 2000, h = 600, extra = {}) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 80 } } }).jpeg().withMetadata(extra).toBuffer();

describe("processCoverImage (real sharp)", () => {
  test("outputs 1600x400 and 800x200 WebP with no EXIF", async () => {
    const input = await jpeg(2000, 700, { exif: { IFD0: { Copyright: "secret" } } });
    const out = await service.processCoverImage(input);
    const large = await sharp(out.large.buffer).metadata();
    const small = await sharp(out.small.buffer).metadata();
    expect([large.format, large.width, large.height]).toEqual(["webp", 1600, 400]);
    expect([small.format, small.width, small.height]).toEqual(["webp", 800, 200]);
    expect(large.exif).toBeUndefined();
    expect(out.placeholderColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("rejects too small, GIF, junk and an over-limit pixel count", async () => {
    const small = await sharp({ create: { width: 800, height: 200, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(service.processCoverImage(small)).rejects.toMatchObject({ code: "COVER_IMAGE_DIMENSIONS" });
    const gif = await sharp({ create: { width: 1600, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(service.processCoverImage(gif)).rejects.toMatchObject({ code: "COVER_IMAGE_TYPE" });
    await expect(service.processCoverImage(Buffer.from("not an image at all"))).rejects.toMatchObject({ code: "COVER_IMAGE_PROCESSING_FAILED" });
    await expect(service.processCoverImage(Buffer.alloc(0))).rejects.toMatchObject({ code: "COVER_IMAGE_PROCESSING_FAILED" });
    await expect(service.processCoverImage(Buffer.alloc(3 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "COVER_IMAGE_TOO_LARGE" });
  });

  test("an SVG is refused even with an image name", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><script>alert(1)</script></svg>');
    await expect(service.processCoverImage(svg)).rejects.toMatchObject({ code: expect.stringMatching(/COVER_IMAGE_(TYPE|PROCESSING_FAILED)/) });
  });

  test("cropData is clamped and the aspect is fixed", () => {
    expect(service.sanitizeCropData({ x: 99999, y: -99999, zoom: 99, rotation: 720 })).toEqual({ x: 10000, y: -10000, zoom: 10, rotation: 360, aspect: 4 });
    expect(service.sanitizeCropData("x")).toBeUndefined();
  });
});

describe("POST and DELETE cover image", () => {
  const appFor = (role = "employer") => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: "emp1", role };
      next();
    });
    app.post("/cover/image", singleCoverUpload, controller.uploadCoverImage);
    app.delete("/cover/image", controller.removeCoverImage);
    return app;
  };
  const mockUser = (extra = {}) =>
    User.findById.mockReturnValue({ select: () => Promise.resolve({ role: "employer", verificationStatus: "verified", isActive: true, coverUploadRevoked: false, ...extra }) });

  beforeEach(() => {
    jest.resetAllMocks();
    storageService.remove.mockResolvedValue(undefined);
    bannerService.invalidateCache();
    BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
  });

  test("an unverified employer is refused", async () => {
    mockUser({ verificationStatus: "unverified" });
    const res = await request(appFor()).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("COVER_EMPLOYER_NOT_VERIFIED");
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("a revoked employer is refused", async () => {
    mockUser({ coverUploadRevoked: true });
    const res = await request(appFor()).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.body.code).toBe("COVER_UPLOAD_REVOKED");
  });

  test("a jobseeker can never reach the upload", async () => {
    mockUser({ role: "jobseeker" });
    const res = await request(appFor("jobseeker")).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(403);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("a GIF is refused by the multer type filter, a spoofed one by the signature check", async () => {
    mockUser();
    const gifBytes = await sharp({ create: { width: 1600, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer();
    const byMime = await request(appFor()).post("/cover/image").attach("cover", gifBytes, { filename: "c.gif", contentType: "image/gif" });
    expect(byMime.status).toBe(400);
    expect(byMime.body.code).toBe("COVER_IMAGE_TYPE");
    const spoof = await request(appFor()).post("/cover/image").attach("cover", gifBytes, { filename: "c.jpg", contentType: "image/jpeg" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.code).toBe("COVER_IMAGE_TYPE");
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("over 3 MB is COVER_IMAGE_TOO_LARGE (413)", async () => {
    mockUser();
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024 + 10)]);
    const res = await request(appFor()).post("/cover/image").attach("cover", big, { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("COVER_IMAGE_TOO_LARGE");
  });

  test("a valid upload stores two files, saves, removes the previous ones and returns the resolved cover", async () => {
    mockUser({ cover: { image: { storedValue: "/uploads/covers/old.webp", thumbStoredValue: "/uploads/covers/old-s.webp" } } });
    storageService.upload
      .mockResolvedValueOnce({ storedValue: "/uploads/covers/new.webp" })
      .mockResolvedValueOnce({ storedValue: "/uploads/covers/new-s.webp" });
    User.findByIdAndUpdate.mockReturnValue({
      select: () => Promise.resolve({ cover: { kind: "image", image: { status: "published", url: "/uploads/covers/new.webp", thumbUrl: "/uploads/covers/new-s.webp", width: 1600, height: 400, storedValue: "SECRET" } } }),
    });
    const res = await request(appFor()).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(storageService.upload).toHaveBeenCalledTimes(2);
    expect(storageService.upload.mock.calls[0][1].category).toBe("cover");
    const update = User.findByIdAndUpdate.mock.calls[0][1].$set;
    expect(update["cover.kind"]).toBe("image");
    expect(update["cover.image"].status).toBe("published");
    expect(res.body.cover.kind).toBe("image");
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/covers/old.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/covers/old-s.webp");
    expect(storageService.remove).not.toHaveBeenCalledWith("/uploads/covers/new.webp");
  });

  test("if the second upload fails the first is removed and the answer is 502", async () => {
    mockUser();
    storageService.upload.mockResolvedValueOnce({ storedValue: "/uploads/covers/new.webp" }).mockRejectedValueOnce(new Error("cloudinary down"));
    const res = await request(appFor()).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("COVER_UPLOAD_FAILED");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/covers/new.webp");
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("if the save fails both new files are removed and the old ones stay", async () => {
    mockUser({ cover: { image: { storedValue: "/uploads/covers/old.webp" } } });
    storageService.upload.mockResolvedValueOnce({ storedValue: "/uploads/covers/new.webp" }).mockResolvedValueOnce({ storedValue: "/uploads/covers/new-s.webp" });
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.reject(new Error("db down")) });
    const res = await request(appFor()).post("/cover/image").attach("cover", await jpeg(), { filename: "c.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(500);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/covers/new.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/covers/new-s.webp");
    expect(storageService.remove).not.toHaveBeenCalledWith("/uploads/covers/old.webp");
  });

  test("remove deletes both files and falls back to the template choice", async () => {
    mockUser({ cover: { templateId: "t1", image: { storedValue: "a", thumbStoredValue: "b", url: "a" } } });
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({ cover: { kind: "template", templateId: "t1" } }) });
    const res = await request(appFor()).delete("/cover/image");
    expect(res.status).toBe(200);
    const update = User.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set["cover.kind"]).toBe("template");
    expect(update.$unset["cover.image"]).toBe(1);
    expect(storageService.remove).toHaveBeenCalledWith("a");
    expect(storageService.remove).toHaveBeenCalledWith("b");
  });
});

describe("staff moderation", () => {
  const adminApp = (role = "admin") => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: "adm1", role };
      next();
    });
    app.post("/users/:id/cover/remove", controller.adminRemoveCover);
    app.post("/users/:id/cover/restore-upload", controller.adminRestoreCoverUpload);
    return app;
  };
  const target = (extra = {}) => ({ _id: "emp1", role: "employer", coverRemovalCount: 0, coverUploadRevoked: false, cover: { templateId: "t1", image: { url: "u", storedValue: "a", thumbStoredValue: "b", status: "published" } }, ...extra });
  const mockTarget = (doc) => User.findById.mockReturnValue({ select: () => Promise.resolve(doc) });

  beforeEach(() => {
    jest.resetAllMocks();
    storageService.remove.mockResolvedValue(undefined);
    User.updateOne.mockResolvedValue({});
  });

  test("a reason of 5 characters is required", async () => {
    const res = await request(adminApp()).post("/users/emp1/cover/remove").send({ reason: "no" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REASON_REQUIRED");
  });

  test("the first removal deletes the files, counts one, keeps the right, audits and notifies", async () => {
    mockTarget(target());
    const res = await request(adminApp()).post("/users/emp1/cover/remove").send({ reason: "Inappropriate image" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ removalCount: 1, uploadRevoked: false });
    const [, op] = User.updateOne.mock.calls[0];
    expect(op.$set["cover.image.status"]).toBe("removed_by_staff");
    expect(op.$set.coverUploadRevoked).toBe(false);
    expect(op.$set["cover.kind"]).toBe("template");
    expect(op.$inc.coverRemovalCount).toBe(1);
    expect(storageService.remove).toHaveBeenCalledWith("a");
    expect(logAuditEvent.mock.calls[0][0].action).toBe("admin.cover.removed");
    expect(createNotificationForUser.mock.calls[0][0].message).toContain("Inappropriate image");
  });

  test("the second removal revokes the upload right", async () => {
    mockTarget(target({ coverRemovalCount: 1 }));
    const res = await request(adminApp()).post("/users/emp1/cover/remove").send({ reason: "Again inappropriate" });
    expect(res.body).toMatchObject({ removalCount: 2, uploadRevoked: true });
    expect(User.updateOne.mock.calls[0][1].$set.coverUploadRevoked).toBe(true);
  });

  test("removing when there is no image is 409", async () => {
    mockTarget(target({ cover: {} }));
    const res = await request(adminApp()).post("/users/emp1/cover/remove").send({ reason: "Nothing here" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COVER_NO_IMAGE");
  });

  test("only employers can be targeted", async () => {
    mockTarget(target({ role: "jobseeker" }));
    const res = await request(adminApp()).post("/users/emp1/cover/remove").send({ reason: "Whatever reason" });
    expect(res.status).toBe(404);
  });

  test("restore needs a reason, clears the revocation, keeps the count, audits and notifies", async () => {
    mockTarget(target({ coverUploadRevoked: true, coverRemovalCount: 2 }));
    const bad = await request(adminApp()).post("/users/emp1/cover/restore-upload").send({});
    expect(bad.body.code).toBe("REASON_REQUIRED");
    const res = await request(adminApp("superadmin")).post("/users/emp1/cover/restore-upload").send({ reason: "Appeal accepted" });
    expect(res.status).toBe(200);
    expect(User.updateOne.mock.calls[0][1]).toEqual({ $set: { coverUploadRevoked: false } });
    expect(logAuditEvent.mock.calls[0][0].action).toBe("admin.cover.upload_restored");
    expect(createNotificationForUser).toHaveBeenCalled();
  });

  test("restoring an account that is not revoked is 409", async () => {
    mockTarget(target());
    const res = await request(adminApp()).post("/users/emp1/cover/restore-upload").send({ reason: "Just checking" });
    expect(res.status).toBe(409);
  });
});
