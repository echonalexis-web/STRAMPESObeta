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
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const BannerTemplate = require("../models/BannerTemplate");
const User = require("../models/User");
const service = require("../services/bannerTemplateService");
const controller = require("../controllers/bannerTemplateController");
const STARTERS = require("../data/bannerTemplateStarters");

const good = () => ({
  gradient: { angle: 160, stops: [{ color: "ds-green", at: 0 }, { color: "#0b704b", at: 100 }] },
  pattern: { type: "dots", color: "ds-gold", mixPercent: 55, size: 22, opacity: 0.55, fade: "left" },
});

describe("validateDefinition", () => {
  test("accepts a token and hex definition", () => {
    expect(service.validateDefinition(good()).ok).toBe(true);
  });
  test("the built-in classic and every starter validate", () => {
    expect(service.validateDefinition(service.CLASSIC_DEFINITION).ok).toBe(true);
    STARTERS.forEach((s) => expect(service.validateDefinition(s.definition).ok).toBe(true));
    expect(STARTERS.filter((s) => s.isDefault)).toHaveLength(1);
    expect(new Set(STARTERS.map((s) => s.slug)).size).toBe(STARTERS.length);
  });
  test.each([
    ["url() color", { ...good(), gradient: { angle: 0, stops: [{ color: "url(http://evil/x.png)", at: 0 }, { color: "ds-green", at: 100 }] } }],
    ["raw css color", { ...good(), gradient: { angle: 0, stops: [{ color: "red; background: url(x)", at: 0 }, { color: "ds-green", at: 100 }] } }],
    ["unknown token", { ...good(), gradient: { angle: 0, stops: [{ color: "ds-nope", at: 0 }, { color: "ds-green", at: 100 }] } }],
    ["angle out of range", { ...good(), gradient: { angle: 400, stops: good().gradient.stops } }],
    ["one stop", { ...good(), gradient: { angle: 0, stops: [{ color: "ds-green", at: 0 }] } }],
    ["five stops", { ...good(), gradient: { angle: 0, stops: Array.from({ length: 5 }, (_, i) => ({ color: "ds-green", at: i * 10 })) } }],
    ["bad pattern type", { ...good(), pattern: { ...good().pattern, type: "image" } }],
    ["opacity out of range", { ...good(), pattern: { ...good().pattern, opacity: 2 } }],
    ["unknown key", { ...good(), background: "url(x)" }],
    ["not an object", "x"],
    ["array", []],
    ["missing gradient", { pattern: good().pattern }],
  ])("rejects %s", (_n, def) => {
    expect(service.validateDefinition(def).ok).toBe(false);
  });
  test("drops unknown nested keys instead of storing them", () => {
    const input = good();
    input.gradient.stops[0].extra = "url(x)";
    const out = service.validateDefinition(input);
    expect(JSON.stringify(out.definition)).not.toContain("extra");
  });
});

describe("resolveCover", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    service.invalidateCache();
  });
  const rows = [
    { _id: "t1", slug: "a", name: "A", kind: "gradient", definition: good(), overlay: "dark", isDefault: true },
    { _id: "t2", slug: "b", name: "B", kind: "gradient", definition: good(), overlay: "light" },
  ];
  const mockActive = (list) => BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(list) }) });

  test("no cover means default, without a database read", async () => {
    expect(await service.resolveCover(undefined)).toEqual({ kind: "default" });
    expect(BannerTemplate.find).not.toHaveBeenCalled();
  });
  test("active template resolves", async () => {
    mockActive(rows);
    const out = await service.resolveCover({ kind: "template", templateId: "t2" });
    expect(out.kind).toBe("template");
    expect(out.template.slug).toBe("b");
  });
  test("missing or archived template falls back to the default template", async () => {
    mockActive(rows);
    const out = await service.resolveCover({ kind: "template", templateId: "gone" });
    expect(out.template.id).toBe("t1");
  });
  test("with no templates at all it falls back to the built-in default", async () => {
    mockActive([]);
    expect(await service.resolveCover({ kind: "template", templateId: "gone" })).toEqual({ kind: "default" });
  });
  test("image never exposes stored values and removed images fall back", async () => {
    const image = { url: "u", thumbUrl: "t", storedValue: "SECRET", thumbStoredValue: "SECRET2", width: 1600, height: 400, status: "published" };
    const out = await service.resolveCover({ kind: "image", image });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    mockActive([]);
    expect(await service.resolveCover({ kind: "image", image: { ...image, status: "removed_by_staff" } })).toEqual({ kind: "default" });
  });
  test("the active list is cached", async () => {
    mockActive(rows);
    await service.resolveCover({ kind: "template", templateId: "t1" });
    await service.resolveCover({ kind: "template", templateId: "t2" });
    expect(BannerTemplate.find).toHaveBeenCalledTimes(1);
  });
});

describe("superadmin controller", () => {
  const appFor = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: "sa", role: "superadmin" };
      next();
    });
    app.post("/", controller.create);
    app.put("/order", controller.reorder);
    app.put("/:id", controller.update);
    app.patch("/:id/active", controller.setActive);
    app.patch("/:id/default", controller.setDefault);
    app.delete("/:id", controller.remove);
    return app;
  };
  const doc = (extra = {}) => {
    const d = { _id: "507f1f77bcf86cd799439011", slug: "x", name: "X", kind: "gradient", definition: good(), overlay: "dark", isActive: true, isDefault: false, save: jest.fn().mockResolvedValue(undefined), ...extra };
    d.toObject = () => ({ ...d });
    return d;
  };
  beforeEach(() => {
    jest.resetAllMocks();
    service.invalidateCache();
    User.aggregate.mockResolvedValue([]);
  });

  test("create rejects an invalid definition with TEMPLATE_DEFINITION_INVALID", async () => {
    const res = await request(appFor()).post("/").send({ name: "Bad", kind: "gradient", definition: { gradient: { angle: 0, stops: [{ color: "url(x)", at: 0 }, { color: "ds-green", at: 1 }] } } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TEMPLATE_DEFINITION_INVALID");
    expect(BannerTemplate.create).not.toHaveBeenCalled();
  });
  test("create with a taken name gives TEMPLATE_NAME_TAKEN", async () => {
    BannerTemplate.exists.mockResolvedValue({ _id: "x" });
    const res = await request(appFor()).post("/").send({ name: "Gold dots", kind: "pattern", definition: good() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEMPLATE_NAME_TAKEN");
  });
  test("create stores only the validated definition", async () => {
    BannerTemplate.exists.mockResolvedValue(null);
    BannerTemplate.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve({ sortOrder: 3 }) }) }) });
    BannerTemplate.create.mockImplementation(async (d) => ({ ...d, _id: "n1", toObject() { return { ...d, _id: "n1" }; } }));
    const res = await request(appFor()).post("/").send({ name: "Fresh", kind: "pattern", definition: { ...good(), evil: "url(x)" } });
    expect(res.status).toBe(400); // unknown key rejected
    const ok = await request(appFor()).post("/").send({ name: "Fresh", kind: "pattern", definition: good() });
    expect(ok.status).toBe(201);
    expect(BannerTemplate.create.mock.calls[0][0].sortOrder).toBe(4);
    expect(BannerTemplate.create.mock.calls[0][0].slug).toBe("fresh");
  });
  test("the default cannot be archived or deleted", async () => {
    BannerTemplate.findById.mockResolvedValue(doc({ isDefault: true }));
    const a = await request(appFor()).patch("/507f1f77bcf86cd799439011/active").send({ isActive: false });
    expect(a.body.code).toBe("TEMPLATE_IS_DEFAULT");
    const d = await request(appFor()).delete("/507f1f77bcf86cd799439011");
    expect(d.body.code).toBe("TEMPLATE_IS_DEFAULT");
  });
  test("delete with usage answers TEMPLATE_IN_USE", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    User.aggregate.mockResolvedValue([{ _id: "507f1f77bcf86cd799439011", n: 4 }]);
    const res = await request(appFor()).delete("/507f1f77bcf86cd799439011");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEMPLATE_IN_USE");
    expect(BannerTemplate.deleteOne).not.toHaveBeenCalled();
  });
  test("delete at zero usage works", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    BannerTemplate.deleteOne.mockResolvedValue({});
    const res = await request(appFor()).delete("/507f1f77bcf86cd799439011");
    expect(res.status).toBe(200);
  });
  test("an archived template cannot become the default", async () => {
    BannerTemplate.findById.mockResolvedValue(doc({ isActive: false }));
    const res = await request(appFor()).patch("/507f1f77bcf86cd799439011/default");
    expect(res.body.code).toBe("COVER_TEMPLATE_INACTIVE");
  });
  test("set default clears the previous default first", async () => {
    BannerTemplate.findById.mockResolvedValue(doc());
    BannerTemplate.updateMany.mockResolvedValue({});
    const res = await request(appFor()).patch("/507f1f77bcf86cd799439011/default");
    expect(res.status).toBe(200);
    expect(BannerTemplate.updateMany).toHaveBeenCalledWith({ isDefault: true }, { $set: { isDefault: false } });
  });
  test("reorder must list every template once", async () => {
    BannerTemplate.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: "507f1f77bcf86cd799439011" }, { _id: "507f1f77bcf86cd799439012" }]) }) });
    const bad = await request(appFor()).put("/order").send({ ids: ["507f1f77bcf86cd799439011"] });
    expect(bad.body.code).toBe("TEMPLATE_ORDER_INVALID");
    const dup = await request(appFor()).put("/order").send({ ids: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011"] });
    expect(dup.body.code).toBe("TEMPLATE_ORDER_INVALID");
    BannerTemplate.bulkWrite.mockResolvedValue({});
    const ok = await request(appFor()).put("/order").send({ ids: ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439011"] });
    expect(ok.status).toBe(200);
  });
});
