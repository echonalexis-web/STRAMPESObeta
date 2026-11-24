// Pure generator tests. No database connection is opened anywhere in this file.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const User = require("../models/User");
const EmployerProfile = require("../models/EmployerProfile");
const JobseekerProfile = require("../models/JobseekerProfile");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const { getAccountType } = require("../utils/accountType");
const { getAgeFromDate } = require("../utils/age");
const { isValidPhone } = require("../utils/phone");
const usernameUtil = require("../utils/username");
const { generateSample, PLACEHOLDER_HASH } = require("../scripts/seed/generator");
const { EMAIL_DOMAIN, USERNAME_PREFIX, ROLES } = require("../scripts/seed/data");

const NOW = new Date("2026-11-24T04:00:00.000Z");
const OPTS = { seed: 42, batch: "test", now: NOW };

let plan;
beforeAll(() => {
  plan = generateSample(OPTS);
});

const countBy = (items, fn) => items.reduce((acc, item) => ((acc[fn(item)] = (acc[fn(item)] || 0) + 1), acc), {});
const jobKind = (job) => (job.archived ? "archived" : job.status === "closed" ? "closed" : job.status === "active" ? "open" : job.status);

describe("seed generator: counts and allocation", () => {
  test("defaults give 10 employers, 100 jobseekers and the default town allocation", () => {
    expect(plan.employers).toHaveLength(10);
    expect(plan.jobseekers).toHaveLength(100);
    expect(countBy(plan.employers, (e) => e.profile.businessAddress.municipality)).toEqual({
      BOAC: 3, "SANTA CRUZ": 2, GASAN: 2, MOGPOG: 1, BUENAVISTA: 1, TORRIJOS: 1,
    });
    expect(plan.jobs.length).toBeGreaterThanOrEqual(40);
    expect(plan.jobs.length).toBeLessThanOrEqual(50);
  });

  test("every town has employers and jobseekers; counts are configurable", () => {
    const small = generateSample({ ...OPTS, employers: 6, jobseekers: 60 });
    expect(Object.keys(countBy(small.employers, (e) => e.townKey))).toHaveLength(6);
    const big = generateSample({ ...OPTS, employers: 14, jobseekers: 120 });
    expect(big.employers).toHaveLength(14);
    expect(Object.keys(countBy(big.employers, (e) => e.townKey))).toHaveLength(6);
    expect(big.jobseekers).toHaveLength(120);
    const towns = countBy(plan.jobseekers, (j) => j.townKey);
    expect(Object.keys(towns)).toHaveLength(6);
    expect(towns.BOAC).toBeGreaterThan(towns.BUENAVISTA);
    expect(towns["SANTA CRUZ"]).toBeGreaterThan(towns.TORRIJOS);
  });

  test("same seed gives identical output; another seed differs", () => {
    expect(JSON.stringify(generateSample(OPTS))).toBe(JSON.stringify(plan));
    expect(JSON.stringify(generateSample({ ...OPTS, seed: 43 }))).not.toBe(JSON.stringify(plan));
  });
});

describe("seed generator: schema validity and uniqueness", () => {
  const check = (Model, docs) => {
    for (const doc of docs) {
      const error = new Model(doc).validateSync();
      if (error) throw new Error(`${Model.modelName} ${doc._id}: ${error.message}`);
    }
  };

  test("every document passes validateSync (no DB)", () => {
    check(User, [...plan.employers, ...plan.jobseekers].map((x) => x.user));
    check(EmployerProfile, plan.employers.map((x) => x.profile));
    check(JobseekerProfile, plan.jobseekers.map((x) => x.profile));
    check(JobVacancy, plan.jobs);
    check(JobApplication, plan.applications);
    expect(mongoose.connection.readyState).toBe(0);
  });

  test("no duplicate usernames, emails, ids or (applicant, vacancy) pairs", () => {
    const users = [...plan.employers, ...plan.jobseekers].map((x) => x.user);
    const emails = users.map((u) => u.email).filter(Boolean).map((e) => e.toLowerCase());
    const usernames = users.map((u) => u.username).filter(Boolean);
    const unique = (list) => new Set(list).size === list.length;
    expect(unique(emails)).toBe(true);
    expect(unique(usernames)).toBe(true);
    const ids = [
      ...users.map((u) => String(u._id)), ...plan.jobs.map((j) => String(j._id)), ...plan.applications.map((a) => String(a._id)),
      ...plan.employers.map((x) => String(x.profile._id)), ...plan.jobseekers.map((x) => String(x.profile._id)),
    ];
    expect(unique(ids)).toBe(true);
    expect(unique(plan.applications.map((a) => `${a.applicant}:${a.vacancy}`))).toBe(true);
  });

  test("reserved markers: only the seed email domain and seed_ usernames; no real password", () => {
    const users = [...plan.employers, ...plan.jobseekers].map((x) => x.user);
    for (const u of users) {
      if (u.email) expect(u.email.endsWith(`@${EMAIL_DOMAIN}`)).toBe(true);
      expect(u.password).toBe(PLACEHOLDER_HASH);
    }
    for (const { user } of plan.jobseekers) {
      expect(user.username.startsWith(USERNAME_PREFIX)).toBe(true);
      expect(usernameUtil.validateFormat(user.username).ok).toBe(true);
    }
    expect(JSON.stringify(plan.credentials)).not.toMatch(/password/i);
  });

  test("phones use the reserved fake pattern and pass the app's phone check", () => {
    const phones = [...plan.employers, ...plan.jobseekers].map((x) => x.user.phone).filter(Boolean);
    expect(phones.length).toBeGreaterThan(50);
    for (const phone of phones) {
      expect(phone).toMatch(/^\+63900000\d{4}$/);
      expect(isValidPhone(phone)).toBe(true);
    }
  });

  test("skills come from the client's COMMON_SKILLS list", () => {
    const file = fs.readFileSync(path.join(__dirname, "../../client/src/data/skills.js"), "utf8");
    const list = new Set([...file.slice(0, file.indexOf("export const COMMON_SKILLS")).matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const used = new Set([
      ...Object.values(ROLES).flatMap((r) => r.skills),
      ...plan.jobseekers.flatMap((j) => j.user.skills),
    ]);
    const missing = [...used].filter((s) => !list.has(s));
    expect(missing).toEqual([]);
  });
});

describe("seed generator: employers and jobs", () => {
  test("every employer is verified, active and email-verified", () => {
    for (const { user } of plan.employers) {
      expect(user.role).toBe("employer");
      expect(user.verificationStatus).toBe("verified");
      expect(user.verificationReviewedAt).toBeInstanceOf(Date);
      expect(user.isEmailVerified).toBe(true);
      expect(user.isActive).toBe(true);
      expect(user.accountStatus).toBe("active");
    }
    expect(new Set(plan.employers.map((e) => e.user.industry)).size).toBe(10);
  });

  test("3 to 6 jobs per employer, at least 2 Open each, status quotas met", () => {
    const perEmployer = countBy(plan.jobs, (j) => String(j.employer));
    const kinds = countBy(plan.jobs, jobKind);
    for (const { user } of plan.employers) {
      expect(perEmployer[String(user._id)]).toBeGreaterThanOrEqual(3);
      expect(perEmployer[String(user._id)]).toBeLessThanOrEqual(6);
      const open = plan.jobs.filter((j) => String(j.employer) === String(user._id) && jobKind(j) === "open").length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
    expect(kinds.closed).toBeGreaterThanOrEqual(3);
    expect(kinds.archived).toBeGreaterThanOrEqual(2);
    expect(kinds.draft || 0).toBeLessThanOrEqual(1);
    const openShare = kinds.open / plan.jobs.length;
    expect(openShare).toBeGreaterThan(0.75);
    expect(openShare).toBeLessThan(0.9);
  });

  test("salary, dates, openings and shared role titles", () => {
    for (const job of plan.jobs) {
      if (job.salaryMin !== null) expect(job.salaryMin).toBeLessThan(job.salaryMax);
      expect(job.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(job.createdAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 91 * 86400000);
      expect(job.slots).toBeGreaterThanOrEqual(1);
      expect(job.slots).toBeLessThanOrEqual(5);
      if (jobKind(job) === "open" && job.applicationDeadline) expect(job.applicationDeadline.getTime()).toBeGreaterThan(NOW.getTime());
      if (job.closedAt) {
        expect(job.closedAt.getTime()).toBeGreaterThan(job.createdAt.getTime());
        expect(job.closedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      }
    }
    expect(plan.jobs.some((j) => j.salaryMin === null)).toBe(true);
    const titles = countBy(plan.jobs, (j) => j.title);
    expect(Object.keys(titles).every((t) => Object.values(ROLES).some((r) => r.title === t))).toBe(true);
    expect(Object.values(titles).filter((n) => n >= 3).length).toBeGreaterThanOrEqual(3);
  });
});

describe("seed generator: jobseekers", () => {
  test("ages 18 to 55, basic vs protected split, profile completeness tiers", () => {
    for (const { user } of plan.jobseekers) {
      const age = getAgeFromDate(user.dateOfBirth, NOW);
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(55);
      expect(user.skills.length).toBeGreaterThanOrEqual(3);
      expect(user.skills.length).toBeLessThanOrEqual(8);
      expect(user.loginLock).toEqual({ failures: 0, level: 0 });
    }
    const types = countBy(plan.jobseekers, (j) => getAccountType(j.user));
    expect(types.protected).toBe(40);
    expect(types.basic).toBe(60);
    for (const j of plan.jobseekers.filter((x) => x.isProtected)) {
      expect(j.user.email).toMatch(/^seed\.js\.\d{3}@seed\.stram\.example$/);
      expect(j.user.isEmailVerified).toBe(true);
    }
    for (const j of plan.jobseekers.filter((x) => !x.isProtected)) expect(j.user.email).toBeUndefined();
    expect(countBy(plan.jobseekers, (j) => j.tier)).toEqual({ complete: 30, mostly: 40, partial: 30 });
  });
});

describe("seed generator: applications", () => {
  const jobById = () => new Map(plan.jobs.map((j) => [String(j._id), j]));
  const seekerIds = () => new Set(plan.jobseekers.map((j) => String(j.user._id)));

  test("each jobseeker applies to 2-6 jobs (about 4); references exist", () => {
    const perSeeker = countBy(plan.applications, (a) => String(a.applicant));
    const jobs = jobById();
    const seekers = seekerIds();
    for (const { user } of plan.jobseekers) {
      expect(perSeeker[String(user._id)]).toBeGreaterThanOrEqual(2);
      expect(perSeeker[String(user._id)]).toBeLessThanOrEqual(6);
    }
    for (const a of plan.applications) {
      expect(seekers.has(String(a.applicant))).toBe(true);
      expect(jobs.has(String(a.vacancy))).toBe(true);
    }
    const mean = plan.applications.length / 100;
    expect(mean).toBeGreaterThan(3.6);
    expect(mean).toBeLessThan(4.4);
  });

  test("applicants per job: Open jobs >= 3, none above 25%, employers verified", () => {
    const perJob = countBy(plan.applications, (a) => String(a.vacancy));
    const employers = new Map(plan.employers.map((e) => [String(e.user._id), e.user]));
    for (const job of plan.jobs) {
      expect(perJob[String(job._id)] || 0).toBeGreaterThanOrEqual(3);
      expect(employers.get(String(job.employer)).verificationStatus).toBe("verified");
      expect(employers.get(String(job.employer)).isActive).toBe(true);
    }
    expect(Math.max(...Object.values(perJob))).toBeLessThanOrEqual(Math.floor(0.25 * plan.applications.length));
  });

  test("about 60% of applications go to a job in the applicant's own town", () => {
    const jobs = jobById();
    const townOfEmployer = new Map(plan.employers.map((e) => [String(e.user._id), e.townKey]));
    const townOfSeeker = new Map(plan.jobseekers.map((j) => [String(j.user._id), j.townKey]));
    const same = plan.applications.filter(
      (a) => townOfEmployer.get(String(jobs.get(String(a.vacancy)).employer)) === townOfSeeker.get(String(a.applicant))
    ).length;
    const share = same / plan.applications.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.75);
  });

  test("status mix, hires within openings, dates are consistent", () => {
    const jobs = jobById();
    const total = plan.applications.length;
    const status = countBy(plan.applications, (a) => a.status);
    const expected = { pending: 0.35, under_review: 0.25, shortlisted: 0.18, hired: 0.1, rejected: 0.12 };
    for (const [key, share] of Object.entries(expected)) {
      expect(Math.abs((status[key] || 0) / total - share)).toBeLessThan(0.07);
    }
    const hiresPerJob = countBy(plan.applications.filter((a) => a.status === "hired"), (a) => String(a.vacancy));
    for (const [id, n] of Object.entries(hiresPerJob)) expect(n).toBeLessThanOrEqual(jobs.get(id).slots);

    for (const a of plan.applications) {
      const job = jobs.get(String(a.vacancy));
      expect(a.appliedAt.getTime()).toBeGreaterThanOrEqual(job.createdAt.getTime());
      expect(a.appliedAt.getTime()).toBeLessThan(NOW.getTime());
      if (a.status === "hired") {
        expect(a.hiredAt.getTime()).toBeGreaterThan(a.appliedAt.getTime());
        expect(a.hiredAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
        expect(a.hiredAtApproximate).toBe(false);
      } else {
        expect(a.hiredAt).toBeNull();
      }
      if (a.status === "pending") expect(a.firstResponseAt).toBeNull();
      else expect(a.firstResponseAt.getTime()).toBeGreaterThan(a.appliedAt.getTime());
      if (jobKind(job) !== "open") {
        expect(["hired", "rejected"]).toContain(a.status);
        expect(a.statusUpdatedAt.getTime()).toBeLessThanOrEqual(job.closedAt.getTime());
      }
    }
    for (const job of plan.jobs.filter((j) => j.archived)) {
      expect(job.archivedMetrics.totalApplicants).toBe(plan.applications.filter((a) => String(a.vacancy) === String(job._id)).length);
    }
  });
});
