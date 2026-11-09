jest.mock("../models/User", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock("../models/BannerTemplate", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const BannerTemplate = require("../models/BannerTemplate");
const service = require("../services/bannerTemplateService");
const { setTemplateCover } = require("../controllers/coverController");

const ID = "507f1f77bcf86cd799439011";
const appFor = (role = "jobseeker") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "me", role };
    next();
  });
  app.put("/cover", setTemplateCover);
  return app;
};
const mockUser = (extra = {}) => User.findById.mockReturnValue({ select: () => Promise.resolve({ role: "jobseeker", ...extra }) });
const mockTemplate = (tpl) => BannerTemplate.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(tpl) }) });

beforeEach(() => {
  jest.resetAllMocks();
  service.invalidateCache();
  BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
  User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({ cover: { kind: "template", templateId: ID } }) });
});

describe("PUT /auth/profile/cover", () => {
  test.each([
    ["an image key", { templateId: ID, image: { url: "https://evil.example/x.png" } }],
    ["a url key", { templateId: ID, url: "https://evil.example/x.png" }],
    ["only an image", { image: "x" }],
    ["a kind key", { templateId: ID, kind: "image" }],
    ["an empty body", {}],
    ["a numeric id", { templateId: 5 }],
    ["an object id", { templateId: { $ne: null } }],
  ])("rejects %s with COVER_ONLY_TEMPLATE_ALLOWED and writes nothing", async (_n, body) => {
    const res = await request(appFor()).put("/cover").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COVER_ONLY_TEMPLATE_ALLOWED");
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("an unknown template is 404", async () => {
    mockUser();
    mockTemplate(null);
    const res = await request(appFor()).put("/cover").send({ templateId: ID });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("COVER_TEMPLATE_NOT_FOUND");
  });

  test("a malformed id is 404, not a cast error", async () => {
    mockUser();
    const res = await request(appFor()).put("/cover").send({ templateId: "nope" });
    expect(res.status).toBe(404);
  });

  test("an archived template is 409 COVER_TEMPLATE_INACTIVE", async () => {
    mockUser();
    mockTemplate({ _id: ID, isActive: false, archivedAt: new Date() });
    const res = await request(appFor()).put("/cover").send({ templateId: ID });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COVER_TEMPLATE_INACTIVE");
  });

  test("an active template is saved as kind template and the resolved cover comes back", async () => {
    mockUser();
    mockTemplate({ _id: ID, isActive: true, archivedAt: null });
    BannerTemplate.find.mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve([{ _id: ID, slug: "a", name: "A", kind: "gradient", definition: {}, overlay: "dark", isDefault: false }]) }),
    });
    const res = await request(appFor()).put("/cover").send({ templateId: ID });
    expect(res.status).toBe(200);
    const update = User.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set["cover.kind"]).toBe("template");
    expect(String(update.$set["cover.templateId"])).toBe(ID);
    expect(res.body.cover.kind).toBe("template");
    expect(res.body.cover.template.slug).toBe("a");
  });

  test("null resets: the whole cover is unset for a jobseeker", async () => {
    mockUser();
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({}) });
    const res = await request(appFor()).put("/cover").send({ templateId: null });
    expect(res.status).toBe(200);
    expect(User.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $unset: { cover: 1 } });
    expect(res.body.cover).toEqual({ kind: "default" });
  });

  test("null reset keeps an employer's uploaded image data but stops showing it", async () => {
    mockUser({ role: "employer", cover: { image: { url: "u" } } });
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({ cover: { image: { url: "u" } } }) });
    await request(appFor("employer")).put("/cover").send({ templateId: null });
    expect(User.findByIdAndUpdate.mock.calls[0][1].$unset).toEqual({ "cover.kind": 1, "cover.templateId": 1 });
  });

  test("staff accounts have no banner", async () => {
    mockUser({ role: "admin" });
    const res = await request(appFor("admin")).put("/cover").send({ templateId: null });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("COVER_NOT_ALLOWED");
  });
});
