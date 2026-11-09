// Phone format check, the apply guards (phone + daily cap), and the per-account
// budgets. Mocked models, no database.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobApplication", () => ({ countDocuments: jest.fn(), findOne: jest.fn() }));
jest.mock("../models/RateLimitCounter", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const User = require("../models/User");
const JobApplication = require("../models/JobApplication");
const { normalizePhone, isValidPhone, phoneProblem } = require("../utils/phone");
const vectors = require("./fixtures/phoneVectors.json");
const { requireApplyPhone, requireApplyBudget } = require("../middleware/applyGuards");
const { buildAccountBudget } = require("../middleware/accountBudget");
const { flagSwitch } = require("../middleware/signupFlag");

const run = async (mw, req) => {
  const res = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  const next = jest.fn();
  await mw(req, res, next);
  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME_SIGNUP_ENABLED = "true";
  delete process.env.JOB_APPLY_DAILY_CAP;
  delete process.env.DISABLE_RATE_LIMITS;
});
afterAll(() => {
  delete process.env.USERNAME_SIGNUP_ENABLED;
});

describe("phone format", () => {
  test.each(vectors.valid)("valid: %s", (value) => {
    expect(isValidPhone(value)).toBe(true);
    expect(phoneProblem(value)).toBeNull();
  });

  test.each(vectors.invalid)("invalid: %j", (value) => {
    expect(isValidPhone(value)).toBe(false);
  });

  test("normalizes every mobile form to 09XXXXXXXXX", () => {
    for (const v of ["09171234567", "+639171234567", "639171234567", "9171234567", "0917 123 4567"]) {
      expect(normalizePhone(v)).toBe("09171234567");
    }
  });

  test("empty is PHONE_REQUIRED, present but wrong is PHONE_INVALID", () => {
    expect(phoneProblem("")).toBe("PHONE_REQUIRED");
    expect(phoneProblem(null)).toBe("PHONE_REQUIRED");
    expect(phoneProblem(undefined)).toBe("PHONE_REQUIRED");
    expect(phoneProblem("12345")).toBe("PHONE_INVALID");
  });
});

describe("requireApplyPhone", () => {
  const withPhone = (phone) => User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ phone }) });
  const req = { user: { id: "u1", role: "jobseeker" } };

  test("a valid phone passes", async () => {
    withPhone("09171234567");
    const { next } = await run(requireApplyPhone, req);
    expect(next).toHaveBeenCalledWith();
  });

  test("no phone -> 400 PHONE_REQUIRED; bad phone -> 400 PHONE_INVALID (not a crash, an answer the client can act on)", async () => {
    withPhone(null);
    const missing = await run(requireApplyPhone, req);
    expect(missing.res.statusCode).toBe(400);
    expect(missing.res.body).toMatchObject({ code: "PHONE_REQUIRED", field: "phone" });
    expect(missing.next).not.toHaveBeenCalled();

    withPhone("12345");
    const bad = await run(requireApplyPhone, req);
    expect(bad.res.body.code).toBe("PHONE_INVALID");
  });

  test("flag off: no check at all", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const { next } = await run(requireApplyPhone, req);
    expect(next).toHaveBeenCalledWith();
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("employers and admins are not affected", async () => {
    const { next } = await run(requireApplyPhone, { user: { id: "e1", role: "employer" } });
    expect(next).toHaveBeenCalledWith();
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("a database error is passed on, never swallowed into a pass", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("down")) });
    const { next } = await run(requireApplyPhone, req);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("requireApplyBudget (daily cap on applications)", () => {
  const req = { user: { id: "u1", role: "jobseeker" } };
  const oldestAt = (hoursAgo) => ({ select: jest.fn().mockResolvedValue({ createdAt: new Date(Date.now() - hoursAgo * 3600000) }) });

  test("under the default cap of 20 passes", async () => {
    JobApplication.countDocuments.mockResolvedValue(19);
    const { next } = await run(requireApplyBudget, req);
    expect(next).toHaveBeenCalledWith();
  });

  test("the 21st application in 24 hours -> 429 APPLY_DAILY_LIMIT with the time until the oldest leaves the window", async () => {
    JobApplication.countDocuments.mockResolvedValue(20);
    JobApplication.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue(oldestAt(23)) });
    const { res, next } = await run(requireApplyBudget, req);
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("APPLY_DAILY_LIMIT");
    expect(res.body.retryAfter).toBeGreaterThan(3500);
    expect(res.body.retryAfter).toBeLessThanOrEqual(3600);
    expect(res.headers["Retry-After"]).toBe(String(res.body.retryAfter));
    expect(next).not.toHaveBeenCalled();
  });

  test("counts the last 24 hours and includes withdrawn applications (no status filter)", async () => {
    JobApplication.countDocuments.mockResolvedValue(0);
    await run(requireApplyBudget, req);
    const filter = JobApplication.countDocuments.mock.calls[0][0];
    expect(filter.applicant).toBe("u1");
    expect(filter).not.toHaveProperty("status");
    const ageMs = Date.now() - filter.createdAt.$gte.getTime();
    expect(Math.abs(ageMs - 24 * 3600000)).toBeLessThan(5000);
  });

  test("JOB_APPLY_DAILY_CAP changes the limit; an invalid value falls back to 20", async () => {
    process.env.JOB_APPLY_DAILY_CAP = "3";
    JobApplication.countDocuments.mockResolvedValue(3);
    JobApplication.findOne.mockReturnValue({ sort: jest.fn().mockReturnValue(oldestAt(1)) });
    expect((await run(requireApplyBudget, req)).res.statusCode).toBe(429);

    process.env.JOB_APPLY_DAILY_CAP = "abc";
    JobApplication.countDocuments.mockResolvedValue(19);
    expect((await run(requireApplyBudget, req)).next).toHaveBeenCalledWith();
    process.env.JOB_APPLY_DAILY_CAP = "-4";
    expect((await run(requireApplyBudget, req)).next).toHaveBeenCalledWith();
  });

  test("each account has its own count", async () => {
    JobApplication.countDocuments.mockResolvedValue(0);
    await run(requireApplyBudget, { user: { id: "u1", role: "jobseeker" } });
    await run(requireApplyBudget, { user: { id: "u2", role: "jobseeker" } });
    expect(JobApplication.countDocuments.mock.calls.map(([f]) => f.applicant)).toEqual(["u1", "u2"]);
  });

  test("flag off: no cap and no query", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const { next } = await run(requireApplyBudget, req);
    expect(next).toHaveBeenCalledWith();
    expect(JobApplication.countDocuments).not.toHaveBeenCalled();
  });
});

describe("buildAccountBudget (per-account, database counters)", () => {
  const fakeModel = () => {
    const docs = new Map();
    return {
      findOneAndUpdate: jest.fn(async ({ _id }, update) => {
        const doc = docs.get(_id) || { _id, count: 0 };
        doc.count += update.$inc.count;
        docs.set(_id, doc);
        return { ...doc };
      }),
    };
  };
  const make = (extra = {}) =>
    buildAccountBudget({
      name: "t",
      windowMs: 60000,
      defaultMax: 2,
      code: "TEST_LIMIT",
      message: "Too many.",
      model: fakeModel(),
      ...extra,
    });

  test("allows up to the limit, then 429 with the code and the time left", async () => {
    const budget = make();
    const req = { user: { id: "u1" } };
    expect((await run(budget, req)).next).toHaveBeenCalledWith();
    expect((await run(budget, req)).next).toHaveBeenCalledWith();
    const third = await run(budget, req);
    expect(third.res.statusCode).toBe(429);
    expect(third.res.body).toMatchObject({ code: "TEST_LIMIT" });
    expect(third.res.body.retryAfter).toBeGreaterThan(0);
    expect(third.res.body.retryAfter).toBeLessThanOrEqual(60);
  });

  test("keyed by ACCOUNT, not IP: two accounts on one IP each get their own budget", async () => {
    const budget = make({ defaultMax: 1 });
    expect((await run(budget, { ip: "1.1.1.1", user: { id: "a" } })).next).toHaveBeenCalledWith();
    expect((await run(budget, { ip: "1.1.1.1", user: { id: "b" } })).next).toHaveBeenCalledWith();
    expect((await run(budget, { ip: "1.1.1.1", user: { id: "a" } })).res.statusCode).toBe(429);
  });

  test("flag off: nothing is counted (unless alwaysOn)", async () => {
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    const model = fakeModel();
    const budget = buildAccountBudget({ name: "t", windowMs: 60000, defaultMax: 1, code: "X", message: "m", model });
    await run(budget, { user: { id: "a" } });
    await run(budget, { user: { id: "a" } });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();

    const always = buildAccountBudget({ name: "t", windowMs: 60000, defaultMax: 1, code: "X", message: "m", model, alwaysOn: true });
    await run(always, { user: { id: "a" } });
    expect((await run(always, { user: { id: "a" } })).res.statusCode).toBe(429);
  });

  test("onlyWithFiles counts only a request that carries a file", async () => {
    const budget = make({ defaultMax: 1, onlyWithFiles: true });
    const textOnly = { user: { id: "a" }, files: { resumeFile: [] } };
    for (let i = 0; i < 3; i += 1) expect((await run(budget, textOnly)).next).toHaveBeenCalledWith();
    const withFile = { user: { id: "a" }, files: { resumeFile: [{ originalname: "x" }] } };
    expect((await run(budget, withFile)).next).toHaveBeenCalledWith();
    expect((await run(budget, withFile)).res.statusCode).toBe(429);
    expect((await run(budget, { user: { id: "a" }, file: {} })).res.statusCode).toBe(429);
  });

  test("the environment variable sets the limit; a bad value falls back to the default", async () => {
    process.env.T_CAP = "3";
    const budget = make({ envName: "T_CAP", defaultMax: 1 });
    for (let i = 0; i < 3; i += 1) expect((await run(budget, { user: { id: "a" } })).next).toHaveBeenCalledWith();
    expect((await run(budget, { user: { id: "a" } })).res.statusCode).toBe(429);
    process.env.T_CAP = "zero";
    const fallback = make({ envName: "T_CAP", defaultMax: 1 });
    await run(fallback, { user: { id: "b" } });
    expect((await run(fallback, { user: { id: "b" } })).res.statusCode).toBe(429);
    delete process.env.T_CAP;
  });

  test("an unauthenticated request is passed through (auth runs first in the real chain)", async () => {
    const { next } = await run(make(), {});
    expect(next).toHaveBeenCalledWith();
  });

  test("DISABLE_RATE_LIMITS turns it into a no-op", async () => {
    process.env.DISABLE_RATE_LIMITS = "true";
    const budget = make({ defaultMax: 1 });
    for (let i = 0; i < 3; i += 1) expect((await run(budget, { user: { id: "a" } })).next).toHaveBeenCalledWith();
  });
});

describe("flagSwitch", () => {
  test("uses the first middleware while the flag is on and the second while it is off", () => {
    const on = jest.fn();
    const off = jest.fn();
    const sw = flagSwitch(on, off);
    sw({}, {}, () => {});
    expect(on).toHaveBeenCalledTimes(1);
    process.env.USERNAME_SIGNUP_ENABLED = "false";
    sw({}, {}, () => {});
    expect(off).toHaveBeenCalledTimes(1);
  });
});
