// Phase 2 — notification emails (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §1).
//
// Mocks the model layer and mailService, same style as the rest of this
// suite (tests/matchWeights.test.js etc.) — there's no DB test harness in
// this project, so these exercise emailOutboxService's own branching logic
// against controlled mock responses rather than a real Mongo collection.

jest.mock("../models/EmailOutbox", () => ({
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock("../models/Notification", () => ({ findById: jest.fn() }));
jest.mock("../services/mailService", () => ({
  renderEmail: jest.fn(() => "<html>stub</html>"),
  sendMail: jest.fn(),
}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const EmailOutbox = require("../models/EmailOutbox");
const Notification = require("../models/Notification");
const mailService = require("../services/mailService");
const svc = require("../services/emailOutboxService");

beforeEach(() => {
  // resetAllMocks (below, in afterEach) wipes the inline implementation the
  // mock factory above gave renderEmail, so it's re-established here rather
  // than relied on — nothing in these tests checks renderEmail's return
  // value, but a defined one is still clearer than an incidental `undefined`.
  mailService.renderEmail.mockReturnValue("<html>stub</html>");
});

afterEach(() => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks only wipes call
  // history, not a configured mockResolvedValue/mockRejectedValue, so a
  // rejection set up by one test would otherwise silently carry into the
  // next one's calls to the same mock.
  jest.resetAllMocks();
  svc.stopEmailOutboxWorker();
});

describe("enqueueEmail", () => {
  const baseArgs = {
    recipientId: "u1",
    toEmail: "person@example.com",
    subject: "Subject",
    heading: "Heading",
    paragraphs: ["Body"],
  };

  test("returns null when required fields are missing", async () => {
    const result = await svc.enqueueEmail({ recipientId: "u1" });
    expect(result).toBeNull();
    expect(EmailOutbox.create).not.toHaveBeenCalled();
  });

  test("creates a plain row when no dedupeKey is given", async () => {
    EmailOutbox.create.mockResolvedValue({ _id: "row1" });
    const scheduledAt = new Date();

    await svc.enqueueEmail({ ...baseArgs, scheduledAt });

    expect(EmailOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: baseArgs.toEmail, subject: "Subject", scheduledAt })
    );
    expect(EmailOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // Regression test for a real bug caught during review: the first version
  // of this upsert put scheduledAt in $set, which would push a message
  // digest's send time forward on EVERY new message in the window — a
  // conversation that stayed active longer than the digest window would
  // then never actually get emailed.
  test("a deduped upsert sets scheduledAt only via $setOnInsert, never in $set", async () => {
    EmailOutbox.findOneAndUpdate.mockResolvedValue({ _id: "row1" });
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000);

    await svc.enqueueEmail({ ...baseArgs, dedupeKey: "msg:conv1:u1:2026-10-28T10", scheduledAt });

    expect(EmailOutbox.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = EmailOutbox.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ dedupeKey: "msg:conv1:u1:2026-10-28T10", status: "queued" });
    expect(update.$set).not.toHaveProperty("scheduledAt");
    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({ scheduledAt, dedupeKey: "msg:conv1:u1:2026-10-28T10" })
    );
    expect(options).toEqual(expect.objectContaining({ upsert: true, new: true }));
  });

  test("a second call with the same dedupeKey only refreshes content, not the schedule", async () => {
    EmailOutbox.findOneAndUpdate.mockResolvedValue({ _id: "row1" });
    const firstScheduledAt = new Date(Date.now() + 10 * 60 * 1000);
    const secondScheduledAt = new Date(Date.now() + 20 * 60 * 1000); // caller recomputes "+10min from now"

    await svc.enqueueEmail({ ...baseArgs, dedupeKey: "k1", scheduledAt: firstScheduledAt });
    await svc.enqueueEmail({ ...baseArgs, heading: "2 new messages", dedupeKey: "k1", scheduledAt: secondScheduledAt });

    const secondCall = EmailOutbox.findOneAndUpdate.mock.calls[1];
    expect(secondCall[1].$set.heading).toBe("2 new messages");
    expect(secondCall[1].$set).not.toHaveProperty("scheduledAt");
    // The second call's $setOnInsert still carries ITS OWN scheduledAt —
    // correct, since Mongo only applies $setOnInsert on an actual insert;
    // on a match (the common case here) it's ignored entirely, which is
    // exactly what keeps the original schedule intact.
    expect(secondCall[1].$setOnInsert.scheduledAt).toBe(secondScheduledAt);
  });

  test("falls back to a plain row on a duplicate-key race", async () => {
    const dupError = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    EmailOutbox.findOneAndUpdate.mockRejectedValue(dupError);
    EmailOutbox.create.mockResolvedValue({ _id: "fallback-row" });

    const result = await svc.enqueueEmail({ ...baseArgs, dedupeKey: "k1" });

    expect(result).toEqual({ _id: "fallback-row" });
    // Must NOT include a dedupeKey field at all (not even `null`) — the
    // sparse unique index on EmailOutbox.dedupeKey only exempts a row where
    // the field is genuinely absent; see models/EmailOutbox.js.
    const createArg = EmailOutbox.create.mock.calls[0][0];
    expect(createArg).not.toHaveProperty("dedupeKey");
  });

  test("a non-duplicate-key error propagates instead of being swallowed", async () => {
    EmailOutbox.findOneAndUpdate.mockRejectedValue(new Error("connection reset"));
    await expect(svc.enqueueEmail({ ...baseArgs, dedupeKey: "k1" })).rejects.toThrow("connection reset");
  });
});

describe("drainEmailOutbox", () => {
  const makeDoc = (overrides = {}) => ({
    _id: "row1",
    toEmail: "person@example.com",
    subject: "Subject",
    heading: "Heading & <b>bold</b>",
    paragraphs: ["Body with <script>alert(1)</script> & stuff"],
    buttonUrl: "",
    buttonLabel: "",
    footnote: "",
    attempts: 1,
    notification: null,
    status: "sending",
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  test("does nothing and reports the cap when today's sent count is already at the daily limit", async () => {
    process.env.EMAIL_DAILY_CAP = "5";
    EmailOutbox.countDocuments.mockResolvedValue(5);

    const result = await svc.drainEmailOutbox({ batchSize: 10 });

    expect(result).toEqual({ drained: 0, cappedForToday: true });
    expect(EmailOutbox.findOneAndUpdate).not.toHaveBeenCalled();
    delete process.env.EMAIL_DAILY_CAP;
  });

  test("stops early when nothing is due", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    EmailOutbox.findOneAndUpdate.mockResolvedValue(null);

    const result = await svc.drainEmailOutbox({ batchSize: 5 });

    expect(result.drained).toBe(0);
    expect(EmailOutbox.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("sends a due row and marks it sent", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc();
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    mailService.sendMail.mockResolvedValue({ delivered: true, channel: "smtp" });

    const result = await svc.drainEmailOutbox({ batchSize: 5 });

    expect(result.drained).toBe(1);
    expect(doc.status).toBe("sent");
    expect(doc.sentAt).toBeInstanceOf(Date);
    expect(doc.resolvedAt).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
  });

  // The escaping fix: HTML goes to renderEmail escaped (heading/paragraphs
  // can carry another user's free text), but the plain-text part passed to
  // sendMail must stay raw — storing an already-escaped value would make
  // the plain-text email literally show "&amp;" to the reader.
  test("escapes heading/paragraphs for the HTML body but keeps the plain-text body raw", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc();
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    mailService.sendMail.mockResolvedValue({ delivered: true, channel: "smtp" });

    await svc.drainEmailOutbox({ batchSize: 5 });

    expect(mailService.renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        heading: "Heading &amp; &lt;b&gt;bold&lt;/b&gt;",
        paragraphs: ["Body with &lt;script&gt;alert(1)&lt;/script&gt; &amp; stuff"],
      })
    );
    const sendArgs = mailService.sendMail.mock.calls[0][0];
    expect(sendArgs.text).toContain("Heading & <b>bold</b>");
    expect(sendArgs.text).toContain("Body with <script>alert(1)</script> & stuff");
  });

  test("a notification already marked read suppresses the email without sending", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc({ notification: "notif1" });
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    Notification.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ isRead: true }) });

    await svc.drainEmailOutbox({ batchSize: 5 });

    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(doc.status).toBe("suppressed");
    expect(doc.resolvedAt).toBeInstanceOf(Date);
  });

  test("an SMTP failure below the attempt limit is requeued with backoff, not failed", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc({ attempts: 1 });
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    mailService.sendMail.mockResolvedValue({ delivered: false, channel: "error" });

    const before = Date.now();
    await svc.drainEmailOutbox({ batchSize: 5 });

    expect(doc.status).toBe("queued");
    expect(doc.resolvedAt).toBeUndefined();
    expect(doc.scheduledAt.getTime()).toBeGreaterThan(before);
  });

  test("an SMTP failure at the attempt limit is marked failed, not requeued", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc({ attempts: 3 }); // MAX_ATTEMPTS
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    mailService.sendMail.mockResolvedValue({ delivered: false, channel: "error" });

    await svc.drainEmailOutbox({ batchSize: 5 });

    expect(doc.status).toBe("failed");
    expect(doc.resolvedAt).toBeInstanceOf(Date);
  });

  test("no mailer configured (console channel) counts as sent, not a failure", async () => {
    EmailOutbox.countDocuments.mockResolvedValue(0);
    const doc = makeDoc();
    EmailOutbox.findOneAndUpdate.mockResolvedValueOnce(doc).mockResolvedValueOnce(null);
    mailService.sendMail.mockResolvedValue({ delivered: false, channel: "console" });

    await svc.drainEmailOutbox({ batchSize: 5 });

    expect(doc.status).toBe("sent");
  });

  test("never claims more rows than the remaining daily budget", async () => {
    process.env.EMAIL_DAILY_CAP = "2";
    EmailOutbox.countDocuments.mockResolvedValue(1); // 1 already sent today, budget = 1
    const doc = makeDoc();
    EmailOutbox.findOneAndUpdate.mockResolvedValue(doc);
    mailService.sendMail.mockResolvedValue({ delivered: true, channel: "smtp" });

    await svc.drainEmailOutbox({ batchSize: 10 });

    expect(EmailOutbox.findOneAndUpdate).toHaveBeenCalledTimes(1);
    delete process.env.EMAIL_DAILY_CAP;
  });
});

describe("startEmailOutboxWorker / stopEmailOutboxWorker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    EmailOutbox.countDocuments.mockResolvedValue(0);
    EmailOutbox.findOneAndUpdate.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("does not schedule anything when disabled via env", () => {
    process.env.EMAIL_WORKER_ENABLED = "false";
    svc.startEmailOutboxWorker({ intervalMs: 1000 });
    jest.advanceTimersByTime(5000);
    expect(EmailOutbox.countDocuments).not.toHaveBeenCalled();
    delete process.env.EMAIL_WORKER_ENABLED;
  });

  test("drains on an interval once started", async () => {
    svc.startEmailOutboxWorker({ intervalMs: 1000 });
    jest.advanceTimersByTime(1000);
    // Let the drain's internal promise microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(EmailOutbox.countDocuments).toHaveBeenCalled();
  });

  test("calling start twice does not create a second interval", () => {
    const spy = jest.spyOn(global, "setInterval");
    svc.startEmailOutboxWorker({ intervalMs: 1000 });
    svc.startEmailOutboxWorker({ intervalMs: 1000 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("stop clears the interval so no further drains happen", async () => {
    svc.startEmailOutboxWorker({ intervalMs: 1000 });
    svc.stopEmailOutboxWorker();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(EmailOutbox.countDocuments).not.toHaveBeenCalled();
  });
});
