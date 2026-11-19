// White-box branch coverage for server/middleware/validation.js.
// Middleware are called directly with fake req/res objects.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect; see
// docs/WHITE_BOX_TEST_REPORT.md. If one starts failing because the code was
// fixed, update the expectation.

jest.mock("../models/User", () => ({
  // Mirrors the real helper closely enough for these branches: known bands pass
  // through, anything else comes back unchanged (and is then rejected).
  normalizeCompanySize: jest.fn((v) => (typeof v === "string" ? v.toLowerCase() : v)),
}));
jest.mock("../utils/passwordPolicy", () => ({ enforce: jest.fn(() => ({ ok: true })) }));

const { enforce } = require("../utils/passwordPolicy");
const v = require("../middleware/validation");

const run = (mw, req = {}) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  mw({ body: {}, query: {}, params: {}, ...req }, res, next);
  return { res, next, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

const STRONG = "Str0ng!Pass";
const ID24 = "507f1f77bcf86cd799439011";

beforeEach(() => {
  enforce.mockReset();
  enforce.mockReturnValue({ ok: true });
});

describe("sanitizeRequestBody", () => {
  test("WB-VAL-01 trims and strips script tags from strings", () => {
    const req = { body: { bio: "  <script>alert(1)</script>hello  " } };
    const { next } = run(v.sanitizeRequestBody, req);
    expect(next).toHaveBeenCalled();
    expect(req.body.bio).not.toContain("<script>");
    expect(req.body.bio.startsWith(" ")).toBe(false);
  });

  test.each(["password", "newPassword", "confirmPassword", "resetToken", "TOKEN", "emailCodeToken"])(
    "WB-VAL-02 never alters credential-like field %s",
    (key) => {
      const raw = '  <b>&"pw  ';
      const req = { body: { [key]: raw } };
      run(v.sanitizeRequestBody, req);
      expect(req.body[key]).toBe(raw);
    }
  );

  test("WB-VAL-03 sanitizes strings inside arrays and leaves non-strings alone", () => {
    const req = { body: { tags: ["<script>x</script>a", 5, null, { k: "<script>y</script>" }] } };
    run(v.sanitizeRequestBody, req);
    expect(req.body.tags[0]).not.toContain("<script>");
    expect(req.body.tags.slice(1, 3)).toEqual([5, null]);
    // objects inside a top-level array are NOT recursed into (only strings are)
    expect(req.body.tags[3]).toEqual({ k: "<script>y</script>" });
  });

  test("WB-VAL-04 recurses into nested objects, nested arrays and primitives", () => {
    const req = {
      body: { a: { s: " <script>x</script>t ", n: 1, arr: ["<script>z</script>q", 2], deep: { s: "<script>w</script>" }, nul: null } },
    };
    run(v.sanitizeRequestBody, req);
    expect(req.body.a.s).not.toContain("<script>");
    expect(req.body.a.s.startsWith(" ")).toBe(false);
    expect(req.body.a.n).toBe(1);
    expect(req.body.a.arr[0]).not.toContain("<script>");
    expect(req.body.a.arr[1]).toBe(2);
    expect(req.body.a.deep.s).not.toContain("<script>");
    expect(req.body.a.nul).toBeNull();
  });

  test("WB-VAL-05 numbers, booleans and null top-level values are untouched; missing body is fine", () => {
    const req = { body: { n: 3, b: false, z: null } };
    run(v.sanitizeRequestBody, req);
    expect(req.body).toEqual({ n: 3, b: false, z: null });
    const { next } = run(v.sanitizeRequestBody, { body: undefined });
    expect(next).toHaveBeenCalled();
  });
});

describe("sanitizeQueryParams", () => {
  test("WB-VAL-06 strips [ ] { } ( ) $ from string values and sanitizes the rest", () => {
    const req = { query: { q: "a[$ne]=b{x}(y)<script>1</script>", page: 2, list: ["a"] } };
    run(v.sanitizeQueryParams, req);
    expect(req.query.q).not.toMatch(/[\[\]{}()$]/);
    expect(req.query.q).not.toContain("<script>");
    expect(req.query.page).toBe(2);
    expect(req.query.list).toEqual(["a"]);
  });

  test("WB-VAL-07 missing query is fine", () => {
    expect(run(v.sanitizeQueryParams, { query: undefined }).next).toHaveBeenCalled();
  });
});

describe("validateMongoId / validateRequest", () => {
  test.each([
    [ID24, true],
    [ID24.toUpperCase(), true],
    [ID24.slice(1), false],
    [ID24 + "0", false],
    ["z".repeat(24), false],
    ["", false],
    [undefined, false],
    [`${ID24}\n`, false],
  ])("WB-VAL-08 id %p valid=%p", (id, valid) => {
    const { next, status, body } = run(v.validateMongoId("id"), { params: { id } });
    if (valid) expect(next).toHaveBeenCalled();
    else {
      expect(status).toBe(400);
      expect(body.message).toBe("Invalid id format");
    }
  });

  test("WB-VAL-09 custom param name appears in the message; default param is id", () => {
    expect(run(v.validateMongoId("jobId"), { params: { jobId: "x" } }).body.message).toBe("Invalid jobId format");
    expect(run(v.validateMongoId(), { params: { id: ID24 } }).next).toHaveBeenCalled();
  });

  test("WB-VAL-10 validateRequest is a pass-through", () => {
    expect(run(v.validateRequest).next).toHaveBeenCalled();
  });
});

describe("validateUserUpdate: common fields", () => {
  const upd = (body, user) => run(v.validateUserUpdate, { body, user });

  test("WB-VAL-11 empty body passes", () => {
    expect(upd({}, { role: "admin" }).next).toHaveBeenCalled();
  });

  test.each([
    ["Jo", true],
    ["J", false],
    ["x".repeat(50), true],
    ["x".repeat(51), false],
    ["Jo3", false],
    ["O'Brien-Smith Jr", true],
    ["José", false],
  ])("WB-VAL-12 name %p ok=%p", (name, ok) => {
    const r = upd({ name }, { role: "admin" });
    expect(!!r.next.mock.calls.length).toBe(ok);
  });

  test("WB-VAL-13 name errors are all collected and message is the first", () => {
    const r = upd({ name: "1" }, { role: "admin" });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(2);
    expect(r.body.message).toBe(r.body.errors[0]);
  });

  test.each([
    ["", true],
    ["a@b.co", true],
    ["a@b", false],
    ["a b@c.com", false],
    ["plain", false],
  ])("WB-VAL-14 email %p ok=%p", (email, ok) => {
    expect(!!upd({ email }, { role: "admin" }).next.mock.calls.length).toBe(ok);
  });

  test.each([
    ["", true],
    ["09171234567", true],
    ["+63 917-123-4567", true],
    ["123456789", false],
    ["1".repeat(21), false],
    ["0917abc4567", false],
  ])("WB-VAL-15 phone %p ok=%p", (phone, ok) => {
    expect(!!upd({ phone }, { role: "admin" }).next.mock.calls.length).toBe(ok);
  });

  test("WB-VAL-16 address (200) and bio (500) boundaries", () => {
    expect(upd({ address: "x".repeat(200), bio: "x".repeat(500) }, { role: "admin" }).next).toHaveBeenCalled();
    expect(upd({ address: "x".repeat(201) }, { role: "admin" }).body.message).toBe("Address is too long");
    expect(upd({ bio: "x".repeat(501) }, { role: "admin" }).body.message).toBe("Bio cannot exceed 500 characters");
  });

  test("WB-VAL-17 KNOWN-ISSUE: name:null throws TypeError instead of returning 400 (a number is handled: 400 via the regex)", () => {
    expect(upd({ name: 123 }, { role: "admin" }).status).toBe(400);
    expect(() => upd({ name: null }, { role: "admin" })).toThrow(TypeError);
  });

  test("WB-VAL-18 role gates: admin skips jobseeker and employer rules; no req.user runs both", () => {
    const body = { civilStatus: "Nope", tradeName: "x".repeat(101) };
    expect(upd(body, { role: "admin" }).next).toHaveBeenCalled();
    expect(upd(body, undefined).body.errors).toEqual(["Invalid civil status", "Trade name too long"]);
    expect(upd(body, { role: "jobseeker" }).body.errors).toEqual(["Invalid civil status"]);
    expect(upd(body, { role: "employer" }).body.errors).toEqual(["Trade name too long"]);
  });
});

describe("validateUserUpdate: jobseeker fields", () => {
  const js = (body) => run(v.validateUserUpdate, { body, user: { role: "jobseeker" } });
  const err = (body) => js(body).body?.message;

  test("WB-VAL-19 civil status allow-list, blank is 'not provided', Other needs a companion", () => {
    ["Divorced", "Live-in", "Married", "Separated", "Single", "Widowed", "Prefer not to say"].forEach((c) =>
      expect(js({ civilStatus: c }).next).toHaveBeenCalled()
    );
    expect(js({ civilStatus: "" }).next).toHaveBeenCalled();
    expect(err({ civilStatus: "single" })).toBe("Invalid civil status");
    expect(err({ civilStatus: "Other" })).toBe("Please specify your civil status");
    expect(err({ civilStatus: "Other", civilStatusOther: "   " })).toBe("Please specify your civil status");
    expect(js({ civilStatus: "Other", civilStatusOther: "Annulled" }).next).toHaveBeenCalled();
  });

  test("WB-VAL-20 length limits: place of birth 100, citizenship 50, 4Ps id 20, intent 200, laid-off country 50", () => {
    expect(js({ placeOfBirth: "x".repeat(100), citizenship: "x".repeat(50), _4psHouseholdId: "x".repeat(20), repatriationIntent: "x".repeat(200), laidoffCountry: "x".repeat(50) }).next).toHaveBeenCalled();
    expect(err({ placeOfBirth: "x".repeat(101) })).toBe("Place of birth too long");
    expect(err({ citizenship: "x".repeat(51) })).toBe("Citizenship too long");
    expect(err({ _4psHouseholdId: "x".repeat(21) })).toBe("4Ps household ID too long");
    expect(err({ repatriationIntent: "x".repeat(201) })).toBe("Repatriation intent too long");
    expect(err({ laidoffCountry: "x".repeat(51) })).toBe("Laid off country too long");
  });

  test.each([
    ["50", true], ["300", true], [49.9, false], [300.1, false], ["abc", false], ["", true], [170, true],
  ])("WB-VAL-21 height %p ok=%p", (height, ok) => {
    expect(!!js({ height }).next.mock.calls.length).toBe(ok);
  });

  test.each([
    ["10", true], ["500", true], [9, false], [501, false], ["x", false], [0, true],
  ])("WB-VAL-22 weight %p ok=%p", (weight, ok) => {
    expect(!!js({ weight }).next.mock.calls.length).toBe(ok);
  });

  test("WB-VAL-23 landline / secondary mobile: punctuation-only is 'not provided', malformed is rejected", () => {
    expect(js({ landline: "-", mobileSecondary: "n/a" }).next).toHaveBeenCalled();
    expect(js({ landline: "123-4567", mobileSecondary: "09171234567" }).next).toHaveBeenCalled();
    expect(err({ landline: "12345" })).toBe("Invalid landline format");
    expect(err({ landline: "1234567a" })).toBe("Invalid landline format");
    expect(err({ mobileSecondary: "12345" })).toBe("Enter a 10-digit mobile number that starts with 9.");
  });

  test("WB-VAL-24 disability must be an array of known values", () => {
    expect(js({ disability: ["Visual", "Others"] }).next).toHaveBeenCalled();
    expect(js({ disability: [] }).next).toHaveBeenCalled();
    expect(err({ disability: "Visual" })).toBe("Disability must be an array");
    expect(err({ disability: ["Visual", "Telepathy"] })).toBe("Invalid disability type");
    expect(js({ disability: null }).body.message).toBe("Disability must be an array");
  });

  test.each([
    ["is4psBeneficiary", "4Ps beneficiary must be a boolean"],
    ["isOfw", "OFW status must be a boolean"],
    ["isRepatriated", "Repatriated status must be a boolean"],
  ])("WB-VAL-25 %s accepts boolean or 'true'/'false' only", (field, message) => {
    [true, false, "true", "false"].forEach((x) => expect(js({ [field]: x }).next).toHaveBeenCalled());
    ["yes", 1, "TRUE", null].forEach((x) => expect(err({ [field]: x })).toBe(message));
  });

  test("WB-VAL-26 employment status / type / unemployment reason allow-lists", () => {
    expect(js({ employmentStatus: "employed", employmentType: "wage", unemploymentReason: "resigned" }).next).toHaveBeenCalled();
    expect(js({ employmentType: "", unemploymentReason: "" }).next).toHaveBeenCalled();
    expect(err({ employmentStatus: "" })).toBe("Invalid employment status");
    expect(err({ employmentType: "gig" })).toBe("Invalid employment type");
    expect(err({ unemploymentReason: "bored" })).toBe("Invalid unemployment reason");
  });
});

describe("validateUserUpdate: employer fields", () => {
  const em = (body) => run(v.validateUserUpdate, { body, user: { role: "employer" } });
  const err = (body) => em(body).body?.message;

  test("WB-VAL-27 trade name 100, acronym 20, owner/contact name/position 100", () => {
    expect(em({ tradeName: "x".repeat(100), acronym: "x".repeat(20), ownerName: "x".repeat(100), contactPersonName: "x".repeat(100), contactPersonPosition: "x".repeat(100) }).next).toHaveBeenCalled();
    expect(err({ tradeName: "x".repeat(101) })).toBe("Trade name too long");
    expect(err({ acronym: "x".repeat(21) })).toBe("Acronym too long");
    expect(err({ ownerName: "x".repeat(101) })).toBe("Owner name too long");
    expect(err({ contactPersonName: "x".repeat(101) })).toBe("Contact person name too long");
    expect(err({ contactPersonPosition: "x".repeat(101) })).toBe("Contact person position too long");
  });

  test.each([
    ["123456789", true], ["123-456-789-000", true], ["12345678", false], ["1234567890123", false], ["-", true], ["12a456789", false],
  ])("WB-VAL-28 TIN %p ok=%p", (tin, ok) => {
    expect(!!em({ tin }).next.mock.calls.length).toBe(ok);
  });

  test("WB-VAL-29 office type", () => {
    expect(em({ officeType: "main" }).next).toHaveBeenCalled();
    expect(em({ officeType: "branch" }).next).toHaveBeenCalled();
    expect(err({ officeType: "hq" })).toBe("Invalid office type");
  });

  test("WB-VAL-30 employer classification: shape, type and subtype pairing", () => {
    expect(err({ employerClassification: "public" })).toBe("Employer classification must be an object");
    expect(err({ employerClassification: { type: "other" } })).toBe("Invalid employer classification type");
    expect(em({ employerClassification: { type: "public", subtype: "LGU" } }).next).toHaveBeenCalled();
    expect(em({ employerClassification: { type: "private", subtype: "Direct Hire" } }).next).toHaveBeenCalled();
    expect(em({ employerClassification: { type: "public" } }).next).toHaveBeenCalled();
    expect(err({ employerClassification: { type: "public", subtype: "Direct Hire" } })).toBe("Invalid public subtype");
    expect(err({ employerClassification: { type: "private", subtype: "LGU" } })).toBe("Invalid private subtype");
    expect(err({ employerClassification: { subtype: "LGU" } })).toBe("Classification type required when subtype provided");
    expect(em({ employerClassification: null }).next).toHaveBeenCalled();
  });

  test("WB-VAL-31 workforce / company size bands", () => {
    ["micro", "small", "medium", "large", "MICRO"].forEach((s) =>
      expect(em({ totalWorkforceSize: s, companySize: s }).next).toHaveBeenCalled()
    );
    expect(err({ totalWorkforceSize: "huge" })).toBe("Invalid workforce size");
    expect(err({ companySize: "huge" })).toBe("Invalid company size");
    expect(em({ totalWorkforceSize: "", companySize: "" }).next).toHaveBeenCalled();
  });

  test("WB-VAL-32 fax: punctuation-only ignored, malformed rejected", () => {
    expect(em({ fax: "--" }).next).toHaveBeenCalled();
    expect(em({ fax: "02 123 4567" }).next).toHaveBeenCalled();
    expect(err({ fax: "123" })).toBe("Invalid fax format");
  });
});

describe("validatePasswordChange", () => {
  const pc = (body) => run(v.validatePasswordChange, { body });

  test("WB-VAL-33 valid change passes", () => {
    expect(pc({ currentPassword: "old", newPassword: STRONG, confirmPassword: STRONG }).next).toHaveBeenCalled();
  });

  test("WB-VAL-34 missing current password", () => {
    expect(pc({ newPassword: STRONG, confirmPassword: STRONG }).body.message).toBe("Current password is required");
  });

  test("WB-VAL-35 length boundary: 7 chars rejected, 8 chars (meeting complexity) accepted", () => {
    expect(pc({ currentPassword: "o", newPassword: "Aa1!aaa", confirmPassword: "Aa1!aaa" }).body.message).toBe("New password must be at least 8 characters");
    expect(pc({ currentPassword: "o", newPassword: "Aa1!aaaa", confirmPassword: "Aa1!aaaa" }).next).toHaveBeenCalled();
  });

  test.each([
    ["no uppercase", "str0ng!pass"],
    ["no lowercase", "STR0NG!PASS"],
    ["no digit", "Strong!Pass"],
    ["no special", "Str0ngPass1"],
  ])("WB-VAL-36 complexity: %s", (_n, pw) => {
    expect(pc({ currentPassword: "o", newPassword: pw, confirmPassword: pw }).body.errors).toContain(
      "Password must contain uppercase, lowercase, number, and special character"
    );
  });

  test("WB-VAL-37 mismatch and missing newPassword are both reported", () => {
    expect(pc({ currentPassword: "o", newPassword: STRONG, confirmPassword: STRONG + "x" }).body.message).toBe("Passwords do not match");
    expect(pc({ currentPassword: "o" }).body.errors).toContain("New password must be at least 8 characters");
  });
});

describe("validateUserRegistration", () => {
  const reg = (body, path = "/register") => run(v.validateUserRegistration, { body, path });
  const good = { name: "Juan Cruz", email: "j@x.com", password: STRONG };

  test("WB-VAL-38 valid registration passes and runs the password policy", () => {
    const r = reg(good);
    expect(r.next).toHaveBeenCalled();
    expect(enforce).toHaveBeenCalledWith(expect.objectContaining({ password: STRONG, usernameOnly: false }));
  });

  test("WB-VAL-39 name, email, password, phone errors", () => {
    const r = reg({ name: "J", email: "bad", password: "short", phone: "12" });
    expect(r.body.errors).toEqual(
      expect.arrayContaining([
        "Name must be between 2 and 50 characters",
        "Please provide a valid email",
        "Password must be at least 8 characters",
        "Enter a 10-digit mobile number that starts with 9.",
      ])
    );
    expect(enforce).not.toHaveBeenCalled();
  });

  test("WB-VAL-40 username mode on /register waives the email; on other paths it does not", () => {
    const body = { name: "Juan", password: STRONG, signupMode: "username", username: "juan" };
    expect(reg(body, "/register").next).toHaveBeenCalled();
    expect(enforce).toHaveBeenLastCalledWith(expect.objectContaining({ usernameOnly: true, username: "juan" }));
    expect(reg(body, "/register/employer").body.message).toBe("Please provide a valid email");
  });

  test("WB-VAL-41 policy failure surfaces its code and message", () => {
    enforce.mockReturnValue({ ok: false, code: "PASSWORD_COMMON", message: "Too common" });
    const r = reg(good);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: "PASSWORD_COMMON", errors: ["Too common"], message: "Too common" });
  });

  test("WB-VAL-42 no `code` key is sent for plain validation errors", () => {
    expect(reg({ ...good, name: "" }).body).not.toHaveProperty("code");
  });

  test("WB-VAL-43 KNOWN-ISSUE: non-string name with a numeric .length bypasses the name check", () => {
    // `{length: 5}` and arrays slip through because only .length is inspected.
    expect(reg({ ...good, name: ["a", "b", "c"] }).next).toHaveBeenCalled();
    expect(reg({ ...good, name: 12345 }).next).toHaveBeenCalled();
  });
});

describe("validateUserLogin", () => {
  const login = (body) => run(v.validateUserLogin, { body });

  test("WB-VAL-44 email, identifier and username paths", () => {
    expect(login({ email: "a@b.co", password: "x" }).next).toHaveBeenCalled();
    expect(login({ identifier: "juan_dc", password: "x" }).next).toHaveBeenCalled();
    expect(login({ identifier: "  juan  ", password: "x" }).next).toHaveBeenCalled();
  });

  test("WB-VAL-45 identifier is preferred over the email alias", () => {
    expect(login({ identifier: "juan", email: "bad@", password: "x" }).next).toHaveBeenCalled();
  });

  test("WB-VAL-46 missing / blank identifier and missing password", () => {
    expect(login({ password: "x" }).body.message).toBe("Please provide your email or username");
    expect(login({ identifier: "   ", password: "x" }).body.message).toBe("Please provide your email or username");
    expect(login({ identifier: "a" }).body.message).toBe("Password is required");
    expect(login({}).body.errors).toHaveLength(2);
  });

  test("WB-VAL-47 an identifier containing @ must look like an email", () => {
    expect(login({ identifier: "a@b", password: "x" }).body.message).toBe("Please provide a valid email");
  });
});

describe("validateJobApplication", () => {
  const app = (coverLetter) => run(v.validateJobApplication, { body: { coverLetter } });

  test("WB-VAL-48 absent, null and empty cover letter pass", () => {
    [undefined, null, "", "   "].forEach((c) => expect(app(c).next).toHaveBeenCalled());
  });

  test.each([
    [9, false], [10, true], [1000, true], [1001, false],
  ])("WB-VAL-49 cover letter of %i chars ok=%p", (n, ok) => {
    const r = app("a".repeat(n));
    expect(!!r.next.mock.calls.length).toBe(ok);
    if (!ok && n > 1000) expect(r.body.message).toContain("currently 1001");
  });

  test("WB-VAL-50 length is measured after trim", () => {
    expect(app("   short   ").body.message).toBe("Cover letter must be at least 10 characters");
  });

  test.each([
    "<script>x</script>", "javascript:void(0)", "x onerror=1 y", "x onload = 1 y", "<iframe src=x>", "<object data=x>", "<embed src=x>",
    "data:text/html,hi", "vbscript:x", "expression (1)", "x onclick=1 y", "x onmouseover=1 y", "alert (1) now", "eval (1) now", "document.cookie ok", "window.location ok",
  ])("WB-VAL-51 blocks suspicious content: %s", (text) => {
    const r = app(`I would love this job. ${text}`);
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Cover letter contains suspicious or malicious content");
  });

  test("WB-VAL-52 only one suspicious-content error is reported even with many matches", () => {
    expect(app("<script>alert(1)</script> document. window. eval(1)").body.errors).toHaveLength(1);
  });

  test("WB-VAL-53 KNOWN-ISSUE: a non-string cover letter throws TypeError instead of 400", () => {
    expect(() => app(12345)).toThrow(TypeError);
    expect(() => app({})).toThrow(TypeError);
  });
});

describe("validateMessage", () => {
  const msg = (body) => run(v.validateMessage, { body });

  test("WB-VAL-54 valid message passes", () => {
    expect(msg({ content: "hi", receiverId: ID24 }).next).toHaveBeenCalled();
  });

  test("WB-VAL-55 empty, whitespace and missing content", () => {
    ["", "   ", undefined].forEach((c) => expect(msg({ content: c, receiverId: ID24 }).body.message).toBe("Message content is required"));
  });

  test("WB-VAL-56 length boundary 2000 / 2001", () => {
    expect(msg({ content: "x".repeat(2000), receiverId: ID24 }).next).toHaveBeenCalled();
    expect(msg({ content: "x".repeat(2001), receiverId: ID24 }).body.message).toBe("Message too long");
  });

  test.each([undefined, "", "123", "z".repeat(24), ID24 + "0"])("WB-VAL-57 invalid receiver id %p", (receiverId) => {
    expect(msg({ content: "hi", receiverId }).body.message).toBe("Invalid receiver ID");
  });

  test("WB-VAL-58 KNOWN-ISSUE: non-string content throws TypeError instead of 400", () => {
    expect(() => msg({ content: 42, receiverId: ID24 })).toThrow(TypeError);
  });
});

describe("validateJobPosting", () => {
  const good = { title: "Welder", description: "d".repeat(20), location: "Pasig", jobType: "full-time" };
  const job = (extra = {}) => run(v.validateJobPosting, { body: { ...good, ...extra } });

  test("WB-VAL-59 valid job passes", () => {
    expect(job().next).toHaveBeenCalled();
  });

  test.each([
    ["title", { title: "abcd" }, "Title must be between 5 and 100 characters"],
    ["title max", { title: "x".repeat(101) }, "Title must be between 5 and 100 characters"],
    ["description", { description: "x".repeat(19) }, "Description must be between 20 and 5000 characters"],
    ["description max", { description: "x".repeat(5001) }, "Description must be between 20 and 5000 characters"],
    ["location", { location: "P" }, "Location is required and must be between 2 and 100 characters"],
    ["location max", { location: "x".repeat(101) }, "Location is required and must be between 2 and 100 characters"],
    ["jobType missing", { jobType: undefined }, "Invalid job type"],
    ["jobType non-string", { jobType: 5 }, "Invalid job type"],
    ["salary", { salary: "x".repeat(51) }, "Salary format too long"],
  ])("WB-VAL-60 %s", (_n, extra, message) => {
    expect(job(extra).body.errors).toContain(message);
  });

  test("WB-VAL-61 boundary values accepted: title 5/100, description 20/5000, location 2/100, salary 50", () => {
    expect(job({ title: "x".repeat(5), description: "x".repeat(5000), location: "xx", salary: "x".repeat(50) }).next).toHaveBeenCalled();
    expect(job({ title: "x".repeat(100), location: "x".repeat(100) }).next).toHaveBeenCalled();
  });

  test("WB-VAL-62 industry accepts a string or array of strings only", () => {
    expect(job({ industry: "IT" }).next).toHaveBeenCalled();
    expect(job({ industry: ["IT", "BPO"] }).next).toHaveBeenCalled();
    expect(job({ industry: ["IT", 5] }).body.errors).toContain("Industry must be a string or an array of strings");
    expect(job({ industry: 5 }).body.errors).toContain("Industry must be a string or an array of strings");
  });

  test("WB-VAL-63 work nature allow-list", () => {
    ["remote", "onsite", "hybrid"].forEach((w) => expect(job({ workNature: w }).next).toHaveBeenCalled());
    expect(job({ workNature: "Remote" }).body.errors).toContain("Invalid work nature");
  });

  test("WB-VAL-64 salary min/max must be numeric when present", () => {
    expect(job({ salaryMin: "15000", salaryMax: 20000 }).next).toHaveBeenCalled();
    expect(job({ salaryMin: "abc" }).body.errors).toContain("Salary minimum must be a number");
    expect(job({ salaryMax: "abc" }).body.errors).toContain("Salary maximum must be a number");
  });

  test("WB-VAL-65 qualifications: shape, allowed types, required value", () => {
    expect(job({ qualifications: [{ type: "skill", value: "welding" }] }).next).toHaveBeenCalled();
    expect(job({ qualifications: "x" }).body.errors).toContain("Qualifications must be an array");
    const r = job({ qualifications: [{ type: "bogus", value: "x" }, { type: "skill", value: "  " }, { type: "skill", value: 5 }, {}] });
    expect(r.body.errors).toEqual(
      expect.arrayContaining([
        "Qualification at index 0: invalid or missing type",
        "Qualification at index 1: value is required",
        "Qualification at index 2: value is required",
        "Qualification at index 3: invalid or missing type",
      ])
    );
  });

  test("WB-VAL-66 KNOWN-ISSUE: a null qualification entry throws TypeError instead of 400", () => {
    expect(() => job({ qualifications: [null] })).toThrow(TypeError);
  });
});

describe("validateQualifications", () => {
  const ql = (qualifications) => run(v.validateQualifications, { body: { qualifications } });

  test("WB-VAL-67 undefined passes through", () => {
    expect(run(v.validateQualifications, { body: {} }).next).toHaveBeenCalled();
  });

  test("WB-VAL-68 non-array is rejected with the field name", () => {
    const r = ql({});
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ message: "Qualifications must be an array", field: "qualifications" });
  });

  test("WB-VAL-69 valid list (including empty) passes", () => {
    expect(ql([]).next).toHaveBeenCalled();
    expect(ql([{ type: "license", value: "Driver", optional: true, order: 1 }]).next).toHaveBeenCalled();
  });

  test("WB-VAL-70 missing type vs invalid type give different messages", () => {
    expect(ql([{ value: "x" }]).body.errors).toContain('Qualification at index 0: "type" is required');
    expect(ql([{ type: "nope", value: "x" }]).body.errors[0]).toContain('invalid type "nope"');
  });

  test("WB-VAL-71 value rules: required, string, non-blank, max 500", () => {
    expect(ql([{ type: "skill" }]).body.errors[0]).toContain('"value" is required');
    expect(ql([{ type: "skill", value: "   " }]).body.errors[0]).toContain('"value" is required');
    expect(ql([{ type: "skill", value: "x".repeat(500) }]).next).toHaveBeenCalled();
    expect(ql([{ type: "skill", value: "x".repeat(501) }]).body.errors[0]).toContain("exceeds 500 characters");
  });

  test("WB-VAL-71b KNOWN-ISSUE: a non-string truthy value throws TypeError (q.value.trim) instead of returning 400", () => {
    expect(() => ql([{ type: "skill", value: 5 }])).toThrow(TypeError);
    expect(() => ql([{ type: "skill", value: {} }])).toThrow(TypeError);
  });

  test("WB-VAL-72 optional must be boolean and order must be number when present", () => {
    expect(ql([{ type: "skill", value: "x", optional: "yes" }]).body.errors[0]).toContain('"optional" must be a boolean');
    expect(ql([{ type: "skill", value: "x", order: "1" }]).body.errors[0]).toContain('"order" must be a number');
  });

  test("WB-VAL-73 errors from several entries accumulate with their indexes", () => {
    const r = ql([{ value: "x" }, { type: "skill", value: "x", order: "a" }]);
    expect(r.body.message).toBe("Invalid qualifications");
    expect(r.body.errors).toHaveLength(2);
  });
});

describe("validateAnnouncementPayload", () => {
  const ann = (body, method = "PUT") => run(v.validateAnnouncementPayload, { body, method });
  const create = { title: "Hello world", content: "c".repeat(20), category: "general" };

  test("WB-VAL-74 PUT with an empty body passes (partial update)", () => {
    expect(ann({}).next).toHaveBeenCalled();
  });

  test("WB-VAL-75 POST requires title, content and category", () => {
    expect(ann({}, "POST").body.errors).toEqual(["Title is required", "Content is required", "Category is required"]);
    expect(ann(create, "POST").next).toHaveBeenCalled();
  });

  test.each([
    [{ title: "abcd" }, false], [{ title: "abcde" }, true], [{ title: "x".repeat(180) }, true], [{ title: "x".repeat(181) }, false],
    [{ title: 12345 }, false], [{ title: "  abcd  " }, false],
    [{ content: "x".repeat(19) }, false], [{ content: "x".repeat(20) }, true], [{ content: "x".repeat(4000) }, true], [{ content: "x".repeat(4001) }, false],
    [{ content: {} }, false],
  ])("WB-VAL-76 %j ok=%p", (body, ok) => {
    expect(!!ann(body).next.mock.calls.length).toBe(ok);
  });

  test("WB-VAL-77 category allow-list", () => {
    ["general", "hiring", "training", "event", "advisory", "spes"].forEach((c) => expect(ann({ category: c }).next).toHaveBeenCalled());
    expect(ann({ category: "news" }).body.errors).toContain("Invalid category");
  });

  test("WB-VAL-78 imageUrl: empty/null ok, over 1000 or non-string invalid", () => {
    ["", null, "https://x/y.png"].forEach((u) => expect(ann({ imageUrl: u }).next).toHaveBeenCalled());
    expect(ann({ imageUrl: "x".repeat(1001) }).body.errors).toContain("Image URL is invalid");
    expect(ann({ imageUrl: 5 }).body.errors).toContain("Image URL is invalid");
  });

  test("WB-VAL-79 publishedAt: empty/null/valid ok, garbage invalid", () => {
    ["", null, "2026-11-16", "2026-11-16T10:00:00Z"].forEach((d) => expect(ann({ publishedAt: d }).next).toHaveBeenCalled());
    expect(ann({ publishedAt: "not a date" }).body.errors).toContain("Published date is invalid");
  });

  test("WB-VAL-80 isActive / commentsEnabled accept booleans and 'true'/'false' strings only", () => {
    [true, false, "true", "false"].forEach((x) => expect(ann({ isActive: x, commentsEnabled: x }).next).toHaveBeenCalled());
    expect(ann({ isActive: "yes" }).body.errors).toContain("isActive must be a boolean");
    expect(ann({ commentsEnabled: 1 }).body.errors).toContain("commentsEnabled must be a boolean");
  });
});
