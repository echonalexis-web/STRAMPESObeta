// Built-in banners and avatars (installed from the bundled SVGs through the normal
// validated pipeline), custom and built-in delete rules, avatar presets (upload,
// install, jobseeker choice, fallback). Models and storage are mocked; the image
// pipeline is real sharp and the install tests use the real bundled SVG files.

process.env.BANNER_TEMPLATE_UPLOADS_PER_HOUR = "1000";
delete process.env.DISABLE_RATE_LIMITS;

const mockStore = { banners: [], avatars: [] };

jest.mock("../models/BannerTemplate", () => {
  const api = {
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
    deleteOne: jest.fn(),
  };
  return api;
});
jest.mock("../models/AvatarPreset", () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  exists: jest.fn(),
  create: jest.fn(),
  bulkWrite: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock("../models/User", () => ({ aggregate: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/storageService", () => ({ upload: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "No token" });
    req.user = { id: "507f1f77bcf86cd799439099", role };
    return next();
  },
  isSuperadmin: (req, res, next) => (req.user.role === "superadmin" ? next() : res.status(403).json({ message: "Superadmin access required" })),
}));

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const BannerTemplate = require("../models/BannerTemplate");
const AvatarPreset = require("../models/AvatarPreset");
const User = require("../models/User");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const bannerService = require("../services/bannerTemplateService");
const avatarService = require("../services/avatarPresetService");
const builtIns = require("../services/builtInTemplateService");
const images = require("../services/bannerTemplateImageService");
const avatarController = require("../controllers/avatarPresetController");
const bannerRoutes = require("../routes/bannerTemplateRoutes");
const avatarRoutes = require("../routes/avatarPresetRoutes");

const ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f1f77bcf86cd799439012";
const USER_ID = "507f1f77bcf86cd799439099";

const assetDir = (name) => path.join(__dirname, "..", "..", "client", "src", "assets", name);
const readAssets = (dir, prefix) =>
  fs
    .readdirSync(assetDir(dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".svg"))
    .sort()
    .map((f) => ({ file: f, buffer: fs.readFileSync(path.join(assetDir(dir), f)) }));

const keyFor = (kind, index) => `builtin-${kind}-${String(index + 1).padStart(2, "0")}`;
const manifestFor = (kind, assets) =>
  assets.map((a, i) => ({
    key: keyFor(kind, i),
    name: a.file.replace(/^[A-Za-z]+_\d+_/, "").replace(/\.svg$/, "").replace(/_/g, " "),
    nameFil: "",
    isDefault: kind === "banner" && i === 0,
  }));

const svg = (body = "", attrs = 'width="512" height="512"', w = 512, h = 512) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="${w}" height="${h}" fill="#0b704b"/>${body}</svg>`);
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#0b704b" } }).png().toBuffer();

const as = (role) => ({ "x-test-role": role });
const appFor = () => {
  const app = express();
  app.use(express.json());
  for (const base of ["/api", "/api/v1"]) {
    app.use(`${base}/superadmin/banner-templates`, bannerRoutes.superadminRouter);
    app.use(`${base}/superadmin/avatar-presets`, avatarRoutes.superadminRouter);
    app.use(`${base}/avatar-presets`, avatarRoutes.publicRouter);
    app.put(`${base}/auth/profile/avatar/preset`, (req, res, next) => {
      const role = req.headers["x-test-role"];
      if (!role) return res.status(401).json({ message: "No token" });
      req.user = { id: USER_ID, role };
      return next();
    }, avatarController.chooseOwnPreset);
  }
  return app;
};
const MOUNTS = ["/api", "/api/v1"];

// A tiny in-memory store behind the mocked models.
const wireStore = (Model, rows, extra = {}) => {
  Model.find.mockImplementation((query = {}) => {
    const keys = query.builtInKey && query.builtInKey.$in;
    const list = keys ? rows.filter((r) => keys.includes(r.builtInKey)) : rows;
    const chain = { select: () => chain, lean: () => Promise.resolve(list), sort: () => chain };
    return chain;
  });
  Model.findOne.mockReturnValue({
    sort: () => ({ select: () => ({ lean: () => Promise.resolve(rows.length ? { sortOrder: Math.max(...rows.map((r) => r.sortOrder)) } : null) }) }),
  });
  Model.create.mockImplementation(async (doc) => {
    rows.push({ ...doc, _id: `id${rows.length + 1}` });
    return rows[rows.length - 1];
  });
  if (extra.exists) Model.exists.mockImplementation(extra.exists);
};

let uploadCount;
beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue(undefined);
  storageService.remove.mockResolvedValue(undefined);
  uploadCount = 0;
  storageService.upload.mockImplementation(async () => {
    uploadCount += 1;
    return { storedValue: `/uploads/x/f-${uploadCount}.webp` };
  });
  bannerService.invalidateCache();
  avatarService.invalidateCache();
  User.aggregate.mockResolvedValue([]);
  mockStore.banners = [];
  mockStore.avatars = [];
});

const postBuiltIns = (mount, kind, assets, manifest = manifestFor(kind === "banner" ? "banner" : "avatar", assets), role = "superadmin") => {
  let req = request(appFor())
    .post(`${mount}/superadmin/${kind === "banner" ? "banner-templates" : "avatar-presets"}/builtins`)
    .set(as(role))
    .field("manifest", JSON.stringify(manifest));
  assets.forEach((a) => {
    req = req.attach("images", a.buffer, { filename: a.file, contentType: "image/svg+xml" });
  });
  return req;
};

// ------------------------------------------------------------------ the bundled files
describe("the bundled SVG files", () => {
  const banners = readAssets("cover-images", "Banner_");
  const avatars = readAssets("avatars", "Avatar_");

  test("there are 12 banners and 12 avatars", () => {
    expect(banners).toHaveLength(12);
    expect(avatars).toHaveLength(12);
  });

  test("every bundled SVG passes the real pipeline at the target size", async () => {
    for (const a of banners) {
      const out = await images.processTemplateImage({ buffer: a.buffer, originalname: a.file, mimetype: "image/svg+xml" }, images.PROFILES.banner);
      const meta = await sharp(out.large.buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1600, 400]);
    }
    for (const a of avatars) {
      const out = await images.processTemplateImage({ buffer: a.buffer, originalname: a.file, mimetype: "image/svg+xml" }, images.PROFILES.avatar);
      const large = await sharp(out.large.buffer).metadata();
      const small = await sharp(out.small.buffer).metadata();
      expect([large.format, large.width, large.height]).toEqual(["webp", 512, 512]);
      expect([small.width, small.height]).toEqual([128, 128]);
    }
  });
});

// ------------------------------------------------------------------ manifest parsing
describe("parseManifest", () => {
  const ok = [{ key: "builtin-banner-01", name: "Forest Dots", nameFil: "Gubat" }];
  test("accepts a valid manifest and keeps only whitelisted fields", () => {
    const out = builtIns.parseManifest(JSON.stringify([{ ...ok[0], evil: "x", isDefault: true }]), "banner");
    expect(out).toEqual({ ok: true, entries: [{ key: "builtin-banner-01", name: "Forest Dots", nameFil: "Gubat", isDefault: true }] });
  });
  test.each([
    ["not json", "{"],
    ["not an array", JSON.stringify({ a: 1 })],
    ["empty", "[]"],
    ["wrong kind key", JSON.stringify([{ key: "builtin-avatar-01", name: "A" }])],
    ["arbitrary key", JSON.stringify([{ key: "../x", name: "A" }])],
    ["duplicate keys", JSON.stringify([ok[0], ok[0]])],
    ["empty name", JSON.stringify([{ key: "builtin-banner-01", name: " " }])],
    ["long name", JSON.stringify([{ key: "builtin-banner-01", name: "x".repeat(61) }])],
    ["too many", JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ key: `builtin-banner-${String(i + 1).padStart(2, "0")}`, name: "n" })))],
  ])("rejects %s", (_n, raw) => {
    expect(builtIns.parseManifest(raw, "banner").ok).toBe(false);
  });
});

// ------------------------------------------------------------------ banner built-ins
describe.each(MOUNTS)("POST %s/superadmin/banner-templates/builtins", (mount) => {
  const banners = readAssets("cover-images", "Banner_");

  test("installs all 12 from the real files, in order, the first as default", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => null });
    const res = await postBuiltIns(mount, "banner", banners);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 12, existing: 0, failed: 0 });
    expect(mockStore.banners).toHaveLength(12);
    expect(mockStore.banners.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(mockStore.banners.filter((r) => r.isDefault)).toHaveLength(1);
    expect(mockStore.banners[0]).toMatchObject({ builtInKey: "builtin-banner-01", isBuiltIn: true, kind: "image", isDefault: true, name: "Forest Dots" });
    expect(storageService.upload).toHaveBeenCalledTimes(24);
  });

  test("a second run creates nothing and does not overwrite edits", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => ({ _id: "x" }) });
    await postBuiltIns(mount, "banner", banners);
    // The superadmin renames, archives and reorders; then installs again.
    mockStore.banners[0].name = "My own name";
    mockStore.banners[0].isActive = false;
    mockStore.banners[0].sortOrder = 99;
    BannerTemplate.create.mockClear();
    storageService.upload.mockClear();
    const res = await postBuiltIns(mount, "banner", banners);
    expect(res.body).toMatchObject({ created: 0, existing: 12, failed: 0 });
    expect(BannerTemplate.create).not.toHaveBeenCalled();
    expect(storageService.upload).not.toHaveBeenCalled();
    expect(mockStore.banners).toHaveLength(12);
    expect(mockStore.banners[0]).toMatchObject({ name: "My own name", isActive: false, sortOrder: 99 });
  });

  test("restores only the missing built-ins", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => ({ _id: "x" }) });
    await postBuiltIns(mount, "banner", banners);
    mockStore.banners.splice(3, 2); // two built-ins disappeared
    const res = await postBuiltIns(mount, "banner", banners);
    expect(res.body).toMatchObject({ created: 2, existing: 10, failed: 0 });
    expect(mockStore.banners).toHaveLength(12);
  });

  test("an existing default is never replaced by the built-in default", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => ({ _id: "x" }) }); // a default already exists
    await postBuiltIns(mount, "banner", banners);
    expect(mockStore.banners.filter((r) => r.isDefault)).toHaveLength(0);
  });

  test("a hostile file fails alone with its code, the rest are installed", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => null });
    const evil = { file: "Banner_02_Evil.svg", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="480"><script>alert(1)</script></svg>') };
    const list = [banners[0], evil, banners[2]];
    const res = await postBuiltIns(mount, "banner", list);
    expect(res.body).toMatchObject({ created: 2, existing: 0, failed: 1 });
    expect(res.body.results[1]).toEqual({ key: "builtin-banner-02", status: "failed", code: "TEMPLATE_IMAGE_UNSAFE" });
    expect(mockStore.banners).toHaveLength(2);
  });

  test("a bad manifest or a files mismatch answers 400 and stores nothing", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => null });
    const badKey = await postBuiltIns(mount, "banner", [banners[0]], [{ key: "evil", name: "x" }]);
    expect([badKey.status, badKey.body.code]).toEqual([400, "TEMPLATE_MANIFEST_INVALID"]);
    const mismatch = await postBuiltIns(mount, "banner", [banners[0]], manifestFor("banner", banners.slice(0, 2)));
    expect([mismatch.status, mismatch.body.code]).toEqual([400, "TEMPLATE_MANIFEST_INVALID"]);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("it audits one event with counts and keys only", async () => {
    wireStore(BannerTemplate, mockStore.banners, { exists: async () => null });
    await postBuiltIns(mount, "banner", banners.slice(0, 2));
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const event = logAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("superadmin.banner_template.builtins_installed");
    expect(event.metadata).toEqual({ created: 2, existing: 0, failed: 0, keys: ["builtin-banner-01", "builtin-banner-02"] });
  });

  test("only a superadmin may install", async () => {
    for (const role of ["admin", "employer", "jobseeker"]) {
      const res = await postBuiltIns(mount, "banner", banners.slice(0, 1), undefined, role);
      expect(res.status).toBe(403);
    }
    expect(BannerTemplate.create).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ delete rules
describe.each(MOUNTS)("deleting banners (%s)", (mount) => {
  const doc = (extra = {}) => ({ _id: ID, slug: "x", name: "X", kind: "image", image: { storedValue: "/uploads/x/a.webp", thumbStoredValue: "/uploads/x/b.webp" }, isActive: true, isDefault: false, isBuiltIn: false, ...extra });
  const del = (suffix = "") => request(appFor()).delete(`${mount}/superadmin/banner-templates/${ID}${suffix}`).set(as("superadmin"));

  test("a built-in cannot be deleted", async () => {
    BannerTemplate.findById.mockResolvedValue(doc({ isBuiltIn: true, builtInKey: "builtin-banner-03" }));
    const res = await del();
    expect([res.status, res.body.code]).toEqual([409, "TEMPLATE_BUILTIN_PROTECTED"]);
    expect(BannerTemplate.deleteOne).not.toHaveBeenCalled();
    expect(storageService.remove).not.toHaveBeenCalled();
  });

  test("a custom unused banner is deleted and its files removed", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    BannerTemplate.deleteOne.mockResolvedValue({});
    const res = await del();
    expect(res.status).toBe(200);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/x/a.webp");
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/x/b.webp");
  });

  test("a custom banner in use needs the confirmation and states the count", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    BannerTemplate.deleteOne.mockResolvedValue({});
    User.aggregate.mockResolvedValue([{ _id: ID, n: 5 }]);
    const refused = await del();
    expect([refused.status, refused.body.code, refused.body.usage]).toEqual([409, "TEMPLATE_IN_USE", 5]);
    expect(BannerTemplate.deleteOne).not.toHaveBeenCalled();
    const confirmed = await del("?confirmUsage=true");
    expect(confirmed.status).toBe(200);
    expect(BannerTemplate.deleteOne).toHaveBeenCalled();
    expect(logAuditEvent.mock.calls.at(-1)[0].metadata).toMatchObject({ usage: 5 });
  });

  test("the image of a built-in cannot be replaced, but it can be renamed", async () => {
    const existing = { ...doc({ isBuiltIn: true }), save: jest.fn().mockResolvedValue(undefined) };
    existing.toObject = () => ({ ...existing });
    BannerTemplate.findById.mockResolvedValue(existing);
    const replace = await request(appFor())
      .put(`${mount}/superadmin/banner-templates/${ID}`)
      .set(as("superadmin"))
      .field("name", "X")
      .attach("image", svg("", 'width="1600" height="400"', 1600, 400), { filename: "a.svg", contentType: "image/svg+xml" });
    expect([replace.status, replace.body.code]).toEqual([409, "TEMPLATE_BUILTIN_IMAGE_LOCKED"]);
    const rename = await request(appFor()).put(`${mount}/superadmin/banner-templates/${ID}`).set(as("superadmin")).field("name", "New name");
    expect(rename.status).toBe(200);
    expect(rename.body).toMatchObject({ name: "New name", isBuiltIn: true });
  });
});

// ------------------------------------------------------------------ avatar built-ins and CRUD
describe.each(MOUNTS)("avatar presets (%s)", (mount) => {
  const avatars = readAssets("avatars", "Avatar_");
  const base = `${mount}/superadmin/avatar-presets`;

  test("installs all 12 from the real files; a second run adds nothing", async () => {
    wireStore(AvatarPreset, mockStore.avatars);
    const first = await postBuiltIns(mount, "avatar", avatars);
    expect(first.body).toMatchObject({ created: 12, existing: 0, failed: 0 });
    expect(mockStore.avatars[0]).toMatchObject({ builtInKey: "builtin-avatar-01", isBuiltIn: true, name: "Initials Forest" });
    expect(mockStore.avatars.every((r) => !("isDefault" in r))).toBe(true);
    AvatarPreset.create.mockClear();
    const second = await postBuiltIns(mount, "avatar", avatars);
    expect(second.body).toMatchObject({ created: 0, existing: 12 });
    expect(AvatarPreset.create).not.toHaveBeenCalled();
  });

  const create = (buffer, name, mime, fields = { name: "Leafy" }) => {
    let req = request(appFor()).post(base).set(as("superadmin"));
    Object.entries(fields).forEach(([k, v]) => {
      req = req.field(k, v);
    });
    return req.attach("image", buffer, { filename: name, contentType: mime });
  };
  const created = () => {
    AvatarPreset.exists.mockResolvedValue(null);
    AvatarPreset.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve({ sortOrder: 3 }) }) }) });
    AvatarPreset.create.mockImplementation(async (d) => ({ ...d, _id: ID, toObject() { return { ...d, _id: ID }; } }));
  };

  test("a square SVG and a square PNG are accepted and normalized to 512 and 128", async () => {
    created();
    expect((await create(svg(), "a.svg", "image/svg+xml")).status).toBe(201);
    expect((await create(await png(600, 600), "b.png", "image/png", { name: "Round" })).status).toBe(201);
    expect(storageService.upload).toHaveBeenCalledTimes(4);
    const stored = AvatarPreset.create.mock.calls[0][0];
    expect(stored.image).toMatchObject({ width: 512, height: 512 });
    expect(stored.isDefault).toBeUndefined();
  });

  test("a wide banner image is refused as not square", async () => {
    created();
    const res = await create(await png(1600, 400), "a.png", "image/png");
    expect([res.status, res.body.code]).toEqual([400, "AVATAR_IMAGE_RATIO"]);
  });

  test("hostile and renamed files are refused with avatar codes, nothing stored", async () => {
    created();
    const script = await create(svg("<script>alert(1)</script>"), "a.svg", "image/svg+xml");
    expect([script.status, script.body.code]).toEqual([400, "AVATAR_IMAGE_UNSAFE"]);
    const handler = await create(svg("", 'width="512" height="512" onload="x()"'), "a.svg", "image/svg+xml");
    expect(handler.body.code).toBe("AVATAR_IMAGE_UNSAFE");
    const external = await create(svg('<image href="http://evil.example/x.png" width="5" height="5"/>'), "a.svg", "image/svg+xml");
    expect(external.body.code).toBe("AVATAR_IMAGE_UNSAFE");
    const html = await create(Buffer.from("<html><script>x</script></html>"), "a.png", "image/png");
    expect([html.status, html.body.code]).toEqual([400, "AVATAR_IMAGE_TYPE"]);
    const pngAsSvg = await create(await png(512, 512), "a.svg", "image/svg+xml");
    expect(pngAsSvg.body.code).toBe("AVATAR_IMAGE_TYPE");
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  test("too small, too large and too big a file", async () => {
    created();
    expect((await create(await png(64, 64), "a.png", "image/png")).body.code).toBe("AVATAR_IMAGE_DIMENSIONS");
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(images.PROFILES.avatar.maxBytes + 1024)]);
    const res = await create(big, "a.png", "image/png");
    expect([res.status, res.body.code]).toEqual([413, "AVATAR_IMAGE_TOO_LARGE"]);
  });

  test("built-in avatars cannot be deleted; custom can, in use only with confirmation", async () => {
    const row = (extra = {}) => ({ _id: ID, slug: "x", name: "X", image: { storedValue: "/uploads/x/a.webp", thumbStoredValue: "/uploads/x/b.webp" }, isBuiltIn: false, ...extra });
    AvatarPreset.findById.mockResolvedValue(row({ isBuiltIn: true }));
    const protectedRes = await request(appFor()).delete(`${base}/${ID}`).set(as("superadmin"));
    expect([protectedRes.status, protectedRes.body.code]).toEqual([409, "AVATAR_BUILTIN_PROTECTED"]);

    AvatarPreset.findById.mockResolvedValue(row());
    AvatarPreset.deleteOne.mockResolvedValue({});
    User.aggregate.mockResolvedValue([{ _id: ID, n: 2 }]);
    const refused = await request(appFor()).delete(`${base}/${ID}`).set(as("superadmin"));
    expect([refused.status, refused.body.code, refused.body.usage]).toEqual([409, "TEMPLATE_IN_USE", 2]);
    const ok = await request(appFor()).delete(`${base}/${ID}?confirmUsage=true`).set(as("superadmin"));
    expect(ok.status).toBe(200);
    expect(storageService.remove).toHaveBeenCalledWith("/uploads/x/a.webp");
    expect(logAuditEvent.mock.calls.at(-1)[0]).toMatchObject({ action: "superadmin.avatar_preset.deleted", targetId: ID });
  });

  test("only a superadmin may manage avatars", async () => {
    AvatarPreset.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    for (const role of ["admin", "employer", "jobseeker"]) {
      const list = await request(appFor()).get(base).set(as(role));
      const post = await create(svg(), "a.svg", "image/svg+xml").set(as(role));
      const del = await request(appFor()).delete(`${base}/${ID}`).set(as(role));
      expect([list.status, post.status, del.status]).toEqual([403, 403, 403]);
    }
    expect(AvatarPreset.create).not.toHaveBeenCalled();
  });

  test("the audit trail carries ids and counts only", async () => {
    created();
    await create(svg(), "a.svg", "image/svg+xml");
    const event = logAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({ action: "superadmin.avatar_preset.created", targetId: ID });
    expect(JSON.stringify(event.metadata)).not.toMatch(/buffer|<svg|base64/i);
  });

  test("reorder needs every id once", async () => {
    AvatarPreset.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: ID }, { _id: OTHER_ID }]) }) });
    AvatarPreset.bulkWrite.mockResolvedValue({});
    const bad = await request(appFor()).put(`${base}/order`).set(as("superadmin")).send({ ids: [ID] });
    expect(bad.body.code).toBe("TEMPLATE_ORDER_INVALID");
    const ok = await request(appFor()).put(`${base}/order`).set(as("superadmin")).send({ ids: [OTHER_ID, ID] });
    expect(ok.status).toBe(200);
  });
});

// ------------------------------------------------------------------ jobseeker choice
describe.each(MOUNTS)("choosing a preset avatar (%s)", (mount) => {
  const choose = (body, role = "jobseeker") => request(appFor()).put(`${mount}/auth/profile/avatar/preset`).set(as(role)).send(body);
  const image = { url: "/uploads/avatar-presets/a.webp", thumbUrl: "/uploads/avatar-presets/b.webp", storedValue: "SECRET", width: 512, height: 512 };
  const activeRow = { _id: ID, name: "Leaf", nameFil: "", image, isActive: true, archivedAt: null };

  beforeEach(() => {
    User.findById.mockReturnValue({ select: () => Promise.resolve({ role: "jobseeker" }) });
    User.findByIdAndUpdate.mockImplementation((id, update) => ({ select: () => Promise.resolve({ avatar: update.$set ? { presetId: update.$set["avatar.presetId"] } : undefined }) }));
    AvatarPreset.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(activeRow) }) });
    AvatarPreset.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([activeRow]) }) });
  });

  test("an active id is accepted and the descriptor hides stored values", async () => {
    const res = await choose({ presetId: ID });
    expect(res.status).toBe(200);
    expect(res.body.avatarPreset).toMatchObject({ id: ID, name: "Leaf", image: { url: image.url, thumbUrl: image.thumbUrl } });
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
    const update = User.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set["avatar.presetId"]).toBe(ID);
  });

  test("only presetId is accepted: urls, images and other keys are refused", async () => {
    for (const body of [{ presetId: ID, url: "http://evil/x.png" }, { image: "data:..." }, { url: "http://evil/x.png" }, {}, [], { presetId: 5 }]) {
      const res = await choose(body);
      expect([res.status, res.body.code]).toEqual([400, "AVATAR_ONLY_PRESET_ALLOWED"]);
    }
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("unknown, malformed and archived ids are refused", async () => {
    AvatarPreset.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    expect((await choose({ presetId: OTHER_ID })).body.code).toBe("AVATAR_PRESET_NOT_FOUND");
    expect((await choose({ presetId: "not-an-id" })).body.code).toBe("AVATAR_PRESET_NOT_FOUND");
    AvatarPreset.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ ...activeRow, isActive: false }) }) });
    const archived = await choose({ presetId: ID });
    expect([archived.status, archived.body.code]).toEqual([409, "AVATAR_PRESET_INACTIVE"]);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("null clears the choice", async () => {
    const res = await choose({ presetId: null });
    expect(res.status).toBe(200);
    expect(res.body.avatarPreset).toBeNull();
    expect(User.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $unset: { avatar: 1 } });
  });

  test("only jobseekers may choose; employers and staff are refused", async () => {
    for (const role of ["employer", "admin", "superadmin"]) {
      User.findById.mockReturnValue({ select: () => Promise.resolve({ role }) });
      const res = await choose({ presetId: ID }, role);
      expect([res.status, res.body.code]).toEqual([403, "AVATAR_NOT_ALLOWED"]);
    }
    expect((await request(appFor()).put(`${mount}/auth/profile/avatar/preset`).send({ presetId: ID })).status).toBe(401);
  });
});

describe("the active list and fallback", () => {
  const archivedRow = { _id: OTHER_ID, name: "Old", image: { url: "u", thumbUrl: "t" }, isActive: false };
  const activeRow = { _id: ID, name: "Leaf", nameFil: "Dahon", image: { url: "/a.webp", thumbUrl: "/b.webp", storedValue: "SECRET" }, isActive: true };

  test.each(MOUNTS)("GET %s/avatar-presets serves active presets only, with no stored values", async (mount) => {
    AvatarPreset.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([activeRow]) }) });
    const res = await request(appFor()).get(`${mount}/avatar-presets`).set(as("jobseeker"));
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([{ id: ID, name: "Leaf", nameFil: "Dahon", image: { url: "/a.webp", thumbUrl: "/b.webp", width: undefined, height: undefined, placeholderColor: null } }].map((p) => JSON.parse(JSON.stringify(p))));
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
    expect((await request(appFor()).get(`${mount}/avatar-presets`)).status).toBe(401);
  });

  test("an archived or deleted preset resolves to nothing and the stored choice is untouched", async () => {
    AvatarPreset.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([activeRow]) }) }); // the active list no longer has OTHER_ID
    const avatar = { presetId: OTHER_ID };
    expect(await avatarService.resolveAvatarPreset(avatar)).toBeNull();
    expect(avatar).toEqual({ presetId: OTHER_ID });
    expect(await avatarService.resolveAvatarPreset(undefined)).toBeNull();
    expect(await avatarService.resolveAvatarPreset({ presetId: ID })).toMatchObject({ id: ID, name: "Leaf" });
    expect(archivedRow.isActive).toBe(false);
  });
});
