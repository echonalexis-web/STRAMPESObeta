// Staff account provisioning through the real superadmin router on both the /api
// and /api/v1 mounts. Mocked models and mail, no database, no real email.

jest.mock("../models/User", () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
}));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../models/EmailOutbox", () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/emailOutboxService", () => ({ enqueueEmail: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

// Limits are read when the router loads, so they are set before the require below.
process.env.JWT_SECRET = "local-test-secret";
process.env.STAFF_PROVISION_LIMIT_PER_HOUR = "6";
process.env.STAFF_RESEND_LIMIT_PER_HOUR = "3";

const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const EmailOutbox = require("../models/EmailOutbox");
const { logAuditEvent } = require("../services/auditService");
const { enqueueEmail } = require("../services/emailOutboxService");
const { query } = require("../testUtils/httpMocks");

const router = require("../routes/superadminRoutes");
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.app.set("io", null); next(); });
app.use("/api/superadmin", router);
app.use("/api/v1/superadmin", router);

const ACTOR = "111111111111111111111111";
const TARGET = "222222222222222222222222";
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
let uniqueActor = 0;
const actorId = () => `a${String(++uniqueActor).padStart(23, "0")}`;

// Signs a session for a user whose stored role is `role`.
const as = (role, id = ACTOR) => {
  User.findById.mockReturnValue(query({ role, isActive: true, tokenVersion: 0, name: "Maria Santos" }));
  return "Bearer " + jwt.sign({ id }, process.env.JWT_SECRET);
};

const good = { name: "Ann Cruz", email: "Ann@Peso.gov", position: "PESO Manager" };
const tokenFromLink = (url) => url.split("#token=")[1];

let logSpies;
beforeEach(() => {
  jest.resetAllMocks();
  logAuditEvent.mockResolvedValue();
  User.updateOne.mockResolvedValue({});
  User.findOne.mockReturnValue(query(null));
  User.create.mockImplementation(async (d) => ({ _id: TARGET, createdAt: new Date(), ...d }));
  SystemSettings.getSingleton.mockResolvedValue({});
  EmailOutbox.updateMany.mockResolvedValue({});
  EmailOutbox.find.mockReturnValue(query([]));
  enqueueEmail.mockResolvedValue({ _id: "ob1" });
  logSpies = ["log", "info", "warn", "error"].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => logSpies.forEach((s) => s.mockRestore()));

// The audit call carries the live request (sockets), so only its data fields are compared.
const auditData = () => logAuditEvent.mock.calls.map(([a]) => ({ ...a, req: undefined }));

const everything = (res) =>
  JSON.stringify([
    res.body,
    auditData(),
    logSpies.map((s) => s.mock.calls),
    User.updateOne.mock.calls,
  ]);

describe.each(["/api/superadmin", "/api/v1/superadmin"])("%s staff provisioning access", (prefix) => {
  const calls = [
    ["post", `${prefix}/admins`, good],
    ["post", `${prefix}/admins/${TARGET}/resend-invite`, {}],
    ["delete", `${prefix}/admins/${TARGET}/invite`, undefined],
  ];

  test.each(calls)("%s %s rejects a request with no token", async (method, url, body) => {
    const res = await request(app)[method](url).send(body);
    expect(res.status).toBe(401);
    expect(User.create).not.toHaveBeenCalled();
  });

  test.each(["admin", "jobseeker", "employer"])("%s role is refused on every provisioning route", async (role) => {
    const token = as(role);
    for (const [method, url, body] of calls) {
      const res = await request(app)[method](url).set("Authorization", token).send(body);
      expect(res.status).toBe(403);
    }
    expect(User.create).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.findOneAndDelete).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("superadmin can provision", async () => {
    const res = await request(app).post(`${prefix}/admins`).set("Authorization", as("superadmin", actorId())).send(good);
    expect(res.status).toBe(201);
    expect(User.create).toHaveBeenCalledTimes(1);
  });
});

describe("provisioning", () => {
  const post = (body, token = as("superadmin", actorId())) =>
    request(app).post("/api/superadmin/admins").set("Authorization", token).send(body);

  test("creates a pending, inactive admin with no usable password and no password anywhere in the response", async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    const created = User.create.mock.calls[0][0];
    expect(created).toMatchObject({
      role: "admin", isActive: false, accountStatus: "pending_activation", mustChangePassword: false,
      email: "ann@peso.gov", staffNote: "Ann Cruz, PESO Manager",
    });
    expect(created.password).toMatch(/^\$2[aby]\$10\$/); // a bcrypt hash of a value nobody knows
    expect(res.body).not.toHaveProperty("tempPassword");
    expect(res.body.admin).toMatchObject({ accountStatus: "pending_activation" });
    expect(res.body.admin.invite).toMatchObject({ status: "pending", resendCount: 0 });
    for (const forbidden of ["password", "tokenHash", "token"]) {
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain(forbidden.toLowerCase().replace("password", "temppassword"));
    }
    expect(JSON.stringify(res.body)).not.toContain(created.password);
  });

  test("the token is stored only as a SHA-256 hash and never leaves the email link", async () => {
    const res = await post(good);
    const created = User.create.mock.calls[0][0];
    const mail = enqueueEmail.mock.calls[0][0];
    const token = tokenFromLink(mail.button.url);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.staffInvite.tokenHash).toBe(sha(token));
    expect(created.staffInvite.tokenHash).not.toBe(token);
    expect(mail.button.url).toMatch(/\/activate-account#token=/);
    expect(everything(res)).not.toContain(token);
    expect(mail).toMatchObject({ sensitive: true, category: "staffInvite", toEmail: "ann@peso.gov" });
    expect(JSON.stringify(mail.paragraphs) + mail.footnote + mail.subject + mail.heading).not.toContain(token);
  });

  test("the email is bilingual, shows the login ID and the expiry in Asia/Manila, and has no password", async () => {
    await post(good);
    const mail = enqueueEmail.mock.calls[0][0];
    const text = mail.paragraphs.join("\n");
    expect(text).toContain("Hello Ann Cruz");
    expect(text).toContain("Kumusta, Ann Cruz");
    expect(text).toContain("ann@peso.gov");
    expect(text).toContain("Maria Santos");
    expect(text).toContain("Asia/Manila");
    expect(text).toContain("Maynila");
    expect(mail.footnote).toMatch(/will never ask for your password/);
    expect(mail.footnote).toMatch(/Hindi kailanman hihingin/);
    expect((text + mail.footnote).toLowerCase()).not.toMatch(/temporary password|temp password|your password is/);
  });

  test("the expiry defaults to 48 hours and follows the Superadmin setting", async () => {
    await post({ ...good, email: "one@peso.gov" });
    let invite = User.create.mock.calls[0][0].staffInvite;
    expect(invite.expiresAt.getTime() - invite.sentAt.getTime()).toBe(48 * 3600 * 1000);

    SystemSettings.getSingleton.mockResolvedValue({ staffInviteExpiryHours: 24 });
    await post({ ...good, email: "two@peso.gov" });
    invite = User.create.mock.calls[1][0].staffInvite;
    expect(invite.expiresAt.getTime() - invite.sentAt.getTime()).toBe(24 * 3600 * 1000);

    SystemSettings.getSingleton.mockResolvedValue({ staffInviteExpiryHours: 99999 });
    await post({ ...good, email: "three@peso.gov" });
    invite = User.create.mock.calls[2][0].staffInvite;
    expect(invite.expiresAt.getTime() - invite.sentAt.getTime()).toBe(168 * 3600 * 1000);
  });

  test("a superadmin role can never be created; staff_moderator is stored as admin", async () => {
    let res = await post({ ...good, role: "superadmin" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("role");
    expect(User.create).not.toHaveBeenCalled();

    res = await post({ ...good, role: "staff_moderator" });
    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0].role).toBe("admin");
  });

  test("an email that already exists, in any role, is refused with a clear error on the email field", async () => {
    User.findOne.mockReturnValue(query({ _id: "x", role: "jobseeker" }));
    const res = await post(good);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ field: "email", code: "EMAIL_EXISTS", message: "An account with that email already exists." });
    expect(User.findOne).toHaveBeenCalledWith({ email: "ann@peso.gov" });
    expect(User.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("two requests racing for the same email: the unique index answer is the same clear error", async () => {
    User.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await post(good);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_EXISTS");
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("audit entries record actor, target and time, never the token, link or password", async () => {
    const res = await post(good);
    const token = tokenFromLink(enqueueEmail.mock.calls[0][0].button.url);
    const call = logAuditEvent.mock.calls.find(([a]) => a.action === "staff.account.provisioned")[0];
    expect(call).toMatchObject({ actorRole: "superadmin", targetType: "user", severity: "critical" });
    expect(call.actorId).toBeTruthy();
    expect(call.targetUserId).toBe(TARGET);
    const all = JSON.stringify(auditData());
    expect(all).not.toContain(token);
    expect(all).not.toContain("activate-account");
    expect(all.toLowerCase()).not.toContain("password");
    expect(res.status).toBe(201);
  });

  test("when the email cannot even be queued the account stays pending, the Superadmin is told, and it is audited", async () => {
    enqueueEmail.mockRejectedValue(new Error("mongo secret internals"));
    const res = await post(good);
    expect(res.status).toBe(201);
    expect(res.body.emailStatus).toBe("failed");
    expect(res.body.message).toMatch(/could not be queued/);
    expect(JSON.stringify(res.body)).not.toContain("secret internals");
    expect(User.updateOne).toHaveBeenCalledWith({ _id: TARGET }, { $set: { "staffInvite.queueFailed": true } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.invite.failed", targetUserId: TARGET }));
  });

  test("provisioning is rate limited per Superadmin per hour (429)", async () => {
    const token = as("superadmin", "b00000000000000000000001");
    const statuses = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await post({}, token)).status);
    expect(statuses.slice(0, 6).every((s) => s === 400)).toBe(true);
    expect(statuses[6]).toBe(429);
    // A different Superadmin is not affected.
    expect((await post({}, as("superadmin", "b00000000000000000000002"))).status).toBe(400);
  });
});

describe("resend invite", () => {
  let resendId = 0;
  // A fresh account id per call keeps the per-account hourly limiter out of unrelated tests.
  const POST = (id = `d${String(++resendId).padStart(23, "0")}`, token = as("superadmin", actorId())) =>
    request(app).post(`/api/superadmin/admins/${id}/resend-invite`).set("Authorization", token).send({});
  const refreshed = (o = {}) => ({
    _id: TARGET, name: "Ann Cruz", email: "ann@peso.gov", accountStatus: "pending_activation",
    staffInvite: { status: "pending", resendCount: 1, sentAt: new Date(), lastSentAt: new Date(), expiresAt: new Date(Date.now() + 1000 * 3600) },
    ...o,
  });

  test("one atomic update enforces pending state, the cooldown and the cap, and replaces the token hash", async () => {
    User.findOneAndUpdate.mockReturnValue(query(refreshed()));
    const res = await POST();
    expect(res.status).toBe(200);
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      role: "admin", accountStatus: "pending_activation", deletedAt: null, "staffInvite.status": "pending",
      "staffInvite.resendCount": { $lt: 10 },
    });
    expect(filter["staffInvite.lastSentAt"].$lte).toBeInstanceOf(Date);
    const cooldownEdge = Date.now() - 60 * 1000;
    expect(Math.abs(filter["staffInvite.lastSentAt"].$lte.getTime() - cooldownEdge)).toBeLessThan(2000);
    const token = tokenFromLink(enqueueEmail.mock.calls[0][0].button.url);
    expect(update.$set["staffInvite.tokenHash"]).toBe(sha(token));
    expect(update.$inc).toEqual({ "staffInvite.resendCount": 1 });
    expect(everything(res)).not.toContain(token);
  });

  test("a stale invite email still waiting in the outbox is dropped before the new one is queued", async () => {
    User.findOneAndUpdate.mockReturnValue(query(refreshed()));
    const order = [];
    EmailOutbox.updateMany.mockImplementation(async () => { order.push("suppress"); });
    enqueueEmail.mockImplementation(async () => { order.push("enqueue"); return { _id: "ob2" }; });
    await POST();
    expect(order).toEqual(["suppress", "enqueue"]);
    expect(EmailOutbox.updateMany).toHaveBeenCalledWith(
      { recipient: TARGET, category: "staffInvite", status: "queued" },
      { $set: expect.objectContaining({ status: "suppressed", buttonUrl: "" }) }
    );
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.invite.resent", targetUserId: TARGET }));
  });

  test("inside the cooldown it answers 429 with the seconds left", async () => {
    User.findOneAndUpdate.mockReturnValue(query(null));
    User.findOne.mockReturnValue(query(refreshed({ staffInvite: { status: "pending", resendCount: 1, lastSentAt: new Date(Date.now() - 20 * 1000) } })));
    const res = await POST();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RESEND_COOLDOWN");
    expect(res.body.retryAfterSeconds).toBeGreaterThan(30);
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(40);
    expect(Number(res.headers["retry-after"])).toBe(res.body.retryAfterSeconds);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("past the per-invite cap it answers 429", async () => {
    User.findOneAndUpdate.mockReturnValue(query(null));
    User.findOne.mockReturnValue(query(refreshed({ staffInvite: { status: "pending", resendCount: 10, lastSentAt: new Date(Date.now() - 3600 * 1000) } })));
    const res = await POST();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RESEND_LIMIT");
  });

  test("the cooldown follows the Superadmin setting", async () => {
    SystemSettings.getSingleton.mockResolvedValue({ staffInviteResendCooldownSeconds: 300 });
    User.findOneAndUpdate.mockReturnValue(query(refreshed()));
    await POST();
    const edge = User.findOneAndUpdate.mock.calls[0][0]["staffInvite.lastSentAt"].$lte.getTime();
    expect(Math.abs(edge - (Date.now() - 300 * 1000))).toBeLessThan(2000);
  });

  test("an activated or unknown account cannot be resent", async () => {
    User.findOneAndUpdate.mockReturnValue(query(null));
    User.findOne.mockReturnValue(query(refreshed({ accountStatus: "active", staffInvite: { status: "activated" } })));
    expect((await POST()).status).toBe(409);
    User.findOne.mockReturnValue(query(null));
    expect((await POST()).status).toBe(404);
  });

  test("an invalid id is rejected before anything runs", async () => {
    const res = await request(app).post("/api/superadmin/admins/not-an-id/resend-invite").set("Authorization", as("superadmin", actorId())).send({});
    expect(res.status).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a resend whose email cannot be queued reports it and is audited", async () => {
    User.findOneAndUpdate.mockReturnValue(query(refreshed()));
    enqueueEmail.mockRejectedValue(new Error("boom"));
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.body.emailStatus).toBe("failed");
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.invite.failed" }));
  });

  test("resends are rate limited per account (429)", async () => {
    User.findOneAndUpdate.mockReturnValue(query(null));
    User.findOne.mockReturnValue(query(null));
    const id = "c00000000000000000000001";
    const token = as("superadmin", actorId());
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await POST(id, token)).status);
    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});

describe("cancel invite", () => {
  const DEL = (id = TARGET) =>
    request(app).delete(`/api/v1/superadmin/admins/${id}/invite`).set("Authorization", as("superadmin", actorId()));

  test("removes only a pending, never-activated stub, drops queued mail and audits it", async () => {
    User.findOneAndDelete.mockReturnValue(query({ _id: TARGET, name: "Ann", email: "ann@peso.gov" }));
    const res = await DEL();
    expect(res.status).toBe(200);
    expect(User.findOneAndDelete).toHaveBeenCalledWith({
      _id: TARGET, role: "admin", accountStatus: "pending_activation", deletedAt: null, "staffInvite.status": "pending",
    });
    expect(EmailOutbox.updateMany).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.invite.revoked", targetUserId: TARGET }));
  });

  test("an active account is not removed (409) and an unknown id is 404", async () => {
    User.findOneAndDelete.mockReturnValue(query(null));
    User.findOne.mockReturnValue(query({ accountStatus: "active" }));
    expect((await DEL()).status).toBe(409);
    User.findOne.mockReturnValue(query(null));
    expect((await DEL()).status).toBe(404);
  });
});

describe("the other staff actions refuse a pending account", () => {
  test("enable/disable and reset password answer 409, so a pending account cannot be activated around the invite", async () => {
    const token = as("superadmin", actorId());
    const pending = { _id: TARGET, role: "admin", accountStatus: "pending_activation", save: jest.fn() };
    User.findById.mockImplementation(() => {
      const q = query({ role: "superadmin", isActive: true, tokenVersion: 0, name: "Maria" });
      q.then = (resolve) => Promise.resolve(pending).then(resolve);
      return q;
    });
    // The first findById (session) is served from `as`; swap to the pending doc for the controller.
    User.findById.mockReturnValueOnce(query({ role: "superadmin", isActive: true, tokenVersion: 0 }));
    let res = await request(app).patch(`/api/superadmin/admins/${TARGET}/active`).set("Authorization", token).send({ active: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PENDING_ACTIVATION");

    User.findById.mockReturnValueOnce(query({ role: "superadmin", isActive: true, tokenVersion: 0 }));
    res = await request(app).post(`/api/v1/superadmin/admins/${TARGET}/reset-password`).set("Authorization", token).send({});
    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty("tempPassword");
    expect(pending.save).not.toHaveBeenCalled();
  });
});

describe("listing", () => {
  test("a pending account shows its invite details and email status, never a token or hash", async () => {
    const sent = new Date(Date.now() - 3600 * 1000);
    const q = query([
      {
        _id: TARGET, name: "Ann", email: "ann@peso.gov", staffNote: "Ann, HR", isActive: false, accountStatus: "pending_activation",
        createdAt: sent, staffInvite: { status: "pending", resendCount: 2, sentAt: sent, lastSentAt: sent, expiresAt: new Date(Date.now() - 1000), outboxId: "ob9" },
      },
      { _id: "x2", name: "Bo", email: "bo@peso.gov", isActive: true, accountStatus: "active", staffInvite: { status: "activated", activatedAt: sent, sentAt: sent, resendCount: 0 } },
    ]);
    User.find.mockReturnValue(q);
    EmailOutbox.find.mockReturnValue(query([{ _id: "ob9", status: "failed" }]));
    const res = await request(app).get("/api/superadmin/admins").set("Authorization", as("superadmin", actorId()));
    expect(res.status).toBe(200);
    const [pending, active] = res.body.admins;
    expect(pending.invite).toMatchObject({ status: "expired", resendCount: 2, emailStatus: "failed", resendsLeft: 8 });
    expect(pending.invite.nextResendAt).toBeTruthy();
    expect(active.invite).toMatchObject({ status: "activated" });
    expect(active.invite.activatedAt).toBeTruthy();
    expect(res.body.inviteSettings).toEqual({ expiryHours: 48, cooldownSeconds: 60, maxResends: 10 });
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/tokenhash|"token"|"password"/);
    const projection = q.select.mock.calls[0][0];
    expect(projection).not.toMatch(/tokenHash/);
  });
});
