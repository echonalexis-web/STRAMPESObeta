const { validateUserUpdate } = require("../middleware/validation");

// mock-defense items 14/15 remainder (LOOP.md): civilStatus gained an "Other,
// please specify" escape hatch mirroring governmentIdTypeOther. These tests
// exercise validateUserUpdate (server/middleware/validation.js) directly —
// it's a pure function (no DB access; its one Mongoose-backed call,
// User.normalizeCompanySize, is a pure static with no query), so no
// Mongoose model mocking is needed here.
//
// A pre-existing drift bug was spotted in the same allow-list while
// implementing the "Other" item above (missing "Live-in"/"Prefer not to
// say", and no truthy-guard for a blank/cleared civilStatus); it was
// deliberately left unfixed in that cycle (tracked separately in LOOP.md)
// and is now fixed and covered by the "regression-finding" describe block
// below.
const buildReq = (overrides = {}) => ({
  body: {},
  user: { role: "jobseeker" },
  ...overrides,
});

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("validateUserUpdate: civilStatus 'Other' + civilStatusOther", () => {
  test("civilStatus 'Other' with civilStatusOther provided passes", () => {
    const req = buildReq({ body: { civilStatus: "Other", civilStatusOther: "Domestic partnership" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("civilStatus 'Other' with civilStatusOther missing is rejected", () => {
    const req = buildReq({ body: { civilStatus: "Other" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.errors).toContain("Please specify your civil status");
  });

  test("civilStatus 'Other' with civilStatusOther as blank/whitespace is rejected", () => {
    const req = buildReq({ body: { civilStatus: "Other", civilStatusOther: "   " } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("an unrecognized civilStatus value is still rejected", () => {
    const req = buildReq({ body: { civilStatus: "Engaged" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.errors).toContain("Invalid civil status");
  });

  test("civilStatus checks are skipped entirely for an employer account", () => {
    const req = buildReq({ user: { role: "employer" }, body: { civilStatus: "Other" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    // No civilStatusOther required-when-Other check runs for an employer —
    // the whole civilStatus block is gated on role === 'jobseeker' (|| no
    // req.user at all).
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("validateUserUpdate: civilStatus regression-finding (Live-in / Prefer not to say / blank)", () => {
  test("civilStatus 'Live-in' passes", () => {
    const req = buildReq({ body: { civilStatus: "Live-in" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("civilStatus 'Prefer not to say' passes", () => {
    const req = buildReq({ body: { civilStatus: "Prefer not to say" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("an explicitly blank/cleared civilStatus is treated as not-provided (no error)", () => {
    const req = buildReq({ body: { civilStatus: "" } });
    const res = buildRes();
    const next = jest.fn();

    validateUserUpdate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
