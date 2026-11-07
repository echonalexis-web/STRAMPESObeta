// GET /api/v1/notifications/unsubscribe — the public, no-auth route reached
// from a notification email's footer link. Mounts the real router (it's the
// specific ordering — this route registered before router.use(protect) —
// that makes it reachable without a session, so this is worth testing at
// the router level rather than calling the controller function directly).

jest.mock("../models/User", () => ({ updateOne: jest.fn() }));
jest.mock("../models/Notification", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../middleware/auth", () => ({
  verifyToken: (req, res, next) => {
    // Real middleware would 401 with no token; any request that reaches
    // this in these tests is a bug in route ordering, so make that loud.
    res.status(401).json({ message: "unexpected: protect() reached for a request meant to bypass it" });
  },
}));

const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const { buildUnsubscribeUrl } = require("../utils/emailUnsubscribe");
const notificationRoutes = require("../routes/notificationRoutes");

const PREVIOUS_UNSUB_SECRET = process.env.EMAIL_UNSUB_SECRET;
process.env.EMAIL_UNSUB_SECRET = "test-unsub-secret";

afterAll(() => {
  if (PREVIOUS_UNSUB_SECRET === undefined) delete process.env.EMAIL_UNSUB_SECRET;
  else process.env.EMAIL_UNSUB_SECRET = PREVIOUS_UNSUB_SECRET;
});

const USER_ID = "507f1f77bcf86cd799439011";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/notifications", notificationRoutes);
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /notifications/unsubscribe", () => {
  // buildUnsubscribeUrl prepends baseUrl to "/api/v1/notifications/unsubscribe?...";
  // an empty baseUrl leaves exactly that path, which the app below mounts
  // notificationRoutes at — so the built URL can be requested as-is.
  test("requires no auth — reaches the handler without a token", async () => {
    const app = buildApp();
    User.updateOne.mockResolvedValue({});
    const url = buildUnsubscribeUrl({ baseUrl: "", userId: USER_ID, category: "notifyMessages" });

    const res = await request(app).get(url);

    expect(res.status).toBe(200);
    expect(res.text).toContain("unsubscribed");
  });

  test("flips exactly the one named category off for that user", async () => {
    const app = buildApp();
    User.updateOne.mockResolvedValue({});
    const url = buildUnsubscribeUrl({ baseUrl: "", userId: USER_ID, category: "notifyJobMatch" });

    await request(app).get(url);

    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID },
      { $set: { "emailNotificationPreferences.notifyJobMatch": false } }
    );
  });

  test("rejects a tampered signature with 400, and writes nothing", async () => {
    const app = buildApp();
    const url = buildUnsubscribeUrl({ baseUrl: "", userId: USER_ID, category: "notifyMessages" });
    const tampered = url.replace(/s=[0-9a-f]+$/, "s=0000000000000000000000000000000000000000000000000000000000000000");

    const res = await request(app).get(tampered);

    expect(res.status).toBe(400);
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("rejects an unknown category even with a well-formed request shape", async () => {
    const app = buildApp();

    const res = await request(app).get(
      `/api/v1/notifications/unsubscribe?u=${USER_ID}&c=notAnEmailAllSwitch&s=deadbeef`
    );

    expect(res.status).toBe(400);
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("rejects a malformed userId without crashing", async () => {
    const app = buildApp();

    const res = await request(app).get(`/api/v1/notifications/unsubscribe?u=not-an-id&c=notifyMessages&s=deadbeef`);

    expect(res.status).toBe(400);
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("every other route on this router still requires auth", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/v1/notifications");
    expect(res.status).toBe(401);
  });
});
