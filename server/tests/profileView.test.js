// GET /profiles/:id/summary and /profiles/:id: viewer by target matrix, the single
// PROFILE_UNAVAILABLE answer, minors, hidden profiles, cache headers.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../models/ContactShare", () => ({ find: jest.fn() }));
jest.mock("../models/BannerTemplate", () => ({ find: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Follow = require("../models/Follow");
const ContactShare = require("../models/ContactShare");
const BannerTemplate = require("../models/BannerTemplate");
const bannerService = require("../services/bannerTemplateService");
const { getSummary, getProfile } = require("../controllers/profileViewController");

const ID = "507f1f77bcf86cd799439011";
const adult = new Date("1995-01-01T00:00:00.000Z");
const minor = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000);

const seeker = (extra = {}) => ({
  _id: ID,
  role: "jobseeker",
  name: "Ana Cruz",
  email: "ana@x.com",
  phone: "0917",
  dateOfBirth: adult,
  profileImage: "/uploads/profiles/a.webp",
  desiredJobTitle: "Welder",
  skills: ["welding"],
  governmentIdNumber: "SECRET-ID",
  loginLock: { n: 1 },
  privacy: { profileVisibility: "public" },
  isActive: true,
  toObject() {
    const { toObject, ...rest } = this;
    return rest;
  },
  ...extra,
});
const seekerProfile = () => ({
  tin: "111",
  presentAddress: { street: "12 Rizal", municipality: "Boac", province: "Marinduque" },
  course: "BSIT",
  toObject() {
    const { toObject, ...rest } = this;
    return rest;
  },
});
const employer = (extra = {}) => ({
  _id: ID,
  role: "employer",
  name: "Acme",
  companyName: "Acme Corp",
  industry: "Retail",
  email: "hr@acme.com",
  phone: "0917",
  profileImage: "/logo.png",
  verificationStatus: "verified",
  isActive: true,
  loginLock: { n: 1 },
  toObject() {
    const { toObject, ...rest } = this;
    return rest;
  },
  ...extra,
});

const appFor = (user) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get("/:id/summary", getSummary);
  app.get("/:id", getProfile);
  return app;
};

const wire = ({ target, profile = null, applied = false, follows = false }) => {
  User.findById.mockResolvedValue(target);
  JobseekerProfile.findOne.mockResolvedValue(profile);
  EmployerProfile.findOne.mockResolvedValue(profile);
  const chain = (v) => ({ select: () => ({ lean: () => Promise.resolve(v) }), distinct: () => Promise.resolve(v) });
  JobVacancy.find.mockReturnValue(chain(["j1"]));
  JobApplication.find.mockReturnValue(chain(applied ? [{ includePhoto: false }] : []));
  ContactShare.find.mockReturnValue(chain([]));
  Follow.exists.mockResolvedValue(follows ? { _id: "f" } : null);
};

const EMP = { id: "emp1", role: "employer" };
const SEEKER2 = { id: "other", role: "jobseeker" };
const ADMIN = { id: "adm", role: "admin" };
const OWNER = { id: ID, role: "jobseeker" };

beforeEach(() => {
  jest.resetAllMocks();
  bannerService.invalidateCache();
  BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
});

describe("unavailable is one answer", () => {
  const expectUnavailable = (res) => {
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "PROFILE_UNAVAILABLE", message: "This profile is unavailable." });
  };

  test.each([
    ["missing", () => User.findById.mockResolvedValue(null)],
    ["inactive", () => wire({ target: seeker({ isActive: false }) })],
    ["suspended", () => wire({ target: seeker({ accountStatus: "suspended" }) })],
    ["hidden, no application", () => wire({ target: seeker({ privacy: { profileVisibility: "hidden" } }) })],
    ["a minor", () => wire({ target: seeker({ dateOfBirth: minor }) })],
    ["a staff account", () => wire({ target: seeker({ role: "admin" }) })],
  ])("%s: identical body for an employer", async (_n, setup) => {
    setup();
    expectUnavailable(await request(appFor(EMP)).get(`/${ID}`));
    setup();
    expectUnavailable(await request(appFor(EMP)).get(`/${ID}/summary`));
  });

  test("a malformed id is the same answer", async () => {
    expectUnavailable(await request(appFor(EMP)).get("/not-an-id"));
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("peers cannot see an employers-only profile", async () => {
    wire({ target: seeker({ privacy: { profileVisibility: "employers" } }) });
    expectUnavailable(await request(appFor(SEEKER2)).get(`/${ID}`));
    wire({ target: seeker({ privacy: { profileVisibility: "employers" } }) });
    const res = await request(appFor(EMP)).get(`/${ID}`);
    expect(res.status).toBe(200);
  });
});

describe("jobseeker target", () => {
  test("employer with no relationship: hiring view, no contact, no forbidden keys", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const res = await request(appFor(EMP)).get(`/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("hiring");
    const json = JSON.stringify(res.body);
    ["email", "phone", "governmentIdNumber", "SECRET-ID", "loginLock", "dateOfBirth", "\"tin\"", "Rizal"].forEach((k) => expect(json).not.toContain(k));
    expect(res.body.user.skills).toEqual(["welding"]);
    expect(res.body.user.address).toBe("Boac, Marinduque");
    expect(res.body.contactShared).toBe(false);
  });

  test("employer with an active application gets contact", async () => {
    wire({ target: seeker(), profile: seekerProfile(), applied: true });
    const res = await request(appFor(EMP)).get(`/${ID}`);
    expect(res.body.user.phone).toBe("0917");
    expect(res.body.user.email).toBe("ana@x.com");
    expect(res.body.contactShared).toBe(true);
  });

  test("hidden profile with an application: name and contact only, no avatar and no cover", async () => {
    wire({ target: seeker({ privacy: { profileVisibility: "hidden" } }), profile: seekerProfile(), applied: true });
    const res = await request(appFor(EMP)).get(`/${ID}`);
    expect(res.body.mode).toBe("applicationOnly");
    expect(Object.keys(res.body.user).sort()).toEqual(["_id", "email", "name", "phone", "role"]);
  });

  test("another jobseeker sees a short card: no contact, no hiring details", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const res = await request(appFor(SEEKER2)).get(`/${ID}`);
    const allowed = ["_id", "about", "cover", "desiredJobTitle", "educationalAttainment", "name", "profileImage", "role", "skills"];
    Object.keys(res.body.user).forEach((key) => expect(allowed).toContain(key));
    ["email", "phone", "workExperience", "preferredIndustries", "availabilityStatus"].forEach((key) => expect(key in res.body.user).toBe(false));
    expect(res.body.profile.expectedSalaryMin).toBeUndefined();
    expect(res.body.profile.preferredOccupations).toBeUndefined();
  });

  test("the summary has the hover card fields only", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const res = await request(appFor(EMP)).get(`/${ID}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ID,
      role: "jobseeker",
      name: "Ana Cruz",
      avatar: "/uploads/profiles/a.webp",
      cover: { kind: "default" },
      headline: "Welder",
      location: "Boac, Marinduque",
      ownerLink: false,
    });
  });

  test("the owner sees ownerLink and no secrets", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const summary = await request(appFor(OWNER)).get(`/${ID}/summary`);
    expect(summary.body.ownerLink).toBe(true);
    const full = await request(appFor(OWNER)).get(`/${ID}`);
    expect(JSON.stringify(full.body)).not.toMatch(/loginLock/);
  });

  test("staff get the staff view without secrets", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const res = await request(appFor(ADMIN)).get(`/${ID}`);
    expect(res.body.mode).toBe("staff");
    expect(JSON.stringify(res.body)).not.toContain("loginLock");
  });

  test("responses are private and cacheable for a minute, with Vary", async () => {
    wire({ target: seeker(), profile: seekerProfile() });
    const res = await request(appFor(EMP)).get(`/${ID}/summary`);
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    expect(res.headers.vary).toMatch(/Authorization/i);
    const miss = await request(appFor(EMP)).get("/bad");
    expect(miss.headers["cache-control"]).toBe("no-store");
  });
});

describe("employer target", () => {
  const prof = () => ({ tin: "999", ownerName: "Owner", businessAddress: { municipality: "Boac", province: "Marinduque" }, toObject() { return { tin: this.tin, ownerName: this.ownerName }; } });

  test("a jobseeker sees the public company only", async () => {
    wire({ target: employer(), profile: prof() });
    const res = await request(appFor(SEEKER2)).get(`/${ID}`);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    ["hr@acme.com", "0917", "loginLock", "tin", "ownerName", "Owner"].forEach((k) => expect(json).not.toContain(k));
    expect(res.body.user.verified).toBe(true);
  });

  test("summary: company name, industry, location, verified", async () => {
    wire({ target: employer(), profile: prof() });
    const res = await request(appFor(SEEKER2)).get(`/${ID}/summary`);
    expect(res.body).toMatchObject({ role: "employer", headline: "Retail", location: "Boac, Marinduque", verified: true });
  });

  test("a suspended employer is unavailable to non-staff but visible to staff", async () => {
    wire({ target: employer({ isActive: false }), profile: prof() });
    expect((await request(appFor(SEEKER2)).get(`/${ID}`)).status).toBe(404);
    wire({ target: employer({ isActive: false }), profile: prof() });
    expect((await request(appFor(ADMIN)).get(`/${ID}`)).status).toBe(200);
  });

  test("an uploaded image cover comes back resolved, with no stored values", async () => {
    const t = employer({ cover: { kind: "image", image: { status: "published", url: "/uploads/covers/x.webp", thumbUrl: "/uploads/covers/x-s.webp", width: 1600, height: 400, storedValue: "STORED" } } });
    wire({ target: t, profile: prof() });
    const res = await request(appFor(SEEKER2)).get(`/${ID}`);
    expect(res.body.user.cover.kind).toBe("image");
    expect(JSON.stringify(res.body)).not.toContain("STORED");
  });
});
