// Visibility rules for one person's profile as seen by another (plan section 15).
// Forbidden fields must be ABSENT from the result, not null.

jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/Follow", () => ({ exists: jest.fn() }));
jest.mock("../models/ContactShare", () => ({ find: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const Follow = require("../models/Follow");
const ContactShare = require("../models/ContactShare");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const projection = require("../services/profileProjection");

const chain = (value) => ({
  select: () => ({ lean: () => Promise.resolve(value) }),
  distinct: () => Promise.resolve(value),
});

const adultDob = new Date("1995-01-01T00:00:00.000Z");
const minorDob = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000);

const seeker = (extra = {}) => ({
  _id: "seeker1",
  role: "jobseeker",
  name: "Ana Cruz",
  email: "ana@example.com",
  phone: "09171234567",
  dateOfBirth: adultDob,
  profileImage: "/uploads/profiles/a.webp",
  desiredJobTitle: "Cashier",
  skills: ["pos"],
  governmentIdNumber: "1234-5678",
  governmentIdOcr: { rawText: "SECRET OCR" },
  loginLock: { failedAttempts: 3 },
  backupCodes: ["x"],
  recoveryEmailToken: "tok",
  recoveryEmail: "r@example.com",
  password: "hash",
  staffNote: "internal",
  privacy: { profileVisibility: "public" },
  isActive: true,
  ...extra,
});
const profile = () => ({
  tin: "111",
  sssGsisNo: "222",
  pagibigNo: "333",
  philhealthNo: "444",
  passportNo: "555",
  disability: "x",
  civilStatus: "single",
  religion: "r",
  permanentAddress: "secret street",
  landline: "999",
  mobileSecondary: "0917",
  presentAddress: { street: "12 Rizal", barangay: "B", municipality: "Marilao", province: "Bulacan", region: "III" },
  skills: ["pos"],
  course: "BSBA",
  workHistory: [{ company: "X" }],
});

const FORBIDDEN_USER = [
  "governmentIdNumber",
  "governmentIdOcr",
  "loginLock",
  "backupCodes",
  "recoveryEmailToken",
  "recoveryEmail",
  "password",
  "staffNote",
  "dateOfBirth",
  "privacy",
];
const FORBIDDEN_PROFILE = ["tin", "sssGsisNo", "pagibigNo", "philhealthNo", "passportNo", "disability", "civilStatus", "religion", "permanentAddress", "landline", "mobileSecondary"];

const employer = { id: "emp1", role: "employer" };

describe("projectJobseeker for an employer", () => {
  test("applicant: whitelisted, contact present, no secrets or NSRP numbers", () => {
    const out = projection.projectJobseeker({
      viewer: employer,
      target: seeker(),
      profile: profile(),
      relationship: { appliedActive: true, includePhoto: false, sharedFields: { phone: false, email: false } },
    });
    expect(out.user.phone).toBe("09171234567");
    expect(out.user.email).toBe("ana@example.com");
    FORBIDDEN_USER.forEach((k) => expect(k in out.user).toBe(false));
    FORBIDDEN_PROFILE.forEach((k) => expect(k in out.profile).toBe(false));
    expect(JSON.stringify(out)).not.toMatch(/SECRET OCR|1234-5678|Rizal|secret street/);
    expect("address" in out.user).toBe(false);
    expect(out.profile.presentAddress).toEqual({ municipality: "Marilao", province: "Bulacan" });
  });

  test("follower only: no phone and no email keys", () => {
    const out = projection.projectJobseeker({
      viewer: employer,
      target: seeker(),
      profile: profile(),
      relationship: { appliedActive: false, sharedFields: { phone: false, email: false } },
    });
    expect("phone" in out.user).toBe(false);
    expect("email" in out.user).toBe(false);
  });

  test("contact share with only phone exposes only phone", () => {
    const out = projection.projectJobseeker({
      viewer: employer,
      target: seeker(),
      profile: profile(),
      relationship: { appliedActive: false, sharedFields: { phone: true, email: false } },
    });
    expect(out.user.phone).toBe("09171234567");
    expect("email" in out.user).toBe(false);
  });

  test("hidden profile without application: nothing", () => {
    const out = projection.projectJobseeker({
      viewer: employer,
      target: seeker({ privacy: { profileVisibility: "hidden" } }),
      profile: profile(),
      relationship: { appliedActive: false },
    });
    expect(out).toBeNull();
  });

  test("hidden profile with application: name and contact only, no avatar unless includePhoto", () => {
    const base = {
      viewer: employer,
      target: seeker({ privacy: { profileVisibility: "hidden" } }),
      profile: profile(),
    };
    const off = projection.projectJobseeker({ ...base, relationship: { appliedActive: true, includePhoto: false } });
    expect(Object.keys(off.user).sort()).toEqual(["_id", "email", "name", "phone", "role"]);
    expect(off.profile).toEqual({});
    const on = projection.projectJobseeker({ ...base, relationship: { appliedActive: true, includePhoto: true } });
    expect(on.user.profileImage).toBe("/uploads/profiles/a.webp");
    expect("cover" in on.user).toBe(false);
  });

  test("minor is invisible to an employer even with an application", () => {
    const out = projection.projectJobseeker({
      viewer: employer,
      target: seeker({ dateOfBirth: minorDob }),
      profile: profile(),
      relationship: { appliedActive: true },
    });
    expect(out).toBeNull();
  });

  test("inactive or suspended target is unavailable", () => {
    expect(projection.projectJobseeker({ viewer: employer, target: seeker({ isActive: false }), profile: null, relationship: {} })).toBeNull();
    expect(projection.projectJobseeker({ viewer: employer, target: seeker({ accountStatus: "suspended" }), profile: null, relationship: {} })).toBeNull();
  });

  test("signed-out viewer gets nothing", () => {
    expect(projection.projectJobseeker({ viewer: null, target: seeker(), profile: profile(), relationship: {} })).toBeNull();
  });
});

describe("projectJobseeker for owner, staff and peers", () => {
  test("owner and staff never receive secrets", () => {
    for (const viewer of [{ id: "seeker1", role: "jobseeker" }, { id: "adm", role: "admin" }]) {
      const out = projection.projectJobseeker({ viewer, target: seeker(), profile: profile(), relationship: {} });
      ["password", "loginLock", "backupCodes", "recoveryEmailToken", "recoveryEmail"].forEach((k) => expect(k in out.user).toBe(false));
    }
  });

  test("peer sees only a public profile, with a short card for an adult", () => {
    const viewer = { id: "other", role: "jobseeker" };
    const out = projection.projectJobseeker({ viewer, target: seeker({ about: "Hello", educationalAttainment: "College" }), profile: profile(), relationship: {} });
    expect(Object.keys(out.user).sort()).toEqual(["_id", "about", "desiredJobTitle", "name", "profileImage", "role", "skills"]);
    ["email", "phone", "dateOfBirth", "governmentIdNumber", "workExperience", "preferredIndustries", "educationalAttainment", "ageTier"].forEach((k) => expect(k in out.user).toBe(false));
    const hidden = projection.projectJobseeker({ viewer, target: seeker({ privacy: { profileVisibility: "employers" } }), profile: profile(), relationship: {} });
    expect(hidden).toBeNull();
  });
});

describe("projectJobseeker peer view: work history and minors", () => {
  const viewer = { id: "other", role: "jobseeker" };
  const withWork = () => ({
    ...profile(),
    course: "BS Commerce",
    workHistory: [
      { position: "Cashier", companyName: "Mart", dateFrom: "2019-01", dateTo: "2021-06", address: "Somewhere", reasonForLeaving: "private", monthlySalary: 15000 },
      { position: "", companyName: "" },
    ],
    expectedSalaryMin: 20000,
    languageProficiency: { English: { read: true } },
    vocationalTrainings: [{ course: "TESDA" }],
    eligibilities: [{ name: "CSE" }],
  });

  test("an adult peer sees the role, company and dates of each job, and nothing else about it", () => {
    const out = projection.projectJobseeker({ viewer, target: seeker(), profile: withWork(), relationship: {} });
    expect(out.profile.workHistory).toEqual([{ position: "Cashier", companyName: "Mart", dateFrom: "2019-01", dateTo: "2021-06" }]);
    ["course", "schoolAttended", "yearGraduated"].forEach((k) => expect(k in out.profile).toBe(false));
    ["expectedSalaryMin", "languageProficiency", "vocationalTrainings", "eligibilities", "tin", "sssGsisNo"].forEach((k) => expect(k in out.profile).toBe(false));
  });

  test("a 15 to 17 year old stays name, photo, headline and municipality for a peer", () => {
    const out = projection.projectJobseeker({ viewer, target: seeker({ dateOfBirth: minorDob, about: "private", skills: ["x"] }), profile: withWork(), relationship: {} });
    expect(Object.keys(out.user).sort()).toEqual(["_id", "desiredJobTitle", "name", "profileImage", "role"]);
    expect("workHistory" in out.profile).toBe(false);
    expect("course" in out.profile).toBe(false);
  });

  test("with no jobs the key is absent", () => {
    const out = projection.projectJobseeker({ viewer, target: seeker(), profile: { ...profile(), workHistory: [] }, relationship: {} });
    expect("workHistory" in out.profile).toBe(false);
  });
});

describe("projectApplicant", () => {
  test("drops NSRP numbers, resume files and ID refs; keeps name/contact/skills", () => {
    const out = projection.projectApplicant({ user: { ...seeker(), resume: "r", resumeFile: "r", validIdFile: "id" }, profile: profile() });
    ["resume", "resumeFile", "validIdFile", "governmentIdNumber"].forEach((k) => expect(k in out).toBe(false));
    FORBIDDEN_PROFILE.forEach((k) => expect(k in out.profile).toBe(false));
    expect(out.name).toBe("Ana Cruz");
    expect(out.address).toBe("Marilao, Bulacan");
  });

  test("hidden profile: no skills, no profile, no avatar by default", () => {
    const out = projection.projectApplicant({ user: seeker({ privacy: { profileVisibility: "hidden" } }), profile: profile() });
    expect(out.skills).toBeUndefined();
    expect(out.profile).toBeUndefined();
    expect(out.profileImage).toBeUndefined();
    const withPhoto = projection.projectApplicant({ user: seeker({ privacy: { profileVisibility: "hidden" } }), profile: profile(), includePhoto: true });
    expect(withPhoto.profileImage).toBe("/uploads/profiles/a.webp");
  });
});

describe("scrubEmployerForJobPayload", () => {
  const emp = { _id: "e1", name: "Acme", email: "e@acme.com", phone: "0917", profile: { tradeName: "A", tin: "1", fax: "2", ownerName: "o", contactPersonName: "c", contactPersonPosition: "p" } };
  test("signed out: no email, phone or private profile fields", () => {
    const out = projection.scrubEmployerForJobPayload(emp, null);
    expect("email" in out).toBe(false);
    expect("phone" in out).toBe(false);
    ["tin", "fax", "ownerName", "contactPersonName", "contactPersonPosition"].forEach((k) => expect(k in out.profile).toBe(false));
    expect(out.profile.tradeName).toBe("A");
  });
  test("signed in: contact stays, private profile fields still go", () => {
    const out = projection.scrubEmployerForJobPayload(emp, { id: "s", role: "jobseeker" });
    expect(out.email).toBe("e@acme.com");
    expect("tin" in out.profile).toBe(false);
  });
  test("the employer and staff see everything", () => {
    expect(projection.scrubEmployerForJobPayload(emp, { id: "e1", role: "employer" })).toBe(emp);
    expect(projection.scrubEmployerForJobPayload(emp, { id: "x", role: "admin" })).toBe(emp);
  });
});

describe("resolveRelationship", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  test("non employer-to-jobseeker pairs resolve to nothing without queries", async () => {
    const rel = await projection.resolveRelationship({ viewer: { id: "a", role: "jobseeker" }, target: seeker() });
    expect(rel.appliedActive).toBe(false);
    expect(JobVacancy.find).not.toHaveBeenCalled();
  });
  test("active application and share", async () => {
    JobVacancy.find.mockReturnValue(chain(["j1"]));
    JobApplication.find.mockReturnValue(chain([{ includePhoto: true }]));
    ContactShare.find.mockReturnValue(chain([{ fields: { phone: true, email: false } }]));
    Follow.exists.mockResolvedValue(null);
    const rel = await projection.resolveRelationship({ viewer: employer, target: seeker() });
    expect(rel).toEqual({ appliedActive: true, includePhoto: true, sharedFields: { phone: true, email: false }, followsEmployer: false });
    const query = JobApplication.find.mock.calls[0][0];
    expect(query.status).toEqual({ $ne: "withdrawn" });
  });
  test("employer with no jobs has no application relationship", async () => {
    JobVacancy.find.mockReturnValue(chain([]));
    ContactShare.find.mockReturnValue(chain([]));
    Follow.exists.mockResolvedValue({ _id: "f" });
    const rel = await projection.resolveRelationship({ viewer: employer, target: seeker() });
    expect(rel.appliedActive).toBe(false);
    expect(rel.followsEmployer).toBe(true);
    expect(JobApplication.find).not.toHaveBeenCalled();
  });
});

describe("GET /employer/jobseekers/:userId (batch 0a)", () => {
  const employerController = require("../controllers/employerController");
  const run = async (target, prof, { applied, follower }) => {
    User.findById.mockResolvedValue({ ...target, toObject: () => ({ ...target }) });
    JobseekerProfile.findOne.mockResolvedValue(prof);
    JobVacancy.find.mockReturnValue(chain(["j1"]));
    JobApplication.exists = jest.fn().mockResolvedValue(applied ? { _id: "a" } : null);
    JobApplication.find.mockReturnValue(chain(applied ? [{ includePhoto: false }] : []));
    ContactShare.find.mockReturnValue(chain([]));
    Follow.exists.mockResolvedValue(follower ? { _id: "f" } : null);
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await employerController.getConnectedJobseekerProfile({ user: { id: "emp1", _id: "emp1", role: "employer" }, params: { userId: "seeker1" } }, res);
    return res;
  };
  beforeEach(() => jest.resetAllMocks());

  test("applicant: ID number, OCR text, login lock, tokens are absent from the JSON", async () => {
    const res = await run(seeker(), profile(), { applied: true });
    expect(res.statusCode).toBe(200);
    const json = JSON.stringify(res.body);
    ["governmentIdNumber", "governmentIdOcr", "SECRET OCR", "loginLock", "backupCodes", "recoveryEmailToken", "recoveryEmail", "tokenVersion", "staffNote", "passportNo", "sssGsisNo"].forEach((k) => expect(json).not.toContain(k));
    expect(res.body.user.phone).toBe("09171234567");
  });
  test("follower only: no contact", async () => {
    const res = await run(seeker(), profile(), { applied: false, follower: true });
    expect(res.statusCode).toBe(200);
    expect("phone" in res.body.user).toBe(false);
    expect("email" in res.body.user).toBe(false);
  });
  test("stranger: 403", async () => {
    const res = await run(seeker(), profile(), { applied: false, follower: false });
    expect(res.statusCode).toBe(403);
  });
  test("hidden profile stays 403", async () => {
    const res = await run(seeker({ privacy: { profileVisibility: "hidden" } }), profile(), { applied: true });
    expect(res.statusCode).toBe(403);
  });
});
