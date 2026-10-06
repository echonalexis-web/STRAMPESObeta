jest.mock("../controllers/employerRecommendationController", () => ({ getRankedApplicants: jest.fn() }));
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/NsrpTemplate", () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { PDFDocument, degrees } = require("pdf-lib");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const SystemSettings = require("../models/SystemSettings");
const NsrpTemplate = require("../models/NsrpTemplate");
const { logAuditEvent } = require("../services/auditService");
const { fillForm1, fillForm2, validateTemplate } = require("../services/nsrpFormService");

const OWNER = "111111111111111111111111";
const OTHER = "222222222222222222222222";
const JOB_ID = "333333333333333333333333";
const PAYLOAD = {
  title: "Updated job title", description: "A detailed description of the updated role.",
  location: "Boac, Marinduque", jobType: "Full-time", slots: 5,
  salaryMin: 12000, salaryMax: 25000,
  qualifications: [{ type: "skill", value: "Communication", optional: false }],
  minAge: 18, maxAge: 40, minExperienceYears: 1,
  languageRequirements: [{ language: "English", speak: true, required: true }],
};
const bundled = (form) => fs.readFileSync(path.join(__dirname, "../assets/templates", form === "form1"
  ? "NSRP-Form-1-Jobseeker-Reg-Form.pdf" : "NSRP-Form-2-Employer-Reg-Form.pdf"));

const app = express();
app.use(express.json());
app.use("/admin", require("../routes/adminRoutes"));
app.use("/employer", require("../routes/employerRoutes"));
app.use("/superadmin", require("../routes/superadminRoutes"));
let job;
let templates;

const auth = (role, id = OTHER) => {
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role, isActive: true, verificationStatus: "verified", tokenVersion: 0 }) });
  return "Bearer " + jwt.sign({ id }, process.env.JWT_SECRET);
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "local-test-secret";
  templates = {};
  NsrpTemplate.findOne.mockImplementation(({ form }) => ({ select: jest.fn().mockResolvedValue(templates[form] || null) }));
  NsrpTemplate.findOneAndUpdate.mockImplementation(async ({ form }, { $set }) => {
    templates[form] = { ...$set };
    return templates[form];
  });
  SystemSettings.getSingleton.mockResolvedValue({ requireEmployerVerification: true });
  job = { _id: JOB_ID, employer: OWNER, salaryMin: 10000, salaryMax: 20000,
    status: "active", isActive: true,
    save: jest.fn().mockResolvedValue(),
    toObject: function () { const { save, toObject, ...data } = this; return data; },
  };
  JobVacancy.findById.mockResolvedValue(job);
});

describe("job content editing authorization and audit", () => {
  test("employer is denied the admin endpoint before job lookup", async () => {
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth("employer")).send(PAYLOAD);
    expect(res.status).toBe(403);
    expect(JobVacancy.findById).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test.each(["admin", "superadmin"])("%s updates another employer's job with the real actor role", async (role) => {
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth(role)).send(PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: PAYLOAD.title, employer: OWNER, salaryMin: 12000, minAge: 18, slots: 5 });
    expect(res.body.qualifications[0].order).toBe(0);
    expect(res.body.languageRequirements[0].speak).toBe(true);
    expect(job.save).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: OTHER, actorRole: role, action: "admin.job.updated", targetId: JOB_ID }));
  });

  test("employer owner retains their edit route and distinct audit event", async () => {
    const res = await request(app).put("/employer/jobs/" + JOB_ID).set("Authorization", auth("employer", OWNER)).send(PAYLOAD);
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: OWNER, actorRole: "employer", action: "employer.job.updated" }));
  });

  test("another employer still cannot edit through the employer route", async () => {
    const res = await request(app).put("/employer/jobs/" + JOB_ID).set("Authorization", auth("employer")).send(PAYLOAD);
    expect(res.status).toBe(403);
    expect(job.save).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("missing jobs return 404", async () => {
    JobVacancy.findById.mockResolvedValue(null);
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth("admin")).send(PAYLOAD);
    expect(res.status).toBe(404);
  });

  test("admin route runs job and qualification validation", async () => {
    const authorization = auth("admin");
    expect((await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", authorization).send({ ...PAYLOAD, title: "bad" })).status).toBe(400);
    expect((await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", authorization).send({ ...PAYLOAD, qualifications: [{ type: "skill", value: "Valid", optional: "yes" }] })).status).toBe(400);
    expect(job.save).not.toHaveBeenCalled();
  });

  test("omitted salary and deadline fields preserve legacy content", async () => {
    job.salary = "Negotiable";
    job.salaryMin = null;
    job.salaryMax = null;
    job.applicationDeadline = "2026-09-01T16:00:00.000Z";
    const { salaryMin, salaryMax, ...payload } = PAYLOAD;
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth("admin")).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.salary).toBe("Negotiable");
    expect(res.body.applicationDeadline).toBe("2026-09-01T16:00:00.000Z");
  });

  test("explicit null clears salary and deadline fields", async () => {
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth("admin")).send({ ...PAYLOAD, salaryMin: null, salaryMax: null, applicationDeadline: null });
    expect(res.status).toBe(200);
    expect(res.body.salaryMin).toBeNull();
    expect(res.body.salaryMax).toBeNull();
    expect(res.body.salary).toBe("");
    expect(res.body.applicationDeadline).toBeNull();
  });

  test("shared salary validation rejects inverted effective ranges", async () => {
    const res = await request(app).put("/admin/jobs/" + JOB_ID).set("Authorization", auth("admin")).send({ ...PAYLOAD, salaryMin: 26000 });
    expect(res.status).toBe(400);
    expect(job.save).not.toHaveBeenCalled();
  });
});

describe("NSRP replacement validation and persistence", () => {
  test.each(["admin", "employer"])("%s cannot upload or download superadmin samples", async (role) => {
    const authorization = auth(role);
    expect((await request(app).put("/superadmin/system-settings/nsrp-templates/form1").set("Authorization", authorization).attach("template", bundled("form1"), "form.pdf")).status).toBe(403);
    expect((await request(app).get("/superadmin/system-settings/nsrp-templates/form1/sample").set("Authorization", authorization)).status).toBe(403);
    expect(NsrpTemplate.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects spoofed non-PDF uploads without changing an active template", async () => {
    templates.form1 = { data: bundled("form1") };
    const previous = templates.form1;
    const res = await request(app).put("/superadmin/system-settings/nsrp-templates/form1").set("Authorization", auth("superadmin")).attach("template", Buffer.from("this is not a PDF"), { filename: "fake.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(templates.form1).toBe(previous);
    expect(NsrpTemplate.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects malformed PDF bytes and missing files", async () => {
    await expect(validateTemplate("form1", Buffer.from("%PDF-invalid"))).rejects.toMatchObject({ status: 400 });
    const res = await request(app).put("/superadmin/system-settings/nsrp-templates/form1").set("Authorization", auth("superadmin"));
    expect(res.status).toBe(400);
  });

  test("rejects mismatched dimensions and leaves both active forms intact", async () => {
    templates.form1 = { data: bundled("form1") }; templates.form2 = { data: bundled("form2") };
    const previous1 = templates.form1, previous2 = templates.form2;
    const doc = await PDFDocument.load(bundled("form1"));
    doc.getPage(1).setSize(400, 500);
    const res = await request(app).put("/superadmin/system-settings/nsrp-templates/form1").set("Authorization", auth("superadmin")).attach("template", Buffer.from(await doc.save()), "wrong.pdf");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/dimensions/);
    expect(templates.form1).toBe(previous1); expect(templates.form2).toBe(previous2);
    expect(NsrpTemplate.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects changed page count, rotation and crop box", async () => {
    const doc = await PDFDocument.load(bundled("form1"));
    doc.removePage(1);
    await expect(validateTemplate("form1", Buffer.from(await doc.save()))).rejects.toMatchObject({ status: 400 });
    const rotated = await PDFDocument.load(bundled("form2"));
    rotated.getPage(0).setRotation(degrees(90));
    await expect(validateTemplate("form2", Buffer.from(await rotated.save()))).rejects.toMatchObject({ status: 400 });
    const cropped = await PDFDocument.load(bundled("form1"));
    cropped.getPage(0).setCropBox(10, 10, 400, 500);
    await expect(validateTemplate("form1", Buffer.from(await cropped.save()))).rejects.toMatchObject({ status: 400 });
  });

  test.each(["form1", "form2"])("%s replacement is used by subsequent fills and returns a sample", async (form) => {
    const other = form === "form1" ? "form2" : "form1";
    templates[other] = { data: bundled(other) };
    const previous = templates[other];
    const doc = await PDFDocument.load(bundled(form));
    doc.setTitle("Custom " + form);
    doc.getPage(0).drawText("CUSTOM TEMPLATE MARKER", { x: 20, y: 20, size: 8 });
    const candidate = Buffer.from(await doc.save());
    const res = await request(app).put("/superadmin/system-settings/nsrp-templates/" + form).set("Authorization", auth("superadmin")).attach("template", candidate, "replacement.pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect((await PDFDocument.load(res.body)).getTitle()).toBe("Custom " + form);
    const output = form === "form1" ? await fillForm1({}, { name: "Test Jobseeker" }) : await fillForm2({}, { companyName: "Test Employer" });
    const filled = await PDFDocument.load(output);
    expect(filled.getTitle()).toBe("Custom " + form);
    expect(filled.getPageCount()).toBe(2);
    expect(templates[form].data.equals(candidate)).toBe(true);
    expect(templates[other]).toBe(previous);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "superadmin.nsrp_template.updated", actorRole: "superadmin", targetId: form }));
    const sample = await request(app).get("/superadmin/system-settings/nsrp-templates/" + form + "/sample").set("Authorization", auth("superadmin"));
    expect(sample.status).toBe(200);
    expect((await PDFDocument.load(sample.body)).getTitle()).toBe("Custom " + form);
  });

  test("a database failure fails export instead of silently reverting the form", async () => {
    NsrpTemplate.findOne.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("database unavailable")) });
    await expect(fillForm1({}, { name: "Test" })).rejects.toThrow("database unavailable");
  });
});
