// Phase 2 — notification emails. Covers the gating logic added to
// notificationService's existing notify* helpers: which events get an
// email, under which per-user preferences, and the message-digest dedupe
// key. In-app behavior (the pre-existing part of this file) is intentionally
// not re-tested here.

jest.mock("../models/Notification", () => ({
  create: jest.fn(),
  insertMany: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../services/emailOutboxService", () => ({ enqueueEmail: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const Notification = require("../models/Notification");
const User = require("../models/User");
const { enqueueEmail } = require("../services/emailOutboxService");
const {
  createNotificationForUser,
  notifyManyUsers,
  notifyNewMessage,
  notifyLike,
} = require("../services/notificationService");

// queueNotificationEmail (internal) awaits enqueueEmail but the public
// notify* functions fire it without awaiting — flush microtasks so those
// fire-and-forget calls land before each assertion.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const eligibleRecipient = (overrides = {}) => ({
  _id: "recipient1",
  email: "recipient@example.com",
  isEmailVerified: true,
  emailNotificationPreferences: { emailAll: true },
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe("createNotificationForUser — email gating", () => {
  const baseCall = {
    recipientId: "recipient1",
    type: "application_status",
    title: "Application status updated",
    message: "Your application is now shortlisted.",
    actionUrl: "/dashboard",
    preferenceKey: "notifyApplicationUpdate",
  };

  test("queues an email when the recipient is verified and opted in", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: baseCall.title, message: baseCall.message, actionUrl: baseCall.actionUrl });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    await createNotificationForUser(baseCall);
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "recipient@example.com",
        category: "notifyApplicationUpdate",
        subject: baseCall.title,
        heading: baseCall.title,
        paragraphs: [baseCall.message],
      })
    );
  });

  test("does not queue an email when no preferenceKey is given and the type has no fallback mapping", async () => {
    // "application_status" (baseCall's type) isn't in TYPE_TO_EMAIL_CATEGORY —
    // every real call site for that type passes an explicit preferenceKey
    // instead (see employerController.js); this covers the defensive case of
    // a caller passing neither.
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });

    await createNotificationForUser({ ...baseCall, preferenceKey: null });
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
    // And the recipient lookup for email purposes shouldn't even run.
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("does not queue an email for an unrecognized preferenceKey (e.g. a typo, or a future in-app-only toggle)", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });

    await createNotificationForUser({ ...baseCall, preferenceKey: "someFutureInAppOnlyKey" });
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test.each([
    ["system", "notifySystem"],
    ["admin_action", "notifyAdminAction"],
    ["follow", "notifyFollow"],
    ["news", "notifyNews"],
    ["like", "notifyLikes"],
  ])("queues an email for type %s via its TYPE_TO_EMAIL_CATEGORY fallback (%s), with no explicit preferenceKey", async (type, expectedCategory) => {
    Notification.create.mockResolvedValue({ _id: "n1", type, title: "t", message: "m" });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    await createNotificationForUser({ ...baseCall, type, preferenceKey: null });
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ category: expectedCategory }));
  });

  test("a fallback-mapped type is still blocked when that specific category is turned off", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", type: "news", title: "t", message: "m" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(
        eligibleRecipient({ emailNotificationPreferences: { emailAll: true, notifyNews: false } })
      ),
    });

    await createNotificationForUser({ ...baseCall, type: "news", preferenceKey: null });
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("does not queue when the recipient's email is unverified", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(eligibleRecipient({ isEmailVerified: false })),
    });

    await createNotificationForUser(baseCall);
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("does not queue when the recipient has no email on file", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient({ email: "" })) });

    await createNotificationForUser(baseCall);
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("does not queue when emailAll is off", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(eligibleRecipient({ emailNotificationPreferences: { emailAll: false } })),
    });

    await createNotificationForUser(baseCall);
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("does not queue when this specific category is off", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(
        eligibleRecipient({ emailNotificationPreferences: { emailAll: true, notifyApplicationUpdate: false } })
      ),
    });

    await createNotificationForUser(baseCall);
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("a recipient lookup failure is swallowed, not thrown", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error("db down")) });

    await expect(createNotificationForUser(baseCall)).resolves.toBeDefined();
    await flush();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("an enqueueEmail failure never propagates to the caller", async () => {
    Notification.create.mockResolvedValue({ _id: "n1", title: "t", message: "m" });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });
    enqueueEmail.mockRejectedValue(new Error("mongo write failed"));

    await expect(createNotificationForUser(baseCall)).resolves.toBeDefined();
    await flush();
  });

  test("the notification is still created and returned even when email gating fails internally", async () => {
    const createdDoc = { _id: "n1", title: "t", message: "m" };
    Notification.create.mockResolvedValue(createdDoc);
    User.findById.mockImplementation(() => {
      throw new Error("synchronous blowup");
    });

    const result = await createNotificationForUser(baseCall);
    expect(result).toBe(createdDoc);
  });
});

describe("notifyManyUsers — email gating", () => {
  test("queues one email per opted-in recipient when a preferenceKey is given", async () => {
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: "a1" }, { _id: "a2" }]) }); // in-app opt-in filter
    Notification.insertMany.mockResolvedValue([
      { _id: "n1", recipient: "a1", title: "New SPES submission", message: "m1", actionUrl: "" },
      { _id: "n2", recipient: "a2", title: "New SPES submission", message: "m2", actionUrl: "" },
    ]);
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    await notifyManyUsers({
      recipientIds: ["a1", "a2"],
      type: "admin_action",
      title: "New SPES submission",
      message: "m",
      preferenceKey: "notifySpesSubmission",
    });
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(2);
  });

  test("queues an email per recipient for a broadcast with no preferenceKey, via the type fallback (e.g. a news announcement)", async () => {
    Notification.insertMany.mockResolvedValue([
      { _id: "n1", recipient: "a1", type: "news", title: "Announcement", message: "m" },
      { _id: "n2", recipient: "a2", type: "news", title: "Announcement", message: "m" },
    ]);
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    await notifyManyUsers({
      recipientIds: ["a1", "a2"],
      type: "news",
      title: "Announcement",
      message: "m",
    });
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(2);
    expect(enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ category: "notifyNews" }));
  });
});

describe("notifyLike — email gating", () => {
  const likeArgs = {
    recipientId: "owner1",
    actorId: "liker1",
    actorName: "Jamie",
    relatedEntityType: "job",
    relatedEntityId: "job1",
    itemLabel: 'your job posting "Cashier"',
    actionUrl: "/employer",
  };

  test("a new like queues a deduped, delayed digest email under notifyLikes", async () => {
    Notification.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({
      _id: "n1",
      type: "like",
      title: 'New like on your job posting "Cashier"',
      message: "Jamie liked your job posting \"Cashier\".",
      actionUrl: "/employer",
    });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    const before = Date.now();
    await notifyLike(likeArgs);
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const call = enqueueEmail.mock.calls[0][0];
    expect(call.category).toBe("notifyLikes");
    expect(call.dedupeKey).toBe("like:job:job1:owner1");
    // Delayed by roughly EMAIL_LIKE_DIGEST_MINUTES (default 15), not sent immediately.
    expect(call.scheduledAt.getTime()).toBeGreaterThan(before + 10 * 60 * 1000);
  });

  test("a second like on the same item reuses the exact same dedupeKey (collapses into one digest)", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });
    Notification.findOne.mockResolvedValueOnce(null);
    Notification.create.mockResolvedValue({ _id: "n1", type: "like", title: "t1", message: "m1" });

    await notifyLike(likeArgs);
    await flush();
    const firstKey = enqueueEmail.mock.calls[0][0].dedupeKey;

    const existingDoc = {
      _id: "n1",
      type: "like",
      metadata: { likeCount: 1 },
      save: jest.fn().mockResolvedValue(undefined),
      title: "t1",
      message: "m1",
    };
    Notification.findOne.mockResolvedValueOnce(existingDoc);

    await notifyLike({ ...likeArgs, actorId: "liker2", actorName: "Alex" });
    await flush();
    const secondKey = enqueueEmail.mock.calls[1][0].dedupeKey;

    expect(secondKey).toBe(firstKey);
  });

  test("does not queue when the recipient turned notifyLikes off", async () => {
    Notification.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({ _id: "n1", type: "like", title: "t", message: "m" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(
        eligibleRecipient({ emailNotificationPreferences: { emailAll: true, notifyLikes: false } })
      ),
    });

    await notifyLike(likeArgs);
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("self-like (recipient === actor) creates no notification and queues no email", async () => {
    const result = await notifyLike({ ...likeArgs, actorId: likeArgs.recipientId });

    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});

describe("notifyNewMessage — digest email", () => {
  const args = {
    recipientId: "jobseeker1",
    actorId: "employer1",
    actorName: "Acme Corp",
    conversationId: "conv1",
    messagePreview: "Hi, are you still available?",
  };

  test("a jobseeker gets a deduped, delayed digest email on the first message", async () => {
    User.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ role: "jobseeker" }) });
    Notification.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({
      _id: "n1",
      title: "New message from Acme Corp",
      message: args.messagePreview,
      actionUrl: "/messages",
    });
    User.findById.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(eligibleRecipient()) });

    const before = Date.now();
    await notifyNewMessage(args);
    await flush();

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const call = enqueueEmail.mock.calls[0][0];
    expect(call.category).toBe("notifyMessages");
    expect(call.dedupeKey).toMatch(/^msg:conv1:jobseeker1:\d{4}-\d{2}-\d{2}T\d{2}$/);
    // Delayed by roughly EMAIL_MESSAGE_DIGEST_MINUTES (default 10), not sent immediately.
    expect(call.scheduledAt.getTime()).toBeGreaterThan(before + 5 * 60 * 1000);
  });

  test("a second message in the same conversation reuses the exact same dedupeKey", async () => {
    // One mock covers both of notifyNewMessage's own User.findById calls —
    // the in-app role/opt-out check, and queueNotificationEmail's own
    // separate lookup for email eligibility.
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: "jobseeker", ...eligibleRecipient() }) });
    Notification.findOne.mockResolvedValueOnce(null);
    Notification.create.mockResolvedValue({ _id: "n1", title: "New message from Acme Corp", message: "first" });

    await notifyNewMessage(args);
    await flush();
    const firstKey = enqueueEmail.mock.calls[0][0].dedupeKey;

    const existingDoc = {
      _id: "n1",
      metadata: { messageCount: 1 },
      save: jest.fn().mockResolvedValue(undefined),
      title: "New message from Acme Corp",
      message: "first",
    };
    Notification.findOne.mockResolvedValueOnce(existingDoc);

    await notifyNewMessage({ ...args, messagePreview: "second message" });
    await flush();
    const secondKey = enqueueEmail.mock.calls[1][0].dedupeKey;

    expect(secondKey).toBe(firstKey);
  });

  test("an employer recipient never gets a digest email (no Settings toggle to turn it off)", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: "employer" }) });
    Notification.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({ _id: "n1", title: "New message", message: "m" });

    await notifyNewMessage({ ...args, recipientId: "employer1" });
    await flush();

    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  test("a jobseeker who opted out of in-app message notifications gets no notification and no email", async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ role: "jobseeker", notificationPreferences: { notifyMessages: false } }),
    });

    const result = await notifyNewMessage(args);

    expect(result).toBeNull();
    expect(Notification.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});
