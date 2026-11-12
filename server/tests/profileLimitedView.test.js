// "Another person sees only the header plus About, Work experience and Skills."
// Every viewer by target combination, both mounts; forbidden fields must be ABSENT
// from the JSON (not null).

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../models/ContactShare", () => ({ find: jest.fn() }));
jest.mock("../models/BannerTemplate", () => ({ find: jest.fn() }));
jest.mock("../models/AvatarPreset", () => ({ find: jest.fn() }));
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
const AvatarPreset = require("../models/AvatarPreset");
const bannerService = require("../services/bannerTemplateService");
const avatarService = require("../services/avatarPresetService");
const { getSummary, getProfile } = require("../controllers/profileViewController");

const ID = "507f1f77bcf86cd799439011";
const adult = new Date("1995-01-01T00:00:00.000Z");
const minorDob = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000);

const toObject = function toObject() {
  const { toObject: _drop, ...rest } = this;
  return rest;
};
const seeker = (extra = {}) => ({
  _id: ID,
  role: "jobseeker",
  name: "Ana Cruz",
  email: "ana@x.com",
  phone: "09171234567",
  dateOfBirth: adult,
  citizenship: "Filipino",
  civilStatus: "single",
  profileImage: "/uploads/profiles/a.webp",
  desiredJobTitle: "Welder",
  availabilityStatus: "Actively looking",
  about: "I weld for a living.",
  skills: ["welding"],
  educationalAttainment: "College",
  employmentStatus: "unemployed",
  unemploymentReason: "fresh_graduate",
  workExperience: "3 years",
  preferredIndustries: ["Construction"],
  expectedSalaryMin: 20000,
  governmentIdNumber: "SECRET-ID",
  validIdFile: "/uploads/ids/x.png",
  resume: "/uploads/resumes/r.pdf",
  loginLock: { n: 1 },
  privacy: { profileVisibility: "public" },
  isActive: true,
  toObject,
  ...extra,
});
const seekerProfile = () => ({
  tin: "111",
  presentAddress: { street: "12 Rizal St", barangay: "Barangay Uno", municipality: "Boac", province: "Marinduque", region: "MIMAROPA" },
  permanentAddress: "secret street",
  course: "BSIT",
  schoolAttended: "MSU",
  yearGraduated: "2019",
  skills: ["welding", "fitting"],
  languageProficiency: { English: { read: true, write: true } },
  preferredOccupations: ["Welder"],
  preferredWorkLocationLocal: ["Boac"],
  vocationalTrainings: [{ course: "TESDA" }],
  workHistory: [{ companyName: "Mart", address: "Employer street", position: "Welder", dateFrom: "2019-01", dateTo: "2021-06", status: "Terminated" }],
  toObject,
});

const MOUNTS = ["/api/profiles", "/api/v1/profiles"];
const appFor = (user) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  for (const base of MOUNTS) {
    app.get(`${base}/:id/summary`, getSummary);
    app.get(`${base}/:id`, getProfile);
  }
  return app;
};

const wire = ({ target = seeker(), profile = seekerProfile(), applied = false, shares = [] } = {}) => {
  User.findById.mockResolvedValue(target);
  JobseekerProfile.findOne.mockResolvedValue(profile);
  EmployerProfile.findOne.mockResolvedValue(profile);
  const chain = (v) => ({ select: () => ({ lean: () => Promise.resolve(v) }), distinct: () => Promise.resolve(v) });
  JobVacancy.find.mockReturnValue(chain(["j1"]));
  JobApplication.find.mockReturnValue(chain(applied ? [{ includePhoto: false }] : []));
  ContactShare.find.mockReturnValue(chain(shares));
  Follow.exists.mockResolvedValue(null);
};

const EMP = { id: "emp1", role: "employer" };
const PEER = { id: "other", role: "jobseeker" };
const ADMIN = { id: "adm", role: "admin" };
const SUPER = { id: "sup", role: "superadmin" };
const OWNER = { id: ID, role: "jobseeker" };

beforeEach(() => {
  jest.resetAllMocks();
  bannerService.invalidateCache();
  avatarService.invalidateCache();
  BannerTemplate.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
  AvatarPreset.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
});

const FORBIDDEN_USER = [
  "email", "phone", "dateOfBirth", "citizenship", "civilStatus", "educationalAttainment", "employmentStatus", "unemploymentReason",
  "workExperience", "preferredIndustries", "expectedSalaryMin", "governmentIdNumber", "validIdFile", "resume", "loginLock", "privacy",
  "address", "ageTier",
];
const FORBIDDEN_PROFILE = [
  "tin", "permanentAddress", "course", "schoolAttended", "yearGraduated", "languageProficiency", "vocationalTrainings",
];
// Approved addition: the desired positions go to every other viewer; the preferred work
// locations go to employers only (never another jobseeker).
const LOCATION_FIELDS = ["preferredWorkLocationLocal", "preferredWorkLocationOverseas"];
const ALLOWED_USER = ["_id", "about", "availabilityStatus", "avatarPreset", "cover", "desiredJobTitle", "name", "profileImage", "role", "skills"];

const bodyOf = (res) => res.body;
const expectCard = (res) => {
  expect(res.status).toBe(200);
  const { user, profile } = bodyOf(res);
  Object.keys(user).forEach((key) => expect(ALLOWED_USER).toContain(key));
  FORBIDDEN_USER.forEach((key) => expect(key in user).toBe(false));
  FORBIDDEN_PROFILE.forEach((key) => expect(key in profile).toBe(false));
  // Location is the municipality and province only: never the street, barangay or region.
  expect(profile.presentAddress).toEqual({ municipality: "Boac", province: "Marinduque" });
  expect(JSON.stringify(res.body)).not.toMatch(/Barangay Uno|12 Rizal|MIMAROPA|secret street|Employer street|Terminated|SECRET-ID/);
  // The three sections' data is there.
  expect(user.about).toBe("I weld for a living.");
  expect(user.skills).toEqual(["welding"]);
  expect(profile.workHistory).toEqual([{ position: "Welder", companyName: "Mart", dateFrom: "2019-01", dateTo: "2021-06" }]);
  expect(profile.preferredOccupations).toEqual(["Welder"]);
};

describe.each(MOUNTS)("another viewer sees only the header, About, Work experience and Skills (%s)", (mount) => {
  test("another jobseeker", async () => {
    wire();
    const res = await request(appFor(PEER)).get(`${mount}/${ID}`);
    expectCard(res);
    LOCATION_FIELDS.forEach((key) => expect(key in res.body.profile).toBe(false));
  });

  test("an employer with no relationship: the same card, no contact keys", async () => {
    wire();
    const res = await request(appFor(EMP)).get(`${mount}/${ID}`);
    expectCard(res);
    expect(res.body.mode).toBe("hiring");
    // An employer also gets the preferred work locations (when the person has any).
    expect(res.body.profile.preferredWorkLocationLocal).toEqual(["Boac"]);
  });

  test("an employer sees contact only for an active application or an explicit share", async () => {
    wire({ applied: true });
    const applied = await request(appFor(EMP)).get(`${mount}/${ID}`);
    expect(applied.body.user.phone).toBe("09171234567");
    expect(applied.body.user.email).toBe("ana@x.com");
    ["educationalAttainment", "dateOfBirth", "employmentStatus", "address"].forEach((key) => expect(key in applied.body.user).toBe(false));
    wire({ shares: [{ fields: { phone: true, email: false } }] });
    const shared = await request(appFor(EMP)).get(`${mount}/${ID}`);
    expect(shared.body.user.phone).toBe("09171234567");
    expect("email" in shared.body.user).toBe(false);
  });

  test("the \"Actively looking\" status disappears when the person hides their active status", async () => {
    wire({ target: seeker({ privacy: { profileVisibility: "public", showActiveStatus: false } }) });
    const res = await request(appFor(PEER)).get(`${mount}/${ID}`);
    expect("availabilityStatus" in res.body.user).toBe(false);
    expect(res.body.user.desiredJobTitle).toBe("Welder");
  });

  test("empty sections are absent, never empty placeholders", async () => {
    wire({ target: seeker({ about: undefined, skills: [] }), profile: { ...seekerProfile(), skills: [], workHistory: [] } });
    const res = await request(appFor(PEER)).get(`${mount}/${ID}`);
    expect(res.status).toBe(200);
    ["about", "skills"].forEach((key) => expect(key in res.body.user).toBe(false));
    ["skills", "workHistory"].forEach((key) => expect(key in res.body.profile).toBe(false));
  });

  test("a 15 to 17 year old: unavailable to an employer, header only for a jobseeker", async () => {
    wire({ target: seeker({ dateOfBirth: minorDob }) });
    expect((await request(appFor(EMP)).get(`${mount}/${ID}`)).status).toBe(404);
    const peer = await request(appFor(PEER)).get(`${mount}/${ID}`);
    expect(peer.status).toBe(200);
    expect(Object.keys(peer.body.user).sort()).toEqual(["_id", "cover", "desiredJobTitle", "name", "profileImage", "role"]);
    expect(Object.keys(peer.body.profile)).toEqual(["presentAddress"]);
  });

  test("suspended, inactive and hidden profiles are one neutral answer", async () => {
    for (const target of [seeker({ accountStatus: "suspended" }), seeker({ isActive: false }), seeker({ privacy: { profileVisibility: "hidden" } })]) {
      wire({ target });
      const res = await request(appFor(PEER)).get(`${mount}/${ID}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: "PROFILE_UNAVAILABLE", message: "This profile is unavailable." });
    }
  });

  test("the hover card summary has the header-level details only", async () => {
    wire();
    const res = await request(appFor(PEER)).get(`${mount}/${ID}/summary`);
    expect(res.status).toBe(200);
    const allowed = ["id", "role", "name", "avatar", "avatarPreset", "cover", "headline", "location", "ownerLink"];
    Object.keys(res.body).forEach((key) => expect(allowed).toContain(key));
    expect(res.body.location).toBe("Boac, Marinduque");
    expect(JSON.stringify(res.body)).not.toMatch(/ana@x.com|09171234567|SECRET-ID|welding/);
  });
});

describe.each(MOUNTS)("owner, staff and signed out are unchanged (%s)", (mount) => {
  test("the owner keeps the full view, without secrets", async () => {
    wire();
    const res = await request(appFor(OWNER)).get(`${mount}/${ID}`);
    expect(res.body.mode).toBe("full");
    expect(res.body.user.email).toBe("ana@x.com");
    expect(res.body.user.dateOfBirth).toBeDefined();
    expect("loginLock" in res.body.user).toBe(false);
  });

  test.each([["admin", ADMIN], ["superadmin", SUPER]])("%s keeps the staff view", async (_n, viewer) => {
    wire();
    const res = await request(appFor(viewer)).get(`${mount}/${ID}`);
    expect(res.body.mode).toBe("staff");
    expect(res.body.user.email).toBe("ana@x.com");
    expect(res.body.profile.course).toBe("BSIT");
  });
});

describe("signed out", () => {
  test("the projection gives nothing", () => {
    const projection = require("../services/profileProjection");
    expect(projection.projectJobseeker({ viewer: null, target: seeker(), profile: seekerProfile(), relationship: {} })).toBeNull();
  });
});
