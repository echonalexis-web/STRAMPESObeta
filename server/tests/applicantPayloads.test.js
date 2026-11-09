// Batch 0c: applicant lists must not carry NSRP numbers, ID or resume file refs
// from the account, or anything beyond name and application data for a hidden profile.

jest.mock("../models/JobVacancy", () => ({ findById: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ find: jest.fn() }));
jest.mock("../models/JobseekerProfile", () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/User", () => ({}));
jest.mock("../models/Follow", () => ({}));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../models/ContactShare", () => ({}));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));

const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const JobseekerProfile = require("../models/JobseekerProfile");
const employerController = require("../controllers/employerController");

const makeApp = (applicant, extra = {}) => {
  const obj = { _id: "app1", vacancy: "job1", resume: "applications/resume.pdf", status: "pending", applicant, ...extra };
  return { applicant, toObject: () => ({ ...obj, applicant: { ...applicant } }) };
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
const profileDoc = (userId) => ({
  userId,
  tin: "111",
  sssGsisNo: "222",
  pagibigNo: "333",
  philhealthNo: "444",
  passportNo: "555",
  permanentAddress: "secret street",
  presentAddress: { street: "12 Rizal", municipality: "Marilao", province: "Bulacan" },
  course: "BSBA",
});

describe("getApplicantsForJob", () => {
  const run = async (applicant, extra) => {
    JobVacancy.findById.mockResolvedValue({ _id: "job1", employer: "emp1" });
    const populate = jest.fn().mockReturnValue({ sort: () => Promise.resolve([makeApp(applicant, extra)]) });
    JobApplication.find.mockReturnValue({ populate });
    JobseekerProfile.find.mockResolvedValue([profileDoc(applicant._id)]);
    const res = makeRes();
    await employerController.getApplicantsForJob({ user: { id: "emp1", _id: "emp1" }, params: { jobId: "job1" } }, res);
    return { res, populate };
  };
  beforeEach(() => jest.resetAllMocks());

  test("does not populate resume, resume file or ID file from the account", async () => {
    const { populate } = await run({ _id: "u1", name: "Ana", email: "a@x.com", phone: "0917", skills: ["pos"], isActive: true });
    const fields = populate.mock.calls[0][1];
    ["resume", "resumeFile", "validIdFile"].forEach((f) => expect(fields.split(" ")).not.toContain(f));
  });

  test("NSRP numbers and exact address are absent, application resume stays", async () => {
    const { res } = await run({ _id: "u1", name: "Ana", email: "a@x.com", phone: "0917", skills: ["pos"], isActive: true, resumeFile: "r", validIdFile: "id" });
    const json = JSON.stringify(res.body);
    ["tin", "sssGsisNo", "pagibigNo", "philhealthNo", "passportNo", "permanentAddress", "validIdFile", "resumeFile", "Rizal"].forEach((k) => expect(json).not.toContain(k));
    expect(res.body[0].resume).toBe("applications/resume.pdf");
    expect(res.body[0].applicant.email).toBe("a@x.com");
    expect(res.body[0].applicant.address).toBe("Marilao, Bulacan");
  });

  test("hidden profile: name and contact only, no skills, no profile, no avatar", async () => {
    const { res } = await run({ _id: "u1", name: "Ana", email: "a@x.com", phone: "0917", skills: ["pos"], isActive: true, profileImage: "/p.webp", privacy: { profileVisibility: "hidden" } });
    const a = res.body[0].applicant;
    expect(Object.keys(a).sort()).toEqual(["_id", "email", "isActive", "name", "phone"]);
  });

  test("hidden profile with includePhoto shows only the avatar extra", async () => {
    const { res } = await run(
      { _id: "u1", name: "Ana", email: "a@x.com", phone: "0917", isActive: true, profileImage: "/p.webp", privacy: { profileVisibility: "hidden" } },
      { includePhoto: true }
    );
    expect(res.body[0].applicant.profileImage).toBe("/p.webp");
    expect(res.body[0].applicant.skills).toBeUndefined();
  });
});
