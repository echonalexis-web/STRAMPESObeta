// E-04: sendError must log operation, route, user id/role and the error with
// its stack — and never the request body, query string, or token text.

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const express = require("express");
const request = require("supertest");

const logger = require("../utils/logger");
const { sendError, redact } = require("../utils/sendError");

const buildApp = (handler, user) => {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }
  const router = express.Router();
  router.post("/jobs/:id/apply", handler);
  app.use("/api/v1", router);
  return app;
};

describe("sendError logging (E-04)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("500: logs operation, user id, role, status, message and stack, and keeps the generic response", async () => {
    const boom = new Error("db exploded");
    const app = buildApp((req, res) => sendError(res, boom, "Failed to submit application"), {
      id: "507f1f77bcf86cd799439011",
      role: "jobseeker",
    });

    const res = await request(app).post("/api/v1/jobs/abc123/apply").send({ x: 1 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to submit application" });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, entry] = logger.error.mock.calls[0];
    expect(message).toBe("Request failed");
    expect(entry).toMatchObject({
      operation: "POST /api/v1/jobs/:id/apply",
      userId: "507f1f77bcf86cd799439011",
      role: "jobseeker",
      status: 500,
      error: "db exploded",
    });
    expect(entry.stack).toContain("db exploded");
  });

  test("anonymous request logs null user and role", async () => {
    const app = buildApp((req, res) => sendError(res, new Error("nope")));

    await request(app).post("/api/v1/jobs/abc/apply").send({});

    expect(logger.error.mock.calls[0][1]).toMatchObject({ userId: null, role: null });
  });

  test("4xx is logged at warn without a stack", async () => {
    const app = buildApp((req, res) => sendError(res, new Error("Conflict"), "This request changed.", 409));

    const res = await request(app).post("/api/v1/jobs/abc/apply").send({});

    expect(res.status).toBe(409);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ status: 409 });
    expect(logger.warn.mock.calls[0][1]).not.toHaveProperty("stack");
  });

  test("never logs the request body, password, query string or concrete ids from the url", async () => {
    const app = buildApp((req, res) => sendError(res, new Error("fail")), { id: "u1", role: "admin" });

    await request(app)
      .post("/api/v1/jobs/SECRETJOBID/apply?token=querysecret")
      .send({ password: "hunter2-body", credential: "google-body-credential" });

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("hunter2-body");
    expect(logged).not.toContain("google-body-credential");
    expect(logged).not.toContain("querysecret");
    expect(logged).not.toContain("SECRETJOBID");
  });

  test("redacts a JWT / Google credential echoed inside an error message and stack", async () => {
    const jwtLike = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
    const err = new Error(`Wrong number of segments in token: ${jwtLike}`);
    const app = buildApp((req, res) => sendError(res, err), { id: "u1", role: "jobseeker" });

    await request(app).post("/api/v1/jobs/abc/apply").send({});

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain(jwtLike);
    expect(logged).not.toContain("c2lnbmF0dXJl");
    expect(logged).toContain("[redacted");
  });

  test("a response without res.req (non-Express caller) still sends and logs", () => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };

    sendError(res, new Error("x"), "Could not do it");

    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ message: "Could not do it" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a throwing logger cannot break the response", async () => {
    logger.error.mockImplementationOnce(() => {
      throw new Error("log sink down");
    });
    const app = buildApp((req, res) => sendError(res, new Error("x"), "Fallback"));

    const res = await request(app).post("/api/v1/jobs/abc/apply").send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Fallback" });
  });

  test("SHOW_ERROR_DETAILS still gates the response text, not the log", async () => {
    process.env.SHOW_ERROR_DETAILS = "true";
    try {
      const app = buildApp((req, res) => sendError(res, new Error("detail text"), "Fallback"));
      const res = await request(app).post("/api/v1/jobs/abc/apply").send({});
      expect(res.body.message).toBe("detail text");
    } finally {
      delete process.env.SHOW_ERROR_DETAILS;
    }
  });
});

describe("redact", () => {
  test.each([
    ["Bearer abc.def.ghi", "abc.def.ghi"],
    ["token=sekret123 failed", "sekret123"],
    ['{"password":"p4ss"}', "p4ss"],
  ])("scrubs %p", (input, secret) => {
    expect(redact(input)).not.toContain(secret);
  });

  test("leaves ordinary text alone", () => {
    expect(redact("Cast to ObjectId failed for value")).toBe("Cast to ObjectId failed for value");
  });
});
