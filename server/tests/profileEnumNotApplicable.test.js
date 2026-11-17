// "Not applicable" options for students and non-graduates. No DB: the schema
// enums are checked through validateSync, the validator through a fake req/res.
const {
  WORK_EXPERIENCE_VALUES,
  EMPLOYMENT_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  UNEMPLOYMENT_REASON_VALUES,
} = require("../utils/enumValues");
const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const { validateUserUpdate } = require("../middleware/validation");

const run = (body, role = "jobseeker") => {
  const req = { body, user: { role } };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const next = jest.fn();
  validateUserUpdate(req, res, next);
  return { res, next };
};

describe("shared lists", () => {
  test("new values are added and every old value is still there", () => {
    expect(WORK_EXPERIENCE_VALUES).toEqual(expect.arrayContaining(["Fresh Graduate", "Less than 1 year", "1–3 years", "3–5 years", "5+ years", "Not applicable"]));
    expect(EMPLOYMENT_STATUS_VALUES).toEqual(expect.arrayContaining(["employed", "unemployed", "Prefer not to say", "not_applicable"]));
    expect(EMPLOYMENT_TYPE_VALUES).toEqual(["wage", "self"]);
    expect(UNEMPLOYMENT_REASON_VALUES).toEqual(expect.arrayContaining([
      "fresh_grad", "finished_contract", "resigned", "retired", "laidoff_local", "laidoff_abroad", "lost_informal_work", "not_applicable",
    ]));
  });
});

describe("schema enums use the shared lists", () => {
  test("User.workExperience accepts Not applicable and rejects junk", () => {
    const ok = new User({ name: "A B", workExperience: "Not applicable" }).validateSync(["workExperience"]);
    expect(ok).toBeUndefined();
    const bad = new User({ name: "A B", workExperience: "10 years" }).validateSync(["workExperience"]);
    expect(bad).toBeDefined();
  });

  test("JobseekerProfile status and reason accept not_applicable", () => {
    const id = "64b000000000000000000001";
    const doc = new JobseekerProfile({ userId: id, employmentStatus: "not_applicable", unemploymentReason: "not_applicable" });
    expect(doc.validateSync(["employmentStatus", "unemploymentReason"])).toBeUndefined();
    const old = new JobseekerProfile({ userId: id, employmentStatus: "unemployed", unemploymentReason: "fresh_grad" });
    expect(old.validateSync(["employmentStatus", "unemploymentReason"])).toBeUndefined();
    const bad = new JobseekerProfile({ userId: id, employmentStatus: "student" });
    expect(bad.validateSync(["employmentStatus"])).toBeDefined();
  });
});

describe("validateUserUpdate", () => {
  test("accepts the new status and reason, and every old value", () => {
    for (const body of [
      { employmentStatus: "not_applicable" },
      { employmentStatus: "unemployed", unemploymentReason: "not_applicable" },
      { employmentStatus: "unemployed", unemploymentReason: "fresh_grad" },
      { employmentStatus: "Prefer not to say" },
      { employmentStatus: "employed", employmentType: "wage" },
    ]) {
      const { res, next } = run(body);
      expect(res.statusCode).toBe(200);
      expect(next).toHaveBeenCalled();
    }
  });

  test("rejects an unknown status with a code and the field", () => {
    const { res, next } = run({ employmentStatus: "student" });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("ENUM_INVALID");
    expect(res.body.field).toBe("employmentStatus");
    expect(res.body.errors).toEqual(["Invalid employment status"]);
    expect(next).not.toHaveBeenCalled();
  });

  test("phone: valid legacy and international pass, bad ones return a code and field", () => {
    expect(run({ phone: "09125826297" }).res.statusCode).toBe(200);
    expect(run({ phone: "+14155552671" }).res.statusCode).toBe(200);
    const bad = run({ phone: "abc" });
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body).toEqual(expect.objectContaining({ code: "PHONE_BAD_CHARS", field: "phone", message: expect.any(String) }));
  });

  test("a jobseeker cannot use a landline as the primary phone; an employer can", () => {
    const seeker = run({ phone: "02 8123 4567" }, "jobseeker");
    expect(seeker.res.statusCode).toBe(400);
    expect(seeker.res.body.code).toBe("PHONE_PH_FORMAT");
    expect(run({ phone: "02 8123 4567" }, "employer").res.statusCode).toBe(200);
  });

  test("secondary mobile uses the same parser; empty and punctuation-only are ignored", () => {
    expect(run({ mobileSecondary: "917 123 4567" }).res.statusCode).toBe(200);
    expect(run({ mobileSecondary: "-" }).res.statusCode).toBe(200);
    expect(run({ mobileSecondary: "" }).res.statusCode).toBe(200);
    expect(run({ mobileSecondary: "12" }).res.body.field).toBe("mobileSecondary");
  });
});
