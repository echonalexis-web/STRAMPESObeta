// requireVerifiedEmail: the middleware, where it sits in each real route chain,
// that SPES / likes / follows / reports are NOT gated, the auth select, and the
// flag-off proof for the new routes. Real routers, spied models, no database.

jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { requireVerifiedEmail, requireVerifiedEmailForFiles } = require("../middleware/requireVerifiedEmail");
const { getManilaToday } = require("../utils/age");

const routeChains = (router) => {
  const out = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ method, path: layer.route.path, handles: layer.route.stack.map((l) => l.handle) });
    }
  }
  return out;
};
const find = (router, method, path) => {
  const hit = routeChains(router).find((r) => r.method === method && r.path === path);
  if (!hit) throw new Error(`route not found: ${method} ${path}`);
  return hit.handles;
};

describe("middleware", () => {
  const run = (mw, req) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    mw(req, res, next);
    return { res, next };
  };

  test.each([
    ["legacy account: email present, isEmailVerified undefined", { role: "jobseeker", email: "a@b.co" }],
    ["verified", { role: "jobseeker", email: "a@b.co", isEmailVerified: true }],
    ["employer without an email field loaded", { role: "employer" }],
    ["admin", { role: "admin" }],
    ["superadmin", { role: "superadmin" }],
  ])("passes: %s", (_, user) => {
    const { next, res } = run(requireVerifiedEmail, { user });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each([
    ["email-less username account", { role: "jobseeker" }],
    ["empty email", { role: "jobseeker", email: "" }],
    ["unverified email", { role: "jobseeker", email: "a@b.co", isEmailVerified: false }],
    ["legacy role employee", { role: "employee" }],
  ])("403 EMAIL_REQUIRED: %s", (_, user) => {
    const { next, res } = run(requireVerifiedEmail, { user });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe("EMAIL_REQUIRED");
  });

  test("files-only variant: text-only updates pass, any file is gated", () => {
    const noEmail = { role: "jobseeker" };
    expect(run(requireVerifiedEmailForFiles, { user: noEmail, files: {} }).next).toHaveBeenCalled();
    expect(run(requireVerifiedEmailForFiles, { user: noEmail, files: { resumeFile: [] } }).next).toHaveBeenCalled();
    expect(run(requireVerifiedEmailForFiles, { user: noEmail }).next).toHaveBeenCalled();
    expect(run(requireVerifiedEmailForFiles, { user: noEmail, files: { resumeFile: [{}] } }).next).not.toHaveBeenCalled();
    expect(run(requireVerifiedEmailForFiles, { user: noEmail, file: {} }).next).not.toHaveBeenCalled();
    expect(run(requireVerifiedEmailForFiles, { user: { role: "jobseeker", email: "a@b.co" }, file: {} }).next).toHaveBeenCalled();
  });

  test("the age error still wins over the email error (gate order: age first)", async () => {
    const age = (years) => ({ role: "jobseeker", dateOfBirth: new Date(Date.UTC(getManilaToday().year - years, 0, 1)) });
    const app = express();
    app.use((req, res, next) => {
      req.user = JSON.parse(req.headers["x-user"]);
      if (req.user.dateOfBirth) req.user.dateOfBirth = new Date(req.user.dateOfBirth);
      next();
    });
    app.post("/apply", auth.requireJobApplyAge, requireVerifiedEmail, (req, res) => res.json({ ok: true }));
    const post = (u) => request(app).post("/apply").set("x-user", JSON.stringify(u));

    const teen = await post(age(16)); // 15-17: cannot apply to jobs, no email either
    expect(teen.status).toBe(403);
    expect(teen.body.code).toBe("JOB_APPLY_AGE_RESTRICTED");

    const adultNoEmail = await post(age(25));
    expect(adultNoEmail.body.code).toBe("EMAIL_REQUIRED");

    const adultVerified = await post({ ...age(25), email: "a@b.co", isEmailVerified: true });
    expect(adultVerified.status).toBe(200);

    const adultLegacy = await post({ ...age(25), email: "a@b.co" });
    expect(adultLegacy.status).toBe(200);
  });
});

describe("verifyToken / optionalAuth load what the gate needs", () => {
  const stubUser = (doc) => {
    const select = jest.fn().mockResolvedValue(doc);
    jest.spyOn(User, "findById").mockReturnValue({ select });
    return select;
  };
  afterEach(() => jest.restoreAllMocks());

  const token = () => jwt.sign({ id: "507f1f77bcf86cd799439011", role: "jobseeker", tokenVersion: 0 }, process.env.JWT_SECRET);
  const call = async (mw) => {
    const req = { headers: { authorization: `Bearer ${token()}` }, originalUrl: "/x", path: "/x", method: "GET" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await mw(req, res, next);
    return { req, res, next };
  };

  test.each([["verifyToken"], ["optionalAuth"]])("%s selects email and isEmailVerified and exposes them", async (name) => {
    const select = stubUser({
      isActive: true,
      role: "jobseeker",
      tokenVersion: 0,
      email: "a@b.co",
      isEmailVerified: true,
    });
    const { req, next } = await call(auth[name]);
    expect(select.mock.calls[0][0]).toMatch(/\bemail\b/);
    expect(select.mock.calls[0][0]).toMatch(/\bisEmailVerified\b/);
    expect(next).toHaveBeenCalled();
    expect(req.user.email).toBe("a@b.co");
    expect(req.user.isEmailVerified).toBe(true);
  });

  test("an email-less user comes through with no email", async () => {
    stubUser({ isActive: true, role: "jobseeker", tokenVersion: 0 });
    const { req } = await call(auth.verifyToken);
    expect(req.user.email).toBeUndefined();
  });
});

describe("where the gate sits in the real routes", () => {
  const jobRoutes = require("../routes/jobRoutes");
  const messageRoutes = require("../routes/messageRoutes");
  const docRoutes = require("../routes/jobseekerDocumentRoutes");
  const authRoutes = require("../routes/authRoutes");
  const userRoutes = require("../routes/userRoutes");

  const gateIndex = (handles) => handles.indexOf(requireVerifiedEmail);

  test("job apply and application update: after the age gate", () => {
    for (const [method, path] of [
      ["post", "/:id/apply"],
      ["put", "/applications/:id"],
    ]) {
      const handles = find(jobRoutes, method, path);
      expect(gateIndex(handles)).toBeGreaterThan(-1);
      expect(gateIndex(handles)).toBeGreaterThan(handles.indexOf(auth.requireJobApplyAge));
      expect(handles.indexOf(auth.requireJobApplyAge)).toBeGreaterThan(-1);
    }
  });

  test("messaging: starting a conversation and sending a message are gated; reading is not", () => {
    expect(gateIndex(find(messageRoutes, "post", "/conversations"))).toBeGreaterThan(-1);
    expect(gateIndex(find(messageRoutes, "post", "/conversations/:conversationId/messages"))).toBeGreaterThan(-1);
    expect(gateIndex(find(messageRoutes, "get", "/conversations"))).toBe(-1);
    expect(gateIndex(find(messageRoutes, "get", "/conversations/:conversationId/messages"))).toBe(-1);
  });

  test("general document upload: gated, before the file is read", () => {
    const handles = find(docRoutes, "post", "/upload");
    expect(gateIndex(handles)).toBeGreaterThan(-1);
    expect(gateIndex(handles)).toBeLessThan(handles.length - 1);
  });

  test("profile files, avatar and legacy uploads are gated; text updates are not", () => {
    expect(find(authRoutes, "put", "/profile")).toContain(requireVerifiedEmailForFiles);
    expect(find(authRoutes, "patch", "/me")).toContain(requireVerifiedEmailForFiles);
    expect(gateIndex(find(authRoutes, "patch", "/profile/avatar"))).toBeGreaterThan(-1);
    expect(gateIndex(find(userRoutes, "post", "/upload-profile-image"))).toBeGreaterThan(-1);
    expect(gateIndex(find(userRoutes, "post", "/upload-resume"))).toBeGreaterThan(-1);
    // text-only profile update on the legacy router stays open
    expect(gateIndex(find(userRoutes, "put", "/profile"))).toBe(-1);
  });

  test("the profile-file gate runs after multer and before anything is stored", () => {
    const handles = find(authRoutes, "put", "/profile");
    const idx = handles.indexOf(requireVerifiedEmailForFiles);
    const names = handles.map((h) => h.name);
    const cleanup = names.indexOf("cleanupUploadedFiles");
    expect(cleanup).toBeGreaterThan(-1);
    expect(idx).toBe(cleanup + 1); // right after multer + cleanup
    expect(idx).toBeLessThan(handles.length - 2); // persistFields and the handler still come after it
  });

  test.each([
    ["spesRoutes"],
    ["jobLikeRoutes"],
    ["followRoutes"],
    ["reportRoutes"],
    ["newsRoutes"],
  ])("%s has no email gate at all (SPES, likes, follows, reports and news stay open)", (name) => {
    let router;
    try {
      router = require(`../routes/${name}`);
    } catch {
      return; // route file not present in this checkout
    }
    for (const { handles } of routeChains(router)) {
      expect(handles).not.toContain(requireVerifiedEmail);
      expect(handles).not.toContain(requireVerifiedEmailForFiles);
    }
  });
});

describe("flag OFF: the new routes are not reachable", () => {
  const authRoutes = require("../routes/authRoutes");
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/v1/auth", authRoutes);
    return app;
  };

  let findById;
  beforeEach(() => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    findById = jest.spyOn(User, "findById");
  });
  afterEach(() => {
    delete process.env.USERNAME_SIGNUP_ENABLED;
    jest.restoreAllMocks();
  });

  test.each([["/api/auth"], ["/api/v1/auth"]])("%s: add-email routes are a plain 404 and touch nothing", async (base) => {
    const bearer = `Bearer ${jwt.sign({ id: "507f1f77bcf86cd799439011", role: "jobseeker", tokenVersion: 0 }, process.env.JWT_SECRET)}`;
    for (const path of ["/email/add/request", "/email/add/verify"]) {
      const res = await request(buildApp()).post(`${base}${path}`).set("Authorization", bearer).send({ email: "a@b.co", code: "123456" });
      expect(res.status).toBe(404);
    }
    expect(findById).not.toHaveBeenCalled();
  });

  test.each([["/api/auth"], ["/api/v1/auth"]])("%s: username-mode register is refused before anything runs", async (base) => {
    const res = await request(buildApp())
      .post(`${base}/register`)
      .send({ signupMode: "username", username: "juan_dc", password: "Sup3rSecret!", name: "Juan", dateOfBirth: "2000-01-01" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SIGNUP_DISABLED");
  });

  test("flag ON: the add-email routes exist and demand a session", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "true";
    const res = await request(buildApp()).post("/api/auth/email/add/request").send({});
    expect(res.status).toBe(401);
  });
});
