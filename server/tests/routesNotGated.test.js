// rev 3: nothing is gated on a verified email. Where the new guards and budgets
// sit in each real route chain, that SPES / likes / follows / reports / news stay
// open, and that the add-email routes are unreachable while the flag is off.
// Real routers, spied models, no database.

jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");
const guards = require("../middleware/applyGuards");
const budgets = require("../middleware/budgets");

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
const find = (router, method, p) => {
  const hit = routeChains(router).find((r) => r.method === method && r.path === p);
  if (!hit) throw new Error(`route not found: ${method} ${p}`);
  return hit.handles;
};

const ALL_BUDGETS = [
  budgets.conversationBudget,
  budgets.uploadBudget,
  budgets.uploadBudgetForFiles,
  budgets.backupCodesBudget,
  guards.requireApplyPhone,
  guards.requireApplyBudget,
];

describe("the email gate is gone", () => {
  test("the module no longer exists", () => {
    expect(() => require("../middleware/requireVerifiedEmail")).toThrow(/Cannot find module/);
  });

  test("no source file mentions it or EMAIL_REQUIRED", () => {
    const root = path.join(__dirname, "..");
    const hits = [];
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "tests", "coverage", "uploads", "scripts", "assets"].includes(entry.name)) continue;
          scan(full);
        } else if (entry.name.endsWith(".js")) {
          const text = fs.readFileSync(full, "utf8");
          if (/requireVerifiedEmail|EMAIL_REQUIRED/.test(text)) hits.push(path.relative(root, full));
        }
      }
    };
    scan(root);
    expect(hits).toEqual([]);
  });

  test("verifyToken and optionalAuth no longer load email or isEmailVerified", async () => {
    const select = jest.fn().mockResolvedValue({ isActive: true, role: "jobseeker", tokenVersion: 0 });
    jest.spyOn(User, "findById").mockReturnValue({ select });
    const token = jwt.sign({ id: "507f1f77bcf86cd799439011", role: "jobseeker", tokenVersion: 0 }, process.env.JWT_SECRET);
    for (const name of ["verifyToken", "optionalAuth"]) {
      const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: "/x", path: "/x", method: "GET" };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      await auth[name](req, res, jest.fn());
      expect(select.mock.calls.at(-1)[0]).not.toMatch(/\bemail\b|isEmailVerified/);
    }
    jest.restoreAllMocks();
  });
});

describe("where the guards and budgets sit in the real routes", () => {
  const jobRoutes = require("../routes/jobRoutes");
  const messageRoutes = require("../routes/messageRoutes");
  const docRoutes = require("../routes/jobseekerDocumentRoutes");
  const authRoutes = require("../routes/authRoutes");
  const userRoutes = require("../routes/userRoutes");

  test("job apply: age gate, then phone, then the daily cap, all before any file is read", () => {
    const handles = find(jobRoutes, "post", "/:id/apply");
    const age = handles.indexOf(auth.requireJobApplyAge);
    const phone = handles.indexOf(guards.requireApplyPhone);
    const cap = handles.indexOf(guards.requireApplyBudget);
    const cleanup = handles.map((h) => h.name).indexOf("cleanupUploadedFiles");
    expect(age).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(age);
    expect(cap).toBeGreaterThan(phone);
    expect(cleanup).toBeGreaterThan(cap);
  });

  test("updating an application is not a new application: no phone check, no cap", () => {
    const handles = find(jobRoutes, "put", "/applications/:id");
    expect(handles).not.toContain(guards.requireApplyPhone);
    expect(handles).not.toContain(guards.requireApplyBudget);
    expect(handles).toContain(auth.requireJobApplyAge);
  });

  test("messaging: a light cap on starting conversations; sending and reading are not capped", () => {
    expect(find(messageRoutes, "post", "/conversations")).toContain(budgets.conversationBudget);
    for (const [method, p] of [
      ["post", "/conversations/:conversationId/messages"],
      ["get", "/conversations"],
      ["get", "/conversations/:conversationId/messages"],
    ]) {
      const handles = find(messageRoutes, method, p);
      for (const b of ALL_BUDGETS) expect(handles).not.toContain(b);
    }
  });

  test("general document upload: capped before the file is read", () => {
    const handles = find(docRoutes, "post", "/upload");
    const idx = handles.indexOf(budgets.uploadBudget);
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(handles.length - 1);
  });

  test("profile files, avatar and legacy uploads are capped; text-only updates are not", () => {
    for (const [method, p] of [
      ["put", "/profile"],
      ["patch", "/me"],
    ]) {
      const handles = find(authRoutes, method, p);
      const idx = handles.indexOf(budgets.uploadBudgetForFiles);
      expect(idx).toBeGreaterThan(handles.map((h) => h.name).indexOf("cleanupUploadedFiles"));
    }
    expect(find(authRoutes, "patch", "/profile/avatar")).toContain(budgets.uploadBudget);
    expect(find(userRoutes, "post", "/upload-profile-image")).toContain(budgets.uploadBudget);
    expect(find(userRoutes, "post", "/upload-resume")).toContain(budgets.uploadBudget);
    const textOnly = find(userRoutes, "put", "/profile");
    for (const b of ALL_BUDGETS) expect(textOnly).not.toContain(b);
  });

  test.each([["spesRoutes"], ["jobLikeRoutes"], ["followRoutes"], ["reportRoutes"], ["newsRoutes"]])(
    "%s has none of the new guards or budgets (SPES, likes, follows, reports and news stay open)",
    (name) => {
      const router = require(`../routes/${name}`);
      for (const { handles } of routeChains(router)) {
        for (const b of ALL_BUDGETS) expect(handles).not.toContain(b);
      }
    }
  );
});

describe("flag OFF: the add-email routes are not reachable", () => {
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
    for (const p of ["/email/add/request", "/email/add/verify"]) {
      const res = await request(buildApp()).post(`${base}${p}`).set("Authorization", bearer).send({ email: "a@b.co", code: "123456" });
      expect(res.status).toBe(404);
    }
    expect(findById).not.toHaveBeenCalled();
  });

  test.each([["/api/auth"], ["/api/v1/auth"]])("%s: username-mode register is refused before anything runs", async (base) => {
    const res = await request(buildApp())
      .post(`${base}/register`)
      .send({ signupMode: "username", username: "juan_dc", password: "Zq7!mNvKwpL", name: "Juan", dateOfBirth: "2000-01-01" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SIGNUP_DISABLED");
  });
});
