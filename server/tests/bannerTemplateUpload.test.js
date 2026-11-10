// Superadmin banner templates as uploaded images (SVG or PNG): the image pipeline
// (real sharp), the multipart routes on both mounts, roles, cleanup, audit, the rate
// limit and legacy templates. Models and storage are mocked: nothing touches a real
// database or a Cloudinary account.

process.env.BANNER_TEMPLATE_UPLOADS_PER_HOUR = "1000";
delete process.env.DISABLE_RATE_LIMITS;

jest.setTimeout(30000); // real sharp work: stay green when the whole suite runs in parallel

jest.mock("../models/BannerTemplate", () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  exists: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
  bulkWrite: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock("../models/User", () => ({ aggregate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
// Real isSuperadmin, fake token check: the role comes from a test header.
jest.mock("../middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "No token" });
    req.user = { id: "507f1f77bcf86cd799439099", role };
    return next();
  },
  isSuperadmin: (req, res, next) => (req.user.role === "superadmin" ? next() : res.status(403).json({ message: "Superadmin access required" })),
}));

const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const BannerTemplate = require("../models/BannerTemplate");
const User = require("../models/User");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const service = require("../services/bannerTemplateService");
const images = require("../services/bannerTemplateImageService");
const { buildTemplateUploadLimiter } = require("../middleware/bannerTemplateLimiter");
const { superadminRouter, publicRouter } = require("../routes/bannerTemplateRoutes");

const ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f1f77bcf86cd799439012";

// ------------------------------------------------------------------ fixtures
const png = (w = 1600, h = 400, background = "#0b704b", extra = {}) =>
  sharp({ create: { width: w, height: h, channels: 3, background } }).png().withMetadata(extra).toBuffer();
const svg = (body = "", attrs = 'width="1600" height="400"', fill = "#0b704b") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="1600" height="400" fill="${fill}"/>${body}</svg>`);
const file = (buffer, originalname, mimetype) => ({ buffer, originalname, mimetype });
const pngFile = (buffer) => file(buffer, "banner.png", "image/png");
const svgFile = (buffer) => file(buffer, "banner.svg", "image/svg+xml");

// ------------------------------------------------------------------ image pipeline
describe("processTemplateImage (real sharp)", () => {
  test("a PNG becomes a 1600x400 WebP and an 800x200 thumbnail with no metadata", async () => {
    const input = await png(2000, 500, "#0b704b", { exif: { IFD0: { Copyright: "secret" } } });
    const out = await images.processTemplateImage(pngFile(input));
    const large = await sharp(out.large.buffer).metadata();
    const small = await sharp(out.small.buffer).metadata();
    expect([large.format, large.width, large.height]).toEqual(["webp", 1600, 400]);
    expect([small.format, small.width, small.height]).toEqual(["webp", 800, 200]);
    expect(large.exif).toBeUndefined();
    expect(out.placeholderColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.sourceType).toBe("png");
  });

  test("an SVG is rasterized to the same WebP outputs", async () => {
    const out = await images.processTemplateImage(svgFile(svg()));
    const large = await sharp(out.large.buffer).metadata();
    expect([large.format, large.width, large.height]).toEqual(["webp", 1600, 400]);
    expect(out.sourceType).toBe("svg");
    expect(out.large.buffer.toString("latin1")).not.toContain("<svg");
  });

  test("an SVG with only a viewBox is accepted", async () => {
    const buf = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400"><rect width="1600" height="400" fill="#123456"/></svg>');
    const out = await images.processTemplateImage(svgFile(buf));
    expect((await sharp(out.large.buffer).metadata()).width).toBe(1600);
  });

  test("an SVG may reference its own ids and embed a PNG data URI", async () => {
    const dot = (await png(4, 4)).toString("base64");
    const body = `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><image href="data:image/png;base64,${dot}" width="4" height="4"/>`;
    await expect(images.processTemplateImage(svgFile(svg(body)))).resolves.toMatchObject({ sourceType: "svg" });
  });

  test.each([
    ["script tag", '<script>alert(1)</script>'],
    ["script with a type", '<script type="text/javascript">fetch("//evil")</script>'],
    ["onload handler", ""],
    ["onclick handler", '<rect width="5" height="5" onclick="alert(1)"/>'],
    ["foreignObject with HTML", '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>'],
    ["external http href", '<image href="http://evil.example/x.png" width="5" height="5"/>'],
    ["external xlink:href", '<image xlink:href="https://evil.example/x.png" width="5" height="5"/>'],
    ["local file href", '<image href="file:///etc/passwd" width="5" height="5"/>'],
    ["relative file href", '<image href="../../secret.png" width="5" height="5"/>'],
    ["javascript url", '<a href="javascript:alert(1)"><rect width="5" height="5"/></a>'],
    ["url() to an external file", '<rect width="5" height="5" fill="url(http://evil.example/p.svg#a)"/>'],
    ["css import", "<style>@import url(http://evil.example/a.css);</style>"],
    ["iframe", '<iframe src="http://evil.example"></iframe>'],
  ])("rejects an SVG with %s", async (name, body) => {
    const attrs = name === "onload handler" ? 'width="1600" height="400" onload="alert(1)"' : 'width="1600" height="400" xmlns:xlink="http://www.w3.org/1999/xlink"';
    await expect(images.processTemplateImage(svgFile(svg(body, attrs)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_UNSAFE" });
  });

  test("rejects an entity-expansion SVG (DOCTYPE and ENTITY)", async () => {
    const bomb = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><text>&b;</text></svg>'
    );
    await expect(images.processTemplateImage(svgFile(bomb))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_UNSAFE" });
  });

  test("a PNG with a .svg name is rejected, and so is an SVG with a .png name", async () => {
    await expect(images.processTemplateImage(file(await png(), "banner.svg", "image/svg+xml"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    await expect(images.processTemplateImage(file(await png(), "banner.svg", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    await expect(images.processTemplateImage(file(svg(), "banner.png", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    await expect(images.processTemplateImage(file(svg(), "banner.png", "image/svg+xml"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
  });

  test("HTML or a script renamed to .png or .svg is rejected", async () => {
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
    await expect(images.processTemplateImage(file(html, "banner.png", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    await expect(images.processTemplateImage(file(html, "banner.svg", "image/svg+xml"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    const js = Buffer.from("alert(document.cookie);//aaaaaaaaaa");
    await expect(images.processTemplateImage(file(js, "banner.png", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
  });

  test("a truncated PNG fails cleanly", async () => {
    const whole = await png();
    await expect(images.processTemplateImage(pngFile(whole.subarray(0, 60)))).rejects.toMatchObject({
      code: expect.stringMatching(/TEMPLATE_IMAGE_(PROCESSING_FAILED|DIMENSIONS)/),
    });
  });

  test("other formats (JPEG, GIF, WebP) are refused", async () => {
    const jpeg = await sharp({ create: { width: 1600, height: 400, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    await expect(images.processTemplateImage(file(jpeg, "banner.png", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
    const gif = await sharp({ create: { width: 1600, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(images.processTemplateImage(file(gif, "banner.png", "image/png"))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TYPE" });
  });

  test("too large is refused before decoding", async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(images.LIMITS.maxBytes)]);
    await expect(images.processTemplateImage(pngFile(big))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TOO_LARGE" });
    const fat = svg(`<!-- ${"x".repeat(images.LIMITS.maxSvgBytes)} -->`);
    await expect(images.processTemplateImage(svgFile(fat))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_TOO_LARGE" });
  });

  test("bad PNG dimensions are refused", async () => {
    await expect(images.processTemplateImage(pngFile(await png(800, 200)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_DIMENSIONS" });
    await expect(images.processTemplateImage(pngFile(await png(7000, 1750)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_DIMENSIONS" });
  });

  test("a huge declared SVG size is refused", async () => {
    const huge = svg("", 'width="200000" height="50000"');
    await expect(images.processTemplateImage(svgFile(huge))).rejects.toMatchObject({ code: expect.stringMatching(/TEMPLATE_IMAGE_(DIMENSIONS|PROCESSING_FAILED)/) });
  });

  test("a ratio near 4:1 is accepted and anything else is rejected with the ratio code", async () => {
    await expect(images.processTemplateImage(pngFile(await png(1600, 410)))).resolves.toMatchObject({ sourceType: "png" });
    await expect(images.processTemplateImage(pngFile(await png(1600, 800)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_RATIO" });
    await expect(images.processTemplateImage(pngFile(await png(1600, 440)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_RATIO" });
    await expect(images.processTemplateImage(svgFile(svg("", 'width="1000" height="1000"')))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_RATIO" });
  });

  test("text over the banner is derived from the image brightness", async () => {
    const dark = await images.processTemplateImage(pngFile(await png(1600, 400, "#04321f")));
    const light = await images.processTemplateImage(pngFile(await png(1600, 400, "#f5f1e6")));
    expect(dark.overlay).toBe("dark");
    expect(light.overlay).toBe("light");
    expect(light.luminance).toBeGreaterThan(dark.luminance);
  });

  test("an empty or missing file is refused", async () => {
    await expect(images.processTemplateImage(undefined)).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_REQUIRED" });
    await expect(images.processTemplateImage(pngFile(Buffer.alloc(0)))).rejects.toMatchObject({ code: "TEMPLATE_IMAGE_REQUIRED" });
  });
});

// ------------------------------------------------------------------ routes
const appFor = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/superadmin/banner-templates", superadminRouter);
  app.use("/api/v1/superadmin/banner-templates", superadminRouter);
  app.use("/api/banner-templates", publicRouter);
  app.use("/api/v1/banner-templates", publicRouter);
  return app;
};
const as = (role) => ({ "x-test-role": role });

const doc = (extra = {}) => {
  const d = {
    _id: ID,
    slug: "old",
    name: "Old",
    kind: "image",
    image: { url: "/uploads/banner-templates/old-large.webp", thumbUrl: "/uploads/banner-templates/old-small.webp", storedValue: "/uploads/banner-templates/old-large.webp", thumbStoredValue: "/uploads/banner-templates/old-small.webp", width: 1600, height: 400 },
    overlay: "dark",
    isActive: true,
    isDefault: false,
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
  d.toObject = () => ({ ...d });
  return d;
};
const legacyDoc = (extra = {}) =>
  doc({ _id: ID, slug: "gold-dots", name: "Gold dots", kind: "pattern", image: undefined, definition: service.CLASSIC_DEFINITION, ...extra });

let uploadCount;
const mockStorage = () => {
  uploadCount = 0;
  storageService.upload.mockImplementation(async () => {
    uploadCount += 1;
    return { storedValue: `/uploads/banner-templates/new-${uploadCount}.webp` };
  });
};

beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  storageService.remove.mockResolvedValue(undefined);
  service.invalidateCache();
  User.aggregate.mockResolvedValue([]);
  mockStorage();
});

const MOUNTS = ["/api/superadmin/banner-templates", "/api/v1/superadmin/banner-templates"];

describe.each(MOUNTS)("POST %s (create)", (mount) => {
  const create = async (buffer, name, mime, fields = { name: "Forest Dots" }) => {
    let req = request(appFor()).post(mount).set(as("superadmin"));
    Object.entries(fields).forEach(([k, v]) => {
      req = req.field(k, v);
    });
    return req.attach("image", buffer, { filename: name, contentType: mime });
  };
  const created = () => {
    BannerTemplate.exists.mockResolvedValue(null);
    BannerTemplate.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve({ sortOrder: 3 }) }) }) });
    BannerTemplate.create.mockImplementation(async (d) => ({ ...d, _id: ID, toObject() { return { ...d, _id: ID }; } }));
  };

  test("an SVG and a PNG both create an image template", async () => {
    created();
    const a = await create(svg(), "a.svg", "image/svg+xml", { name: "Forest Dots", nameFil: "Gubat" });
    expect(a.status).toBe(201);
    const b = await create(await png(), "b.png", "image/png", { name: "Gold Rings" });
    expect(b.status).toBe(201);
    const stored = BannerTemplate.create.mock.calls[0][0];
    expect(stored).toMatchObject({ kind: "image", slug: "forest-dots", name: "Forest Dots", nameFil: "Gubat", sortOrder: 4, isActive: true });
    expect(stored.definition).toBeUndefined();
    expect(stored.image).toMatchObject({ width: 1600, height: 400 });
    expect(storageService.upload).toHaveBeenCalledTimes(4); // large and thumbnail, twice
    for (const call of storageService.upload.mock.calls) expect(call[0].mimetype).toBe("image/webp");
  });

  test("the response never exposes stored values and carries the legacy flag", async () => {
    created();
    const res = await create(svg(), "a.svg", "image/svg+xml");
    expect(JSON.stringify(res.body)).not.toContain("storedValue");
    expect(res.body).toMatchObject({ kind: "image", legacy: false, usage: 0 });
    expect(res.body.image.url).toBe("/uploads/banner-templates/new-1.webp");
  });

  test("it writes one audit event with the actor and the template id, not the file", async () => {
    created();
    await create(svg(), "a.svg", "image/svg+xml");
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const event = logAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({ action: "superadmin.banner_template.created", actorId: "507f1f77bcf86cd799439099", actorRole: "superadmin", targetId: ID });
    expect(event.metadata.templateId).toBe(ID);
    expect(JSON.stringify(event.metadata)).not.toMatch(/buffer|<svg|base64/i);
  });

  test.each([
    ["a missing file", null],
  ])("%s answers TEMPLATE_IMAGE_REQUIRED", async () => {
    created();
    const res = await request(appFor()).post(mount).set(as("superadmin")).field("name", "No image");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TEMPLATE_IMAGE_REQUIRED");
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("an unsafe SVG, a renamed file and a wrong MIME type are refused before storage", async () => {
    created();
    const unsafe = await create(svg("<script>alert(1)</script>"), "a.svg", "image/svg+xml");
    expect([unsafe.status, unsafe.body.code]).toEqual([400, "TEMPLATE_IMAGE_UNSAFE"]);
    const renamed = await create(Buffer.from("<html><script>x</script></html>"), "a.png", "image/png");
    expect([renamed.status, renamed.body.code]).toEqual([400, "TEMPLATE_IMAGE_TYPE"]);
    const pngAsSvg = await create(await png(), "a.svg", "image/svg+xml");
    expect([pngAsSvg.status, pngAsSvg.body.code]).toEqual([400, "TEMPLATE_IMAGE_TYPE"]);
    const mime = await create(await png(), "a.jpg", "image/jpeg");
    expect([mime.status, mime.body.code]).toEqual([400, "TEMPLATE_IMAGE_TYPE"]);
    expect(storageService.upload).not.toHaveBeenCalled();
    expect(BannerTemplate.create).not.toHaveBeenCalled();
  });

  test("oversize at the request layer answers TEMPLATE_IMAGE_TOO_LARGE", async () => {
    created();
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(images.LIMITS.maxBytes + 1024)]);
    const res = await create(big, "a.png", "image/png");
    expect([res.status, res.body.code]).toEqual([413, "TEMPLATE_IMAGE_TOO_LARGE"]);
  });

  test("bad dimensions and ratio return their codes", async () => {
    created();
    expect((await create(await png(800, 200), "a.png", "image/png")).body.code).toBe("TEMPLATE_IMAGE_DIMENSIONS");
    expect((await create(await png(1600, 800), "a.png", "image/png")).body.code).toBe("TEMPLATE_IMAGE_RATIO");
  });

  test("a bad name is refused and a taken name answers TEMPLATE_NAME_TAKEN, both before storage", async () => {
    created();
    const empty = await create(svg(), "a.svg", "image/svg+xml", { name: "  " });
    expect(empty.body.code).toBe("TEMPLATE_DEFINITION_INVALID");
    const long = await create(svg(), "a.svg", "image/svg+xml", { name: "x".repeat(61) });
    expect(long.body.code).toBe("TEMPLATE_DEFINITION_INVALID");
    BannerTemplate.exists.mockResolvedValue({ _id: "x" });
    const taken = await create(svg(), "a.svg", "image/svg+xml");
    expect([taken.status, taken.body.code]).toEqual([409, "TEMPLATE_NAME_TAKEN"]);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("builder fields in the body are ignored, not stored", async () => {
    created();
    const res = await create(svg(), "a.svg", "image/svg+xml", { name: "Plain", kind: "gradient", definition: '{"gradient":1}', overlay: "light" });
    expect(res.status).toBe(201);
    const stored = BannerTemplate.create.mock.calls[0][0];
    expect(stored.kind).toBe("image");
    expect(stored.definition).toBeUndefined();
  });

  test("a storage failure answers 502 and removes what was already stored", async () => {
    created();
    storageService.upload.mockReset();
    storageService.upload.mockResolvedValueOnce({ storedValue: "/uploads/banner-templates/first.webp" }).mockRejectedValueOnce(new Error("boom"));
    const res = await create(svg(), "a.svg", "image/svg+xml");
    expect([res.status, res.body.code]).toEqual([502, "TEMPLATE_UPLOAD_FAILED"]);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/first.webp");
    expect(BannerTemplate.create).not.toHaveBeenCalled();
  });

  test("a failed save removes both new files", async () => {
    created();
    BannerTemplate.create.mockRejectedValue(new Error("db down"));
    const res = await create(svg(), "a.svg", "image/svg+xml");
    expect(res.status).toBe(500);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/new-1.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/new-2.webp");
  });
});

describe.each(MOUNTS)("PUT %s/:id (update and replace)", (mount) => {
  const update = (id, fields, attach) => {
    let req = request(appFor()).put(`${mount}/${id}`).set(as("superadmin"));
    Object.entries(fields).forEach(([k, v]) => {
      req = req.field(k, v);
    });
    if (attach) req = req.attach("image", attach.buffer, { filename: attach.name, contentType: attach.mime });
    return req;
  };

  test("renaming without a file touches no storage", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    const res = await update(ID, { name: "New name", nameFil: "Bagong pangalan" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "New name", nameFil: "Bagong pangalan", slug: "old" });
    expect(storageService.upload).not.toHaveBeenCalled();
    expect(storageService.remove).not.toHaveBeenCalled();
    expect(logAuditEvent.mock.calls[0][0].action).toBe("superadmin.banner_template.updated");
  });

  test("replacing the image stores the new files, then removes the old ones", async () => {
    const existing = doc();
    BannerTemplate.findById.mockResolvedValue(existing);
    const res = await update(ID, { name: "Old" }, { buffer: await png(), name: "n.png", mime: "image/png" });
    expect(res.status).toBe(200);
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(existing.image.url).toBe("/uploads/banner-templates/new-1.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/old-large.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/old-small.webp");
    expect(storageService.remove).not.toHaveBeenCalledWith("/uploads/banner-templates/new-1.webp");
    expect(logAuditEvent.mock.calls[0][0].action).toBe("superadmin.banner_template.image_replaced");
  });

  test("a failed save keeps the old files and removes the new ones", async () => {
    const existing = doc({ save: jest.fn().mockRejectedValue(new Error("db down")) });
    BannerTemplate.findById.mockResolvedValue(existing);
    const res = await update(ID, { name: "Old" }, { buffer: await png(), name: "n.png", mime: "image/png" });
    expect(res.status).toBe(500);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/new-1.webp");
    expect(storageService.remove).not.toHaveBeenCalledWith("/uploads/banner-templates/old-large.webp");
  });

  test("a rejected replacement changes nothing", async () => {
    const existing = doc();
    BannerTemplate.findById.mockResolvedValue(existing);
    const res = await update(ID, { name: "Old" }, { buffer: svg("<script/>"), name: "n.svg", mime: "image/svg+xml" });
    expect(res.body.code).toBe("TEMPLATE_IMAGE_UNSAFE");
    expect(existing.save).not.toHaveBeenCalled();
    expect(storageService.remove).not.toHaveBeenCalled();
  });

  test("a legacy template can be renamed and keeps its definition", async () => {
    const existing = legacyDoc();
    BannerTemplate.findById.mockResolvedValue(existing);
    const res = await update(ID, { name: "Gold dots v2" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "pattern", legacy: true });
    expect(existing.definition).toEqual(service.CLASSIC_DEFINITION);
    expect(res.body.definition).toBeDefined();
  });

  test("an image replaces a legacy template: it becomes an image template, the old definition is kept", async () => {
    const existing = legacyDoc();
    BannerTemplate.findById.mockResolvedValue(existing);
    const res = await update(ID, { name: "Gold dots" }, { buffer: svg(), name: "n.svg", mime: "image/svg+xml" });
    expect(res.status).toBe(200);
    expect(existing.kind).toBe("image");
    expect(existing.definition).toEqual(service.CLASSIC_DEFINITION);
    expect(storageService.remove).not.toHaveBeenCalled(); // a legacy template had no files
  });

  test("the default cannot be archived through an update", async () => {
    BannerTemplate.findById.mockResolvedValue(doc({ isDefault: true }));
    const res = await update(ID, { name: "Old", isActive: "false" });
    expect([res.status, res.body.code]).toEqual([409, "TEMPLATE_IS_DEFAULT"]);
  });

  test("an unknown id answers 404 and a malformed id 400", async () => {
    BannerTemplate.findById.mockResolvedValue(null);
    expect((await update(OTHER_ID, { name: "x" })).body.code).toBe("COVER_TEMPLATE_NOT_FOUND");
    expect((await update("nope", { name: "x" })).status).toBe(400);
  });
});

describe("other management routes, both mounts", () => {
  test.each(MOUNTS)("delete at zero usage removes the stored files (%s)", async (mount) => {
    BannerTemplate.findById.mockResolvedValue(doc());
    BannerTemplate.deleteOne.mockResolvedValue({});
    const res = await request(appFor()).delete(`${mount}/${ID}`).set(as("superadmin"));
    expect(res.status).toBe(200);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/old-large.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/banner-templates/old-small.webp");
    expect(logAuditEvent.mock.calls[0][0]).toMatchObject({ action: "superadmin.banner_template.deleted", targetId: ID });
  });

  test.each(MOUNTS)("delete of a template in use is refused and keeps the files (%s)", async (mount) => {
    BannerTemplate.findById.mockResolvedValue(doc());
    User.aggregate.mockResolvedValue([{ _id: ID, n: 3 }]);
    const res = await request(appFor()).delete(`${mount}/${ID}`).set(as("superadmin"));
    expect([res.status, res.body.code]).toEqual([409, "TEMPLATE_IN_USE"]);
    expect(storageService.remove).not.toHaveBeenCalled();
  });

  test.each(MOUNTS)("archive, activate, default and reorder each write an audit event (%s)", async (mount) => {
    const existing = doc();
    BannerTemplate.findById.mockResolvedValue(existing);
    User.aggregate.mockResolvedValue([{ _id: ID, n: 2 }]);
    await request(appFor()).patch(`${mount}/${ID}/active`).set(as("superadmin")).send({ isActive: false });
    await request(appFor()).patch(`${mount}/${ID}/active`).set(as("superadmin")).send({ isActive: true });
    BannerTemplate.updateMany.mockResolvedValue({});
    await request(appFor()).patch(`${mount}/${ID}/default`).set(as("superadmin"));
    BannerTemplate.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: ID }, { _id: OTHER_ID }]) }) });
    BannerTemplate.bulkWrite.mockResolvedValue({});
    const order = await request(appFor()).put(`${mount}/order`).set(as("superadmin")).send({ ids: [OTHER_ID, ID] });
    expect(order.status).toBe(200);
    expect(logAuditEvent.mock.calls.map((c) => c[0].action)).toEqual([
      "superadmin.banner_template.archived",
      "superadmin.banner_template.activated",
      "superadmin.banner_template.default_set",
      "superadmin.banner_template.reordered",
    ]);
    expect(logAuditEvent.mock.calls[0][0].metadata).toMatchObject({ templateId: ID, usage: 2 });
  });

  test.each(MOUNTS)("the admin list keeps legacy templates, with their definition and a legacy flag (%s)", async (mount) => {
    BannerTemplate.find.mockReturnValue({
      sort: () => ({
        lean: () =>
          Promise.resolve([
            { _id: ID, slug: "gold-dots", name: "Gold dots", kind: "pattern", definition: service.CLASSIC_DEFINITION, overlay: "dark", sortOrder: 0, isActive: true, isDefault: true },
            { ...doc({ _id: OTHER_ID, sortOrder: 1 }) },
          ]),
      }),
    });
    User.aggregate.mockResolvedValue([{ _id: ID, n: 7 }]);
    const res = await request(appFor()).get(mount).set(as("superadmin"));
    expect(res.status).toBe(200);
    const [legacy, image] = res.body.templates;
    expect(legacy).toMatchObject({ kind: "pattern", legacy: true, usage: 7, isDefault: true });
    expect(legacy.definition.gradient).toBeDefined();
    expect(image).toMatchObject({ kind: "image", legacy: false, usage: 0 });
    expect(JSON.stringify(res.body)).not.toContain("storedValue");
  });
});

describe("who may manage templates", () => {
  test.each(MOUNTS)("only a superadmin is allowed (%s)", async (mount) => {
    BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    const noToken = await request(appFor()).get(mount);
    expect(noToken.status).toBe(401);
    for (const role of ["admin", "employer", "jobseeker"]) {
      const list = await request(appFor()).get(mount).set(as(role));
      const create = await request(appFor()).post(mount).set(as(role)).field("name", "x").attach("image", svg(), { filename: "a.svg", contentType: "image/svg+xml" });
      const update = await request(appFor()).put(`${mount}/${ID}`).set(as(role)).field("name", "x");
      const archive = await request(appFor()).patch(`${mount}/${ID}/active`).set(as(role)).send({ isActive: false });
      const remove = await request(appFor()).delete(`${mount}/${ID}`).set(as(role));
      expect([list.status, create.status, update.status, archive.status, remove.status]).toEqual([403, 403, 403, 403, 403]);
    }
    expect(storageService.upload).not.toHaveBeenCalled();
    expect(BannerTemplate.create).not.toHaveBeenCalled();
    expect((await request(appFor()).get(mount).set(as("superadmin"))).status).toBe(200);
  });
});

describe("the active list for signed-in users", () => {
  test.each(["/api/banner-templates", "/api/v1/banner-templates"])("serves image and legacy templates, never stored values (%s)", async (mount) => {
    BannerTemplate.find.mockReturnValue({
      sort: () => ({
        lean: () =>
          Promise.resolve([
            { _id: ID, slug: "gold-dots", name: "Gold dots", nameFil: "", kind: "pattern", definition: service.CLASSIC_DEFINITION, overlay: "dark", isDefault: true },
            { ...doc({ _id: OTHER_ID, slug: "forest", name: "Forest", overlay: "light" }), image: { url: "u", thumbUrl: "t", storedValue: "SECRET", thumbStoredValue: "SECRET2", width: 1600, height: 400, placeholderColor: "#0b704b" } },
          ]),
      }),
    });
    const res = await request(appFor()).get(mount).set(as("jobseeker"));
    expect(res.status).toBe(200);
    expect(res.body.defaultId).toBe(ID);
    const [legacy, image] = res.body.templates;
    expect(legacy).toMatchObject({ kind: "pattern" });
    expect(legacy.definition).toBeDefined();
    expect(legacy.image).toBeUndefined();
    expect(image).toMatchObject({ kind: "image", overlay: "light", image: { url: "u", thumbUrl: "t", width: 1600, height: 400, placeholderColor: "#0b704b" } });
    expect(image.definition).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
  });
});

describe("falling back to the default", () => {
  const rows = (list) => BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(list) }) });
  const imageRow = { ...doc({ _id: OTHER_ID, slug: "forest", name: "Forest" }) };
  const defaultRow = { _id: ID, slug: "gold-dots", name: "Gold dots", kind: "pattern", definition: service.CLASSIC_DEFINITION, overlay: "dark", isDefault: true };

  test("an image template resolves for the people who chose it", async () => {
    rows([defaultRow, imageRow]);
    const out = await service.resolveCover({ kind: "template", templateId: OTHER_ID });
    expect(out.template.kind).toBe("image");
    expect(out.template.image.url).toContain("old-large");
  });

  test("an archived or deleted template shows the default, and the stored cover is untouched", async () => {
    rows([defaultRow]); // the active list no longer contains the image template
    const cover = { kind: "template", templateId: OTHER_ID };
    const out = await service.resolveCover(cover);
    expect(out.template.id).toBe(ID);
    expect(cover).toEqual({ kind: "template", templateId: OTHER_ID });
  });

  test("with no default document it falls back to the built-in banner", async () => {
    rows([]);
    expect(await service.resolveCover({ kind: "template", templateId: OTHER_ID })).toEqual({ kind: "default" });
  });
});

describe("rate limit", () => {
  test("the limiter answers 429 with a code after the budget", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: "u1" };
      next();
    });
    app.post("/", buildTemplateUploadLimiter({ max: 2 }), (_req, res) => res.json({ ok: true }));
    expect((await request(app).post("/")).status).toBe(200);
    expect((await request(app).post("/")).status).toBe(200);
    const blocked = await request(app).post("/");
    expect([blocked.status, blocked.body.code]).toEqual([429, "TEMPLATE_UPLOAD_RATE_LIMITED"]);
  });

  test.each(MOUNTS)("the upload routes use it (%s)", async (mount) => {
    process.env.BANNER_TEMPLATE_UPLOADS_PER_HOUR = "2";
    let isolatedRouter;
    jest.isolateModules(() => {
      isolatedRouter = require("../routes/bannerTemplateRoutes").superadminRouter;
    });
    process.env.BANNER_TEMPLATE_UPLOADS_PER_HOUR = "1000";
    const app = express();
    app.use("/api/superadmin/banner-templates", isolatedRouter);
    app.use("/api/v1/superadmin/banner-templates", isolatedRouter);
    BannerTemplate.exists.mockResolvedValue({ _id: "taken" });
    const attempt = () =>
      request(app).post(mount).set(as("superadmin")).field("name", "x").attach("image", svg(), { filename: "a.svg", contentType: "image/svg+xml" });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attempt()).status);
    expect(statuses).toEqual([409, 409, 429, 429]);
    const put = await request(app).put(mount + "/" + ID).set(as("superadmin")).field("name", "x");
    expect(put.status).toBe(429);
  });
});
