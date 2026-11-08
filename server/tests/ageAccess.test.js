// Age enforcement matrix: who may view jobs, apply to regular jobs, and apply
// to SPES, by age tier, plus the middleware and the 15-17 messaging limit.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/Conversation", () => ({ findById: jest.fn() }));
jest.mock("../models/Message", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const { getAgeDenial } = require("../utils/ageAccess");
const { requireJobViewAge, requireJobApplyAge, requireSpesAge } = require("../middleware/auth");
const messageController = require("../controllers/messageController");

const NOW = new Date("2026-11-08T04:00:00.000Z");
const user = (birth, extra = {}) => ({
  role: "jobseeker",
  dateOfBirth: birth ? new Date(`${birth}T00:00:00.000Z`) : null,
  ...extra,
});

// born -> tier on NOW
const TIERS_BY_DOB = {
  under15: "2011-11-09",
  minor15: "2011-11-08",
  minor17: "2008-11-09",
  adult18: "2008-11-08",
  adult30: "1996-11-08",
  senior31: "1995-11-08",
};

describe("getAgeDenial matrix (jobseeker roles)", () => {
  test.each([
    // [who, jobView, jobApply, spesApply]
    ["under15", "AGE_UNDER_MINIMUM", "AGE_UNDER_MINIMUM", "AGE_UNDER_MINIMUM"],
    ["minor15", null, "JOB_APPLY_AGE_RESTRICTED", null],
    ["minor17", null, "JOB_APPLY_AGE_RESTRICTED", null],
    ["adult18", null, null, null],
    ["adult30", null, null, null],
    ["senior31", null, null, "SPES_AGE_ABOVE_MAX"],
  ])("%s", (who, view, apply, spes) => {
    const u = user(TIERS_BY_DOB[who]);
    expect(getAgeDenial(u, "jobView", NOW)).toBe(view);
    expect(getAgeDenial(u, "jobApply", NOW)).toBe(apply);
    expect(getAgeDenial(u, "spesApply", NOW)).toBe(spes);
  });

  test("no date of birth fails closed everywhere with DOB_REQUIRED", () => {
    const u = user(null);
    ["jobView", "jobApply", "spesApply"].forEach((a) => expect(getAgeDenial(u, a, NOW)).toBe("DOB_REQUIRED"));
  });

  test("an account flagged for age review is treated as under the minimum age", () => {
    const u = user(TIERS_BY_DOB.adult30, { ageReviewRequired: true });
    ["jobView", "jobApply", "spesApply"].forEach((a) => expect(getAgeDenial(u, a, NOW)).toBe("AGE_UNDER_MINIMUM"));
  });

  test("employers, admins and guests are never subject to age rules", () => {
    ["employer", "admin", "superadmin"].forEach((role) =>
      expect(getAgeDenial({ role, dateOfBirth: null }, "jobApply", NOW)).toBeNull()
    );
    expect(getAgeDenial(null, "jobApply", NOW)).toBeNull();
  });

  test("legacy role names (employee, resident) are jobseekers too", () => {
    expect(getAgeDenial({ role: "resident", dateOfBirth: null }, "jobView", NOW)).toBe("DOB_REQUIRED");
  });
});

describe("middleware recomputes the age on every request (real clock)", () => {
  const appWith = (mw, reqUser) => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = reqUser;
      next();
    });
    app.get("/t", mw, (_req, res) => res.json({ ok: true }));
    return app;
  };
  const yearsAgo = (n, dayOffset = 0) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };

  test("job apply: 16-year-old blocked with a stable code, 19-year-old allowed", async () => {
    const blocked = await request(appWith(requireJobApplyAge, { role: "jobseeker", dateOfBirth: yearsAgo(16, -30) })).get("/t");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("JOB_APPLY_AGE_RESTRICTED");
    expect(blocked.body.legacyCode).toBe("AGE_RESTRICTED");

    const ok = await request(appWith(requireJobApplyAge, { role: "jobseeker", dateOfBirth: yearsAgo(19) })).get("/t");
    expect(ok.status).toBe(200);
  });

  test("job view allows a 16-year-old but blocks a missing date of birth", async () => {
    const ok = await request(appWith(requireJobViewAge, { role: "jobseeker", dateOfBirth: yearsAgo(16, -30) })).get("/t");
    expect(ok.status).toBe(200);
    const blocked = await request(appWith(requireJobViewAge, { role: "jobseeker", dateOfBirth: null })).get("/t");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("DOB_REQUIRED");
  });

  test("SPES: 40-year-old blocked, 22-year-old allowed", async () => {
    const blocked = await request(appWith(requireSpesAge, { role: "jobseeker", dateOfBirth: yearsAgo(40) })).get("/t");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("SPES_AGE_ABOVE_MAX");
    const ok = await request(appWith(requireSpesAge, { role: "jobseeker", dateOfBirth: yearsAgo(22) })).get("/t");
    expect(ok.status).toBe(200);
  });
});

describe("15-17 accounts cannot start conversations", () => {
  const build = (currentUser, targetUser) => {
    User.findById.mockImplementation((id) => ({
      select: jest.fn().mockResolvedValue(id === "me" ? currentUser : targetUser),
    }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: "me", role: currentUser.role };
      next();
    });
    app.post("/c", messageController.createConversation || messageController.startConversation);
    return app;
  };
  const yearsAgo = (n, dayOffset = 0) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };

  test("a 16-year-old messaging an employer is refused with MESSAGING_AGE_RESTRICTED", async () => {
    const app = build(
      { role: "jobseeker", isActive: true, dateOfBirth: yearsAgo(16, -30) },
      { role: "employer", isActive: true, name: "Acme" }
    );
    const res = await request(app).post("/c").send({ participantId: "other" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MESSAGING_AGE_RESTRICTED");
  });

  test("an under-15 or unknown-DOB account is refused by the same age check", async () => {
    const app = build(
      { role: "jobseeker", isActive: true, dateOfBirth: null },
      { role: "employer", isActive: true, name: "Acme" }
    );
    const res = await request(app).post("/c").send({ participantId: "other" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DOB_REQUIRED");
  });
});

describe("viewing SPES postings (spesView): 15 and older, 31+ read-only", () => {
  test.each([
    ["under15", "AGE_UNDER_MINIMUM"],
    ["minor15", null],
    ["minor17", null],
    ["adult18", null],
    ["adult30", null],
    ["senior31", null], // may view; apply is denied separately (SPES_AGE_ABOVE_MAX)
  ])("%s", (who, view) => {
    expect(getAgeDenial(user(TIERS_BY_DOB[who]), "spesView", NOW)).toBe(view);
  });

  test("no date of birth -> DOB_REQUIRED; an age-review account is blocked", () => {
    expect(getAgeDenial(user(null), "spesView", NOW)).toBe("DOB_REQUIRED");
    expect(getAgeDenial(user(TIERS_BY_DOB.adult30, { ageReviewRequired: true }), "spesView", NOW)).toBe("AGE_UNDER_MINIMUM");
  });

  test("a 31-year-old may view postings but not apply", () => {
    const u = user(TIERS_BY_DOB.senior31);
    expect(getAgeDenial(u, "spesView", NOW)).toBeNull();
    expect(getAgeDenial(u, "spesApply", NOW)).toBe("SPES_AGE_ABOVE_MAX");
  });
});
