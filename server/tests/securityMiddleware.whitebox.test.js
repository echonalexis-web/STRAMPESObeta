// White-box branch coverage for server/middleware/security.js.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const express = require("express");
const request = require("supertest");
const { EventEmitter } = require("events");

const logger = require("../utils/logger");
const {
  csrfProtection,
  generateCsrfToken,
  detectMaliciousPayload,
  sensitiveOperationLimiter,
  securityLogger,
} = require("../middleware/security");

const fakeRes = () => {
  const res = { locals: {} };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe("detectMaliciousPayload", () => {
  const app = express();
  app.use(express.json());
  app.use(detectMaliciousPayload);
  app.all("/x", (req, res) => res.json({ ok: true }));

  test.each([
    ["script tag", "<script>alert(1)</script>"],
    ["script tag with space", "< SCRIPT src=x>"],
    ["javascript: url", "JavaScript:alert(1)"],
    ["vbscript: url", "vbscript:msgbox"],
    ["onload handler", "<img onload = x>"],
    ["onerror handler", "<img onerror=x>"],
    ["onclick handler", "<a onclick=x>"],
    ["data:text/html", "data:text/html;base64,AAA"],
    ["template injection", "${process.env.JWT_SECRET}"],
    ["__proto__ value", "__proto__"],
    ["constructor value", "constructor"],
  ])("WB-SEC-01 blocks %s in a body string", async (_n, value) => {
    const res = await request(app).post("/x").send({ bio: value });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Suspicious content detected");
  });

  test("WB-SEC-02 blocks a malicious KEY, not only a value", async () => {
    const res = await request(app).post("/x").set("Content-Type", "application/json").send('{"constructor":{"x":1}}');
    expect(res.status).toBe(400);
  });

  test("WB-SEC-03 blocks a payload nested in objects and arrays", async () => {
    const res = await request(app).post("/x").send({ a: { b: [{ c: "<script>" }] } });
    expect(res.status).toBe(400);
  });

  test("WB-SEC-04 blocks a malicious query string with the query message", async () => {
    const res = await request(app).get("/x").query({ q: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Suspicious query parameters detected");
  });

  test("WB-SEC-05 clean body and query pass; null, number and boolean values are ignored", async () => {
    const res = await request(app).post("/x?page=2").send({ name: "Juan", n: 5, b: true, z: null });
    expect(res.status).toBe(200);
  });

  test("WB-SEC-06 request with no body and no query passes", async () => {
    const res = await request(app).get("/x");
    expect(res.status).toBe(200);
  });

  test("WB-SEC-07 KNOWN LIMITATION: a legitimate word containing 'constructor' is blocked (false positive)", async () => {
    const res = await request(app).post("/x").send({ title: "Constructor foreman needed" });
    // Lower-case match is case-sensitive, so the capitalised word passes ...
    expect(res.status).toBe(200);
    // ... but the same word in lower case is rejected.
    const res2 = await request(app).post("/x").send({ title: "looking for a constructor of steel frames" });
    expect(res2.status).toBe(400);
  });
});

describe("sensitiveOperationLimiter", () => {
  let nowSpy;
  let now;
  beforeEach(() => {
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  const hit = (limiter, req) => {
    const res = fakeRes();
    const next = jest.fn();
    limiter(req, res, next);
    return { res, next };
  };

  test("WB-RL-01 allows up to maxRequests then returns 429 with the window in minutes", () => {
    const limiter = sensitiveOperationLimiter(3, 120000);
    for (let i = 0; i < 3; i += 1) expect(hit(limiter, { ip: "1.1.1.1" }).next).toHaveBeenCalled();
    const blocked = hit(limiter, { ip: "1.1.1.1" });
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.json).toHaveBeenCalledWith({ message: "Too many attempts. Please try again after 2 minutes." });
  });

  test("WB-RL-02 different IPs have independent counters", () => {
    const limiter = sensitiveOperationLimiter(1, 60000);
    hit(limiter, { ip: "1.1.1.1" });
    expect(hit(limiter, { ip: "2.2.2.2" }).next).toHaveBeenCalled();
    expect(hit(limiter, { ip: "1.1.1.1" }).res.status).toHaveBeenCalledWith(429);
  });

  test("WB-RL-03 boundary: a request exactly windowMs old no longer counts", () => {
    const limiter = sensitiveOperationLimiter(1, 60000);
    hit(limiter, { ip: "1.1.1.1" });
    now += 59999;
    expect(hit(limiter, { ip: "1.1.1.1" }).res.status).toHaveBeenCalledWith(429);
    now += 1; // first hit is now exactly 60000 ms old (`< windowMs` is false) so it expires
    expect(hit(limiter, { ip: "1.1.1.1" }).next).toHaveBeenCalled();
    // blocked requests are not recorded, so only the allowed one above counts now
    expect(hit(limiter, { ip: "1.1.1.1" }).res.status).toHaveBeenCalledWith(429);
  });

  test("WB-RL-04 custom keyFn keys the counter (identifier + IP) instead of the IP", () => {
    const limiter = sensitiveOperationLimiter(1, 60000, { keyFn: (r) => `${r.body.email}|${r.ip}` });
    hit(limiter, { ip: "1.1.1.1", body: { email: "a@x.com" } });
    expect(hit(limiter, { ip: "1.1.1.1", body: { email: "b@x.com" } }).next).toHaveBeenCalled();
    expect(hit(limiter, { ip: "1.1.1.1", body: { email: "a@x.com" } }).res.status).toHaveBeenCalledWith(429);
  });

  test("WB-RL-05 a non-function keyFn falls back to the IP", () => {
    const limiter = sensitiveOperationLimiter(1, 60000, { keyFn: "nope" });
    hit(limiter, { ip: "1.1.1.1" });
    expect(hit(limiter, { ip: "1.1.1.1" }).res.status).toHaveBeenCalledWith(429);
  });

  test("WB-RL-06 default arguments are 5 requests per hour", () => {
    const limiter = sensitiveOperationLimiter();
    for (let i = 0; i < 5; i += 1) hit(limiter, { ip: "9.9.9.9" });
    const blocked = hit(limiter, { ip: "9.9.9.9" });
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.json.mock.calls[0][0].message).toContain("60 minutes");
  });

  test("WB-RL-07 sweep removes idle keys once per window and keeps active ones", () => {
    const limiter = sensitiveOperationLimiter(1, 60000);
    hit(limiter, { ip: "old" });
    now += 30000;
    hit(limiter, { ip: "active" });
    now += 40000; // sweep runs: "old" (70s) is dropped, "active" (40s) kept
    expect(hit(limiter, { ip: "old" }).next).toHaveBeenCalled();
    expect(hit(limiter, { ip: "active" }).res.status).toHaveBeenCalledWith(429);
  });
});

describe("securityLogger", () => {
  const run = (statusCode, user) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = { method: "POST", url: "/api/v1/x", ip: "1.1.1.1", user, get: jest.fn().mockReturnValue("jest-agent") };
    const next = jest.fn();
    securityLogger(req, res, next);
    res.emit("finish");
    return next;
  };

  test.each([400, 401, 403])("WB-LOG-01 logs a security_event for status %s", (code) => {
    const next = run(code, { _id: "u1" });
    expect(next).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "security_event",
      expect.objectContaining({ statusCode: code, userId: "u1", userAgent: "jest-agent", method: "POST" })
    );
  });

  test.each([200, 201, 404, 429, 500])("WB-LOG-02 does not log status %s", (code) => {
    run(code);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("WB-LOG-03 anonymous request is logged as unauthenticated", () => {
    run(401, undefined);
    expect(logger.warn.mock.calls[0][1].userId).toBe("unauthenticated");
  });
});

// csrfProtection / generateCsrfToken are exported but not mounted anywhere in the
// server (see report). Tested so the branches are pinned if they are ever wired in.
describe("csrfProtection and generateCsrfToken (currently unused)", () => {
  test.each(["GET", "HEAD", "OPTIONS", "PATCH"])("WB-CSRF-01 %s is not checked", (method) => {
    const next = jest.fn();
    csrfProtection({ method, headers: {} }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test.each([
    ["no header", {}, { csrfToken: "abc" }],
    ["no session", { "x-csrf-token": "abc" }, undefined],
    ["session without token", { "x-csrf-token": "abc" }, {}],
    ["mismatch", { "x-csrf-token": "zzz" }, { csrfToken: "abc" }],
  ])("WB-CSRF-02 POST with %s is 403", (_n, headers, session) => {
    const res = fakeRes();
    const next = jest.fn();
    csrfProtection({ method: "POST", headers, session }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(["POST", "PUT", "DELETE"])("WB-CSRF-03 %s with a matching token passes", (method) => {
    const next = jest.fn();
    csrfProtection({ method, headers: { "x-csrf-token": "abc" }, session: { csrfToken: "abc" } }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test("WB-CSRF-04 generateCsrfToken skips when there is no session", () => {
    const res = fakeRes();
    const next = jest.fn();
    generateCsrfToken({}, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals.csrfToken).toBeUndefined();
  });

  test("WB-CSRF-05 generateCsrfToken creates a 64-hex token once and reuses it", () => {
    const req = { session: {} };
    const res = fakeRes();
    generateCsrfToken(req, res, jest.fn());
    const first = req.session.csrfToken;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(res.locals.csrfToken).toBe(first);
    generateCsrfToken(req, fakeRes(), jest.fn());
    expect(req.session.csrfToken).toBe(first);
  });
});
