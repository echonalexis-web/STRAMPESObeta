// Batch 0b: public job and news payloads must not leak employer or author
// contact data, or employer registration data, to people who should not have it.

jest.mock("../models/JobVacancy", () => ({ findById: jest.fn() }));
jest.mock("../models/JobApplication", () => ({}));
jest.mock("../models/User", () => ({}));
jest.mock("../models/JobseekerDocument", () => ({}));
jest.mock("../models/JobseekerProfile", () => ({}));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/EmployerProfile", () => ({ findOne: jest.fn() }));
jest.mock("../models/Announcement", () => ({ find: jest.fn(), countDocuments: jest.fn(), findOne: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/storageService", () => ({}));
jest.mock("../utils/jobDisplay", () => ({
  getHomepageJobsPayload: jest.fn(),
  getApplicationCountMap: jest.fn().mockResolvedValue({}),
  getHiredCountMap: jest.fn().mockResolvedValue({}),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const EmployerProfile = require("../models/EmployerProfile");
const jobController = require("../controllers/jobController");

const makeJob = () => ({
  _id: "job1",
  slots: 1,
  employer: { _id: "emp1", isActive: true, name: "Acme", email: "hr@acme.com", phone: "09171112222" },
});
const jobDoc = () => {
  const obj = makeJob();
  return { _id: "job1", employer: obj.employer, toObject: () => ({ ...obj, employer: { ...obj.employer } }) };
};
const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});

const privateProfile = { tradeName: "Acme Trading", tin: "123-456", fax: "555", ownerName: "Owner", contactPersonName: "CP", contactPersonPosition: "HR" };

describe("GET /jobs/:id employer scrubbing", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    JobVacancy.findById.mockReturnValue({ populate: () => Promise.resolve(jobDoc()) });
    EmployerProfile.findOne.mockResolvedValue({ ...privateProfile });
    require("../utils/jobDisplay").getApplicationCountMap.mockResolvedValue({});
    require("../utils/jobDisplay").getHiredCountMap.mockResolvedValue({});
  });

  test("signed out: no employer email or phone, no registration data", async () => {
    const res = makeRes();
    await jobController.getJobById({ params: { id: "job1" }, user: undefined }, res);
    expect(res.statusCode).toBe(200);
    const json = JSON.stringify(res.body);
    ["hr@acme.com", "09171112222", "123-456", "contactPersonName", "ownerName", "fax"].forEach((s) => expect(json).not.toContain(s));
    expect(res.body.employer.profile.tradeName).toBe("Acme Trading");
  });

  test("signed-in jobseeker still gets contact but never registration data", async () => {
    const res = makeRes();
    await jobController.getJobById({ params: { id: "job1" }, user: { id: "s1", role: "jobseeker" } }, res);
    expect(res.body.employer.email).toBe("hr@acme.com");
    expect(JSON.stringify(res.body)).not.toContain("123-456");
  });

  test("the employer themself sees their full data", async () => {
    const res = makeRes();
    await jobController.getJobById({ params: { id: "job1" }, user: { id: "emp1", role: "employer" } }, res);
    expect(res.body.employer.profile.tin).toBe("123-456");
  });
});

describe("news author populate", () => {
  test("list and detail populate author name only", async () => {
    const Announcement = require("../models/Announcement");
    const populate = jest.fn().mockReturnThis();
    const chainObj = { populate, sort: () => chainObj, skip: () => chainObj, limit: () => Promise.resolve([]) };
    Announcement.countDocuments.mockResolvedValue(0);
    Announcement.find.mockReturnValue(chainObj);
    const newsController = require("../controllers/newsController");
    await newsController.listNews({ query: {}, user: undefined }, makeRes());
    expect(populate).toHaveBeenCalledWith("author", "name");
    expect(populate).not.toHaveBeenCalledWith("author", "name email");

    const detailPopulate = jest.fn().mockResolvedValue(null);
    Announcement.findOne.mockReturnValue({ populate: detailPopulate });
    await newsController.getNewsById({ params: { id: "n1" }, user: undefined }, makeRes());
    expect(detailPopulate).toHaveBeenCalledWith("author", "name");
  });
});
