// Every path that changes a JobApplication's status must set statusUpdatedAt, hiredAt and
// firstResponseAt through services/applicationStatusService.js. The real handlers run here
// with mocked models; the state at save time is what is asserted. A source scan fails if
// any code assigns application.status directly again.

const fs = require("fs");
const path = require("path");

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ findById: jest.fn(), find: jest.fn(), create: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({}));
jest.mock("../models/JobseekerProfile", () => ({}));
jest.mock("../models/JobseekerDocument", () => ({}));
jest.mock("../models/EmployerProfile", () => ({}));
jest.mock("../models/User", () => ({}));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/Follow", () => ({}));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn().mockResolvedValue({}) }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/semanticService", () => ({}));
jest.mock("../services/matchProfileService", () => ({}));
jest.mock("../services/matchWeightsService", () => ({}));
jest.mock("../services/storageService", () => ({ remove: jest.fn() }));
jest.mock("../services/profileProjection", () => ({}));
jest.mock("../services/bannerTemplateService", () => ({}));

const JobApplication = require("../models/JobApplication");
const employer = require("../controllers/employerController");
const jobs = require("../controllers/jobController");

const EMPLOYER_ID = "e".repeat(24);
const APPLICANT_ID = "a".repeat(24);

// A document-like application that records its fields at every save.
const makeApplication = (over = {}) => {
  const saves = [];
  const app = {
    _id: "c".repeat(24),
    status: "pending",
    statusUpdatedAt: null,
    hiredAt: null,
    hiredAtApproximate: false,
    firstResponseAt: null,
    employerNote: "",
    vacancy: { _id: "d".repeat(24), title: "Cook", employer: EMPLOYER_ID },
    applicant: { _id: APPLICANT_ID, name: "Ana" },
    interview: { scheduledAt: new Date("2020-01-01T00:00:00Z"), noShow: false },
    toString() { return APPLICANT_ID; },
    ...over,
  };
  app.save = jest.fn(async function save() { saves.push({ status: this.status, statusUpdatedAt: this.statusUpdatedAt, hiredAt: this.hiredAt, firstResponseAt: this.firstResponseAt }); });
  app.saves = saves;
  return app;
};

const chain = (value) => {
  const q = { populate: jest.fn(() => q), select: jest.fn(() => q), lean: jest.fn(() => q) };
  q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return q;
};

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const reqFor = (over = {}) => ({ user: { _id: EMPLOYER_ID, id: EMPLOYER_ID, role: "employer" }, params: {}, body: {}, headers: {}, ip: "127.0.0.1", app: { get: jest.fn() }, get: jest.fn(), ...over });

beforeEach(() => jest.clearAllMocks());

describe("employer single update", () => {
  test("pending to under_review sets firstResponseAt and statusUpdatedAt", async () => {
    const app = makeApplication();
    JobApplication.findById.mockReturnValue(chain(app));
    await employer.updateApplicationStatus(reqFor({ params: { applicationId: app._id }, body: { status: "under_review" } }), makeRes());
    expect(app.saves).toHaveLength(1);
    expect(app.saves[0].statusUpdatedAt).toBeInstanceOf(Date);
    expect(app.saves[0].firstResponseAt).toBeInstanceOf(Date);
    expect(app.saves[0].hiredAt).toBeNull();
  });

  test("shortlisted to hired sets hiredAt; hired back to pending clears it", async () => {
    const app = makeApplication({ status: "shortlisted", firstResponseAt: new Date("2026-01-01") });
    JobApplication.findById.mockReturnValue(chain(app));
    await employer.updateApplicationStatus(reqFor({ params: { applicationId: app._id }, body: { status: "hired" } }), makeRes());
    expect(app.saves[0].hiredAt).toBeInstanceOf(Date);
    expect(app.saves[0].firstResponseAt).toEqual(new Date("2026-01-01")); // not overwritten
    await employer.updateApplicationStatus(reqFor({ params: { applicationId: app._id }, body: { status: "pending" } }), makeRes());
    expect(app.saves[1].hiredAt).toBeNull();
  });
});

describe("employer no-show reject", () => {
  test("sets the response and last-change dates", async () => {
    const app = makeApplication();
    JobApplication.findById.mockReturnValue(chain(app));
    await employer.markInterviewNoShow(reqFor({ params: { applicationId: app._id } }), makeRes());
    expect(app.saves).toHaveLength(1);
    expect(app.saves[0].status).toBe("rejected");
    expect(app.saves[0].statusUpdatedAt).toBeInstanceOf(Date);
    expect(app.saves[0].firstResponseAt).toBeInstanceOf(Date);
  });
});

describe("employer bulk update", () => {
  test("every selected application gets the dates", async () => {
    const one = makeApplication({ _id: "1".repeat(24) });
    const two = makeApplication({ _id: "2".repeat(24), status: "shortlisted" });
    JobApplication.find.mockReturnValue(chain([one, two]));
    await employer.bulkUpdateApplicationStatuses(reqFor({ body: { applicationIds: [one._id, two._id], status: "hired" } }), makeRes());
    for (const app of [one, two]) {
      expect(app.saves).toHaveLength(1);
      expect(app.saves[0].hiredAt).toBeInstanceOf(Date);
      expect(app.saves[0].statusUpdatedAt).toBeInstanceOf(Date);
    }
    expect(one.saves[0].firstResponseAt).toBeInstanceOf(Date); // pending to hired is a response
  });
});

describe("applicant withdraw", () => {
  test("withdrawing sets statusUpdatedAt and is not counted as an employer response", async () => {
    const app = makeApplication({ applicant: { toString: () => APPLICANT_ID } });
    app.applicant = { toString: () => APPLICANT_ID };
    JobApplication.findById.mockResolvedValue(app);
    await jobs.deleteMyApplication(reqFor({ user: { id: APPLICANT_ID, _id: APPLICANT_ID, role: "jobseeker" }, params: { id: app._id } }), makeRes());
    expect(app.saves).toHaveLength(1);
    expect(app.saves[0].status).toBe("withdrawn");
    expect(app.saves[0].statusUpdatedAt).toBeInstanceOf(Date);
    expect(app.saves[0].firstResponseAt).toBeNull();
  });
});

describe("applicant re-apply", () => {
  test("the reactivation resets the response and hire dates through the shared helper", () => {
    const source = fs.readFileSync(path.join(__dirname, "../controllers/jobController.js"), "utf8");
    expect(source).toMatch(/existingApplication\.set\(\{\s*\.\.\.reactivationFields\(\)/);
  });
});

describe("no path assigns the status directly", () => {
  const SCAN = ["controllers", "services", "utils", "middleware", "routes"];
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
    });

  test("only applicationStatusService.js writes application.status or statusUpdatedAt", () => {
    const offenders = [];
    for (const folder of SCAN) {
      for (const file of walk(path.join(__dirname, "..", folder))) {
        if (file.endsWith("applicationStatusService.js")) continue;
        const text = fs.readFileSync(file, "utf8");
        const usesApplications = /models\/JobApplication/.test(text);
        if (!usesApplications) continue;
        text.split("\n").forEach((line, index) => {
          if (/\b(application|app|existingApplication|appl)\.(status|statusUpdatedAt|hiredAt|firstResponseAt)\s*=(?!=)/.test(line)) {
            offenders.push(`${path.relative(path.join(__dirname, ".."), file)}:${index + 1}: ${line.trim()}`);
          }
          // bulk writes straight to the collection would skip the helper too
          if (/JobApplication\.(updateMany|updateOne|findOneAndUpdate|findByIdAndUpdate|bulkWrite|replaceOne)\(/.test(line)) {
            offenders.push(`${path.relative(path.join(__dirname, ".."), file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
