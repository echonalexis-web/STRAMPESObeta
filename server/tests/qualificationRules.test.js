// Personal skills are always preferred on save; documents can be required or
// preferred and may carry a group. Stored postings still load unchanged.

jest.mock("../models/JobVacancy", () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock("../models/JobApplication", () => ({}));
jest.mock("../models/JobseekerProfile", () => ({}));
jest.mock("../models/User", () => ({}));
jest.mock("../models/Follow", () => ({}));
jest.mock("../models/Message", () => ({}));
jest.mock("../models/SystemSettings", () => ({}));
jest.mock("../models/ContactShare", () => ({}));
jest.mock("../models/QualificationTemplate", () => ({ countDocuments: jest.fn(), findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../controllers/messageController", () => ({ ensureConversationBetweenUsers: jest.fn() }));

const fs = require("fs");
const path = require("path");
const JobVacancy = require("../models/JobVacancy");
const QualificationTemplate = require("../models/QualificationTemplate");
const employerController = require("../controllers/employerController");
const templateController = require("../controllers/qualificationTemplateController");
const { normalizeQualificationItem, normalizeQualificationList } = require("../utils/qualificationRules");

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

const ITEMS = [
  { type: "skill", value: "Communication", optional: false },
  { type: "other", value: "Teamwork", optional: false },
  { type: "skill", value: "Welding", optional: true },
  { type: "certification", value: "TESDA National Certificate (NC II)", optional: false, group: "tesda" },
  { type: "license", value: "PRC Professional License", optional: true },
  { type: "certification", value: "NBI Clearance", optional: false, group: "clearance" },
  { type: "certification", value: "Custom paper", optional: false, group: "nonsense" },
];

describe("normalizeQualificationItem", () => {
  test("a personal skill is forced to preferred", () => {
    expect(normalizeQualificationItem({ type: "skill", value: "x", optional: false }).optional).toBe(true);
    expect(normalizeQualificationItem({ type: "other", value: "x" }).optional).toBe(true);
    expect(normalizeQualificationItem({ type: "", value: "x", optional: false }).optional).toBe(true);
  });
  test("documents keep their level and a valid group; an invalid group is dropped", () => {
    expect(normalizeQualificationItem({ type: "certification", value: "a", optional: false, group: "clearance" })).toEqual({ type: "certification", value: "a", optional: false, group: "clearance" });
    expect(normalizeQualificationItem({ type: "license", value: "a", optional: true }).optional).toBe(true);
    expect("group" in normalizeQualificationItem({ type: "license", value: "a", group: "zzz" })).toBe(false);
  });
  test("a group on a personal skill is dropped; non-arrays pass through", () => {
    expect("group" in normalizeQualificationItem({ type: "skill", value: "a", group: "tesda" })).toBe(false);
    expect(normalizeQualificationList(undefined)).toBeUndefined();
  });
});

describe("createJob / updateJob", () => {
  const employerReq = (body, params = {}) => ({ user: { _id: "emp1" }, body, params, headers: {}, ip: "1.1.1.1" });

  test("create: personal skills are saved as preferred, documents keep their level", async () => {
    JobVacancy.create.mockImplementation(async (doc) => ({ _id: "j1", title: doc.title, toObject: () => ({ ...doc }) }));
    const res = makeRes();
    await employerController.createJob(employerReq({ title: "Cook", location: "Boac", description: "d", qualifications: JSON.stringify(ITEMS) }), res);
    expect(res.statusCode).toBe(201);
    const saved = JobVacancy.create.mock.calls[0][0].qualifications;
    saved.filter((q) => ["skill", "other"].includes(q.type)).forEach((q) => expect(q.optional).toBe(true));
    expect(saved.find((q) => q.value === "TESDA National Certificate (NC II)")).toMatchObject({ optional: false, group: "tesda" });
    expect(saved.find((q) => q.value === "PRC Professional License").optional).toBe(true);
    expect(saved.find((q) => q.value === "NBI Clearance")).toMatchObject({ optional: false, group: "clearance" });
    expect("group" in saved.find((q) => q.value === "Custom paper")).toBe(false);
  });

  test("update: personal skills are saved as preferred", async () => {
    const job = { employer: "emp1", save: jest.fn(), toObject: () => ({ ...job }) };
    JobVacancy.findById.mockResolvedValue(job);
    const res = makeRes();
    await employerController.updateJob(employerReq({ qualifications: ITEMS }, { id: "j1" }), res);
    expect(job.qualifications.filter((q) => ["skill", "other"].includes(q.type)).every((q) => q.optional === true)).toBe(true);
    expect(job.qualifications.find((q) => q.value === "NBI Clearance").optional).toBe(false);
  });
});

describe("saved templates", () => {
  test("create: a template's personal skills are saved as preferred", async () => {
    QualificationTemplate.countDocuments.mockResolvedValue(0);
    QualificationTemplate.findOne.mockResolvedValue(null);
    QualificationTemplate.findOneAndUpdate.mockImplementation(async (_q, doc) => ({ _id: "t1", ...doc }));
    const res = makeRes();
    await templateController.createTemplate({ user: { _id: "emp1" }, body: { name: "Kitchen", items: ITEMS } }, res);
    const items = QualificationTemplate.findOneAndUpdate.mock.calls[0][1].items;
    items.filter((q) => ["skill", "other"].includes(q.type)).forEach((q) => expect(q.optional).toBe(true));
    expect(items.find((q) => q.value === "NBI Clearance")).toMatchObject({ optional: false, group: "clearance" });
  });
});

describe("stored data and mounts", () => {
  test("a stored posting with a required personal skill is not rewritten by reading (no read-path rule)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../utils/qualificationRules.js"), "utf8");
    expect(src).toMatch(/Only the SAVE paths use this/);
    const read = fs.readFileSync(path.join(__dirname, "../controllers/jobController.js"), "utf8");
    expect(read).not.toContain("qualificationRules");
  });
  test("the employer routes (job create/update, templates) are mounted on /api and /api/v1", () => {
    const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    expect(src).toContain("app.use(`${basePath}/employer`, employerRoutes)");
    expect(src).toContain('mountApiRoutes("/api/v1")');
    expect(src).toContain('mountApiRoutes("/api")');
  });
});
