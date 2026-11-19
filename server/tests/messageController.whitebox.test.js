// White-box branch coverage for server/controllers/messageController.js.
// Tests tagged KNOWN-ISSUE pin CURRENT behaviour that looks like a defect or
// policy gap (see docs/WHITE_BOX_TEST_REPORT.md).

jest.mock("../models/Conversation", () => ({
  findOne: jest.fn(), create: jest.fn(), findById: jest.fn(), find: jest.fn(), findByIdAndUpdate: jest.fn(), findByIdAndDelete: jest.fn(),
}));
jest.mock("../models/Message", () => ({
  create: jest.fn(), findById: jest.fn(), find: jest.fn(), updateMany: jest.fn(), findOne: jest.fn(), deleteMany: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../services/notificationService", () => ({ notifyNewMessage: jest.fn() }));
jest.mock("../services/presenceService", () => ({ isViewingConversation: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../utils/ageAccess", () => ({ getAgeDenial: jest.fn(), sendAgeDenial: jest.fn() }));
jest.mock("../utils/age", () => ({ getAgeTier: jest.fn(), TIERS: { MINOR: "minor", ADULT: "adult", SENIOR: "senior", CHILD: "child" } }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { notifyNewMessage } = require("../services/notificationService");
const presence = require("../services/presenceService");
const { logAuditEvent } = require("../services/auditService");
const { getAgeDenial, sendAgeDenial } = require("../utils/ageAccess");
const { getAgeTier } = require("../utils/age");
const ctl = require("../controllers/messageController");
const { makeReq, query, failingQuery, call } = require("../testUtils/httpMocks");

const ME = "me";
const THEM = "them";
const dbError = () => new Error("secret db internals");
// `io` defaults to "no socket server"; tests that need one pass their own `app`.
const mreq = (o = {}) => makeReq({ user: { id: ME, _id: ME, role: "jobseeker" }, app: { get: jest.fn(() => null) }, ...o });
const mkIo = () => {
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })), emit };
  return io;
};

let warnSpy;
let errSpy;
beforeEach(() => {
  jest.resetAllMocks();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  logAuditEvent.mockResolvedValue();
  notifyNewMessage.mockResolvedValue();
  getAgeDenial.mockReturnValue(null);
  presence.isViewingConversation.mockReturnValue(false);
  getAgeTier.mockReturnValue("adult");
});
afterEach(() => {
  warnSpy.mockRestore();
  errSpy.mockRestore();
});

// ---------------------------------------------------------------------------
describe("ensureConversationBetweenUsers / postSystemMessage", () => {
  test("WB-MSG-01 returns the existing two-person conversation, otherwise creates one", async () => {
    Conversation.findOne.mockResolvedValue({ _id: "c1" });
    expect(await ctl.ensureConversationBetweenUsers("a", "b")).toEqual({ _id: "c1" });
    expect(Conversation.findOne).toHaveBeenCalledWith({ participants: { $all: ["a", "b"] }, $expr: { $eq: [{ $size: "$participants" }, 2] } });
    Conversation.findOne.mockResolvedValue(null);
    Conversation.create.mockResolvedValue({ _id: "new" });
    expect(await ctl.ensureConversationBetweenUsers("a", "b")).toEqual({ _id: "new" });
    expect(Conversation.create).toHaveBeenCalledWith({ participants: ["a", "b"] });
  });

  test.each([
    [{ toUserId: "b", content: "hi" }], [{ fromUserId: "a", content: "hi" }], [{ fromUserId: "a", toUserId: "b", content: "   " }],
    [{ fromUserId: "a", toUserId: "b" }], [{ fromUserId: "a", toUserId: "a", content: "hi" }],
  ])("WB-MSG-02 postSystemMessage(%j) does nothing and returns null", async (args) => {
    expect(await ctl.postSystemMessage(args)).toBeNull();
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  const wire = () => {
    Conversation.findOne.mockResolvedValue({ _id: "c1" });
    Message.create.mockResolvedValue({ _id: "m1", content: "hello", createdAt: "t" });
    Conversation.findByIdAndUpdate.mockResolvedValue();
    Message.findById.mockReturnValue(query({ sender: { name: "STRAM" }, toObject: () => ({ _id: "m1" }) }));
  };

  test("WB-MSG-03 posts the trimmed message, updates the preview, pushes it over the socket and notifies when the recipient is not looking", async () => {
    wire();
    const io = mkIo();
    const conv = await ctl.postSystemMessage({ fromUserId: "a", toUserId: "b", content: "  hello  ", io });
    expect(conv).toEqual({ _id: "c1" });
    expect(Message.create).toHaveBeenCalledWith({ conversationId: "c1", sender: "a", content: "hello" });
    expect(Conversation.findByIdAndUpdate).toHaveBeenCalledWith("c1", { $set: { lastMessage: "hello", lastMessageAt: "t" } });
    expect(io.to).toHaveBeenCalledWith("user:b");
    expect(io.emit).toHaveBeenCalledWith("receive_message", { _id: "m1", conversationId: "c1" });
    expect(notifyNewMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "b", actorName: "STRAM", messagePreview: "hello" }));
  });

  test("WB-MSG-04 no socket: nothing is emitted; a recipient already viewing the thread is not notified; a sender with no name falls back to 'STRAM PESO'", async () => {
    wire();
    presence.isViewingConversation.mockReturnValue(true);
    await ctl.postSystemMessage({ fromUserId: "a", toUserId: "b", content: "hello" });
    expect(notifyNewMessage).not.toHaveBeenCalled();
    presence.isViewingConversation.mockReturnValue(false);
    Message.findById.mockReturnValue(query({ sender: null, toObject: () => ({}) }));
    await ctl.postSystemMessage({ fromUserId: "a", toUserId: "b", content: "hello" });
    expect(notifyNewMessage.mock.calls[0][0].actorName).toBe("STRAM PESO");
  });

  test("WB-MSG-05 a notification failure never breaks the caller's flow", async () => {
    wire();
    notifyNewMessage.mockRejectedValue(new Error("x"));
    expect(await ctl.postSystemMessage({ fromUserId: "a", toUserId: "b", content: "hello" })).toEqual({ _id: "c1" });
  });
});

// ---------------------------------------------------------------------------
describe("createConversation", () => {
  const run = (participantId = THEM, over = {}) => call(ctl.createConversation, mreq({ body: { participantId }, ...over }));
  const wire = (current, target) => {
    User.findById.mockImplementation((id) => query(id === ME ? current : target));
    Conversation.findOne.mockResolvedValue({ _id: "c1" });
    Conversation.findById.mockReturnValue(query({ _id: "c1", participants: [] }));
  };

  test("WB-MSG-06 missing participant and self-conversation are 400", async () => {
    expect((await run(null)).body.message).toBe("participantId is required");
    expect((await run(ME)).body.message).toBe("Cannot create conversation with yourself");
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("WB-MSG-07 caller missing/inactive is 403; target missing/inactive is 404", async () => {
    wire(null, { role: "employer" });
    expect((await run()).status).toBe(403);
    wire({ role: "jobseeker", isActive: false }, { role: "employer" });
    expect((await run()).status).toBe(403);
    wire({ role: "jobseeker" }, null);
    expect((await run()).status).toBe(404);
    wire({ role: "jobseeker" }, { role: "employer", isActive: false });
    expect((await run()).status).toBe(404);
  });

  test("WB-MSG-08 a jobseeker blocked by the age gate gets the age denial and nothing is created", async () => {
    wire({ role: "jobseeker" }, { role: "employer" });
    getAgeDenial.mockReturnValue({ code: "DOB_REQUIRED" });
    await run();
    expect(sendAgeDenial).toHaveBeenCalledWith(expect.anything(), { code: "DOB_REQUIRED" });
    expect(Conversation.create).not.toHaveBeenCalled();
  });

  test("WB-MSG-09 a 15-17 jobseeker cannot start a chat with an employer (MESSAGING_AGE_RESTRICTED)", async () => {
    getAgeTier.mockImplementation((dob) => (dob === "minor-dob" ? "minor" : "adult"));
    wire({ role: "jobseeker", dateOfBirth: "minor-dob" }, { role: "employer" });
    const r = await run();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("MESSAGING_AGE_RESTRICTED");
  });

  test("WB-MSG-09b KNOWN-ISSUE (dead rule): the age check exempts PESO staff for under-18 accounts, but canMessageTarget() forbids jobseeker -> admin/superadmin outright, so a minor can never actually start a chat with staff either", async () => {
    getAgeTier.mockImplementation((dob) => (dob === "minor-dob" ? "minor" : "adult"));
    wire({ role: "jobseeker", dateOfBirth: "minor-dob" }, { role: "admin" });
    const r = await run();
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Messaging this user is not allowed");
  });

  test.each([["employee"], ["resident"]])("WB-MSG-10 legacy role %s is subject to the same age rules as jobseeker", async (role) => {
    wire({ role, dateOfBirth: "m" }, { role: "employer" });
    getAgeTier.mockReturnValue("minor");
    expect((await run()).body.code).toBe("MESSAGING_AGE_RESTRICTED");
    expect(getAgeDenial).toHaveBeenCalled();
  });

  test.each([["minor", false], ["child", false], [undefined, false], ["adult", true], ["senior", true]])(
    "WB-MSG-11 an employer contacting a jobseeker whose age tier is %p is allowed=%p", async (tier, allowed) => {
      getAgeTier.mockReturnValue(tier);
      wire({ role: "employer" }, { role: "jobseeker", dateOfBirth: "x" });
      const r = await run();
      if (allowed) expect(r.status).toBe(201);
      else {
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("MESSAGING_MINOR_RESTRICTED");
      }
    }
  );

  test.each([
    ["admin", "jobseeker", 201], ["admin", "employer", 201], ["admin", "admin", 201], ["admin", "superadmin", 201],
    ["superadmin", "admin", 201], ["superadmin", "jobseeker", 403], ["superadmin", "employer", 403], ["superadmin", "superadmin", 403],
    ["jobseeker", "employer", 201], ["employer", "jobseeker", 201], ["employer", "employer", 403], ["employer", "admin", 403],
    ["jobseeker", "admin", 403], ["jobseeker", "superadmin", 403], ["stranger", "employer", 403], ["", "employer", 403],
  ])("WB-MSG-12 role matrix %s -> %s gives %i", async (from, to, expected) => {
    wire({ role: from, dateOfBirth: "d" }, { role: to, dateOfBirth: "d" });
    expect((await run()).status).toBe(expected);
  });

  test.each([
    [undefined, 201], [{}, 201], [{ allowMessagesFrom: "anyone" }, 201], [{ allowMessagesFrom: "employers" }, 403],
  ])("WB-MSG-13 jobseeker -> jobseeker with the target's privacy %j gives %i", async (privacy, expected) => {
    wire({ role: "jobseeker", dateOfBirth: "d" }, { role: "jobseeker", privacy, dateOfBirth: "d" });
    expect((await run()).status).toBe(expected);
  });

  test("WB-MSG-14 KNOWN-ISSUE (policy gap): an adult jobseeker CAN start a chat with a 15-17 jobseeker under the default privacy ('anyone'); the minor-protection rules only cover employers and the minor's own outgoing chats", async () => {
    getAgeTier.mockImplementation((dob) => (dob === "minor-dob" ? "minor" : "adult"));
    wire({ role: "jobseeker", dateOfBirth: "adult-dob" }, { role: "jobseeker", dateOfBirth: "minor-dob" });
    expect((await run()).status).toBe(201);
  });

  test("WB-MSG-15 KNOWN-ISSUE: user search hides other jobseekers from jobseekers, but createConversation still allows them by direct id", async () => {
    wire({ role: "jobseeker", dateOfBirth: "d" }, { role: "jobseeker", dateOfBirth: "d" });
    expect((await run()).status).toBe(201);
    User.find.mockReturnValue(query([{ role: "jobseeker", name: "Peer" }]));
    const search = await call(ctl.searchUsers, mreq({ query: { query: "pe" } }));
    expect(search.body).toEqual([]);
  });

  test("WB-MSG-16 success returns the populated conversation and audits it", async () => {
    wire({ role: "jobseeker", dateOfBirth: "d" }, { role: "employer" });
    const r = await run();
    expect(Conversation.findOne).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "message.conversation.created", targetId: "c1" }));
    expect(r.body).toEqual({ _id: "c1", participants: [] });
  });

  test("WB-MSG-17 DB failure is a generic 500 that never leaks the error", async () => {
    User.findById.mockImplementation(() => failingQuery(dbError()));
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to create conversation" });
  });

  test("WB-MSG-18 user id may come from req.user.id when _id is absent", async () => {
    wire({ role: "jobseeker", dateOfBirth: "d" }, { role: "employer" });
    await call(ctl.createConversation, makeReq({ user: { id: ME, role: "jobseeker" }, body: { participantId: THEM } }));
    expect(User.findById).toHaveBeenCalledWith(ME);
  });
});

// ---------------------------------------------------------------------------
describe("searchUsers", () => {
  const run = (q, role = "jobseeker", extra = {}) => call(ctl.searchUsers, makeReq({ user: { id: ME, _id: ME, role }, query: { query: q }, ...extra }));
  const wire = (rows) => {
    const qy = query(rows);
    User.find.mockReturnValue(qy);
    return qy;
  };
  const cand = (role, o = {}) => ({ role, name: role, dateOfBirth: "d", toObject() { return { role, name: role, dateOfBirth: "d", ...o }; }, ...o });

  test.each([[undefined], [""], [" "], ["a"]])("WB-MSG-19 query %p (under 2 characters) returns [] without touching the DB", async (q) => {
    expect((await run(q)).body).toEqual([]);
    expect(User.find).not.toHaveBeenCalled();
  });

  test.each([["stranger"], [""], ["guest"]])("WB-MSG-20 a role that cannot message anyone (%p) gets []", async (role) => {
    expect((await run("abc", role)).body).toEqual([]);
    expect(User.find).not.toHaveBeenCalled();
  });

  test("WB-MSG-21 non-staff search by name/company only (no email clause, no email in the projection), excludes self and inactive users, regex is escaped", async () => {
    const qy = wire([]);
    await run("a.b(", "jobseeker");
    const filter = User.find.mock.calls[0][0];
    expect(filter._id).toEqual({ $ne: ME });
    expect(filter.isActive).toEqual({ $ne: false });
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0].name.$regex).toBe("a\\.b\\(");
    expect(qy.select.mock.calls[0][0]).not.toContain("email");
    expect(qy.limit).toHaveBeenCalledWith(60);
  });

  test("WB-MSG-22 PESO staff may also search by email and receive it", async () => {
    const qy = wire([]);
    await run("ab", "admin");
    expect(User.find.mock.calls[0][0].$or).toHaveLength(3);
    expect(qy.select.mock.calls[0][0]).toContain("email");
    wire([]);
    await run("ab", "superadmin");
    expect(User.find.mock.calls[1][0].$or).toHaveLength(3);
  });

  test("WB-MSG-23 employers never find hidden profiles; other roles are not given that filter", async () => {
    wire([]);
    await run("ab", "employer");
    expect(User.find.mock.calls[0][0]["privacy.profileVisibility"]).toEqual({ $ne: "hidden" });
    await run("ab", "admin");
    expect(User.find.mock.calls[1][0]).not.toHaveProperty("privacy.profileVisibility");
  });

  test("WB-MSG-24 results are limited to roles the caller may reach (jobseekers see only employers; superadmin only admins; admin everyone)", async () => {
    wire([cand("employer"), cand("jobseeker"), cand("admin"), cand("superadmin")]);
    expect((await run("ab", "jobseeker")).body.map((u) => u.role)).toEqual(["employer"]);
    wire([cand("employer"), cand("jobseeker"), cand("admin"), cand("superadmin")]);
    expect((await run("ab", "superadmin")).body.map((u) => u.role)).toEqual(["admin"]);
    wire([cand("employer"), cand("jobseeker"), cand("admin"), cand("superadmin"), cand("employee")]);
    expect((await run("ab", "admin")).body.map((u) => u.role).sort()).toEqual(["admin", "employee", "employer", "jobseeker", "superadmin"]);
  });

  test("WB-MSG-25 employers only find confirmed adults/seniors; dateOfBirth is stripped from every result", async () => {
    getAgeTier.mockImplementation((dob) => dob);
    wire([cand("jobseeker", { dateOfBirth: "adult" }), cand("jobseeker", { dateOfBirth: "senior" }), cand("jobseeker", { dateOfBirth: "minor" }), cand("jobseeker", { dateOfBirth: undefined })]);
    const { body } = await run("ab", "employer");
    expect(body).toHaveLength(2);
    body.forEach((u) => expect(u).not.toHaveProperty("dateOfBirth"));
  });

  test("WB-MSG-26 results are capped at 20; plain objects (no toObject) are copied", async () => {
    wire(Array.from({ length: 30 }, (_, i) => ({ role: "employer", name: `E${i}`, dateOfBirth: "d" })));
    const { body } = await run("ab", "jobseeker");
    expect(body).toHaveLength(20);
    expect(body[0]).not.toHaveProperty("dateOfBirth");
  });

  test("WB-MSG-27 DB failure is a generic 500", async () => {
    User.find.mockReturnValue(failingQuery(dbError()));
    expect((await run("ab")).body).toEqual({ message: "Failed to search users" });
  });
});

// ---------------------------------------------------------------------------
describe("getConversations", () => {
  const run = () => call(ctl.getConversations, mreq());
  const wire = (rows) => Conversation.find.mockReturnValue(query(rows));
  const p = (id, o = {}) => ({ _id: id, name: id, isActive: true, ...o });

  test("WB-MSG-28 only the caller's non-hidden conversations are requested; participants are populated keeping deleted slots", async () => {
    const qy = query([]);
    Conversation.find.mockReturnValue(qy);
    await run();
    expect(Conversation.find).toHaveBeenCalledWith({ participants: ME, hiddenFor: { $ne: ME } });
    expect(qy.populate.mock.calls[0][0].options).toEqual({ retainNullValues: true });
  });

  test("WB-MSG-29 skips threads with fewer than two participants, non-array participants, and threads the caller is not part of", async () => {
    wire([
      { _id: "c1", participants: [p(ME)] },
      { _id: "c2", participants: "bad" },
      { _id: "c3", participants: [p("x"), p("y")] },
      { _id: "c4", participants: [p(ME), p("z")] },
    ]);
    const { body } = await run();
    expect(body.map((c) => c._id)).toEqual(["c4"]);
  });

  test("WB-MSG-30 a deleted participant becomes an 'unavailable/deleted' placeholder; a suspended one is flagged 'suspended'", async () => {
    wire([
      { _id: "c1", participants: [p(ME), null] },
      { _id: "c2", participants: [p(ME), p("s", { isActive: false })] },
    ]);
    const { body } = await run();
    expect(body[0].participants[1]).toEqual({ _id: "unavailable-c1-1", name: null, unavailable: true, unavailableReason: "deleted" });
    expect(body[1].participants[1]).toMatchObject({ unavailable: true, unavailableReason: "suspended" });
  });

  test("WB-MSG-31 duplicate threads between the same people (any order) are collapsed to the first", async () => {
    wire([
      { _id: "c1", participants: [p(ME), p("z")] },
      { _id: "c2", participants: [p("z"), p(ME)] },
      { _id: "c3", participants: [p(ME), p("w")] },
    ]);
    expect((await run()).body.map((c) => c._id)).toEqual(["c1", "c3"]);
  });

  test("WB-MSG-32 DB failure is a generic 500", async () => {
    Conversation.find.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to fetch conversations" });
  });
});

// ---------------------------------------------------------------------------
describe("getMessages", () => {
  const run = () => call(ctl.getMessages, mreq({ params: { conversationId: "c1" } }));

  test("WB-MSG-33 unknown conversation 404; non-participant 403 (no messages read, nothing marked read)", async () => {
    Conversation.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
    Conversation.findById.mockReturnValue(query({ participants: ["x", "y"] }));
    expect((await run()).status).toBe(403);
    expect(Message.find).not.toHaveBeenCalled();
    expect(Message.updateMany).not.toHaveBeenCalled();
  });

  test("WB-MSG-34 a participant gets the thread oldest-first and the OTHER side's unread messages are marked read", async () => {
    Conversation.findById.mockReturnValue(query({ participants: [ME, THEM] }));
    const qy = query([{ _id: "m1" }]);
    Message.find.mockReturnValue(qy);
    Message.updateMany.mockResolvedValue();
    const { body } = await run();
    expect(body).toEqual([{ _id: "m1" }]);
    expect(qy.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(Message.updateMany).toHaveBeenCalledWith({ conversationId: "c1", sender: { $ne: ME }, isRead: false }, { $set: { isRead: true } });
  });

  test("WB-MSG-35 DB failure is a generic 500", async () => {
    Conversation.findById.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to fetch messages" });
  });
});

// ---------------------------------------------------------------------------
describe("sendMessage", () => {
  const run = (body = { content: "hi" }, params = { conversationId: "c1" }, over = {}) => call(ctl.sendMessage, mreq({ params, body, ...over }));
  const wire = (participants = [ME, THEM]) => {
    Conversation.findById.mockReturnValue(query({ participants }));
    User.findById.mockReturnValue(query({ isActive: true }));
    Message.create.mockResolvedValue({ _id: "m1", content: "hi", createdAt: "t" });
    Conversation.findByIdAndUpdate.mockResolvedValue();
    Message.findById.mockReturnValue(query({ sender: { name: "Me" }, toObject: () => ({ _id: "m1" }) }));
  };

  test.each([[{}], [{ content: "" }], [{ content: "   " }]])("WB-MSG-36 content %j is 400", async (body) => {
    expect((await run(body)).status).toBe(400);
  });

  test("WB-MSG-37 missing conversation id (neither in the URL nor the body) is 400; the body id is accepted", async () => {
    expect((await run({ content: "hi" }, {})).status).toBe(400);
    wire();
    expect((await run({ content: "hi", conversationId: "c1" }, {})).status).toBe(201);
  });

  test("WB-MSG-38 unknown conversation 404; non-participant 403; a conversation with only the caller 400", async () => {
    Conversation.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
    Conversation.findById.mockReturnValue(query({ participants: ["x", "y"] }));
    expect((await run()).status).toBe(403);
    Conversation.findById.mockReturnValue(query({ participants: [ME] }));
    expect((await run()).body.message).toBe("Conversation has no valid receiver");
    expect(Message.create).not.toHaveBeenCalled();
  });

  test("WB-MSG-39 a deleted or deactivated recipient cannot be messaged", async () => {
    wire();
    User.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(403);
    User.findById.mockReturnValue(query({ isActive: false }));
    expect((await run()).body.message).toBe("This user is unavailable");
    expect(Message.create).not.toHaveBeenCalled();
  });

  test("WB-MSG-40 success: trimmed content stored, preview updated and the thread un-hidden for everyone, audited, pushed to the OTHER user only, notified", async () => {
    wire();
    const io = mkIo();
    const r = await run({ content: "  hi  " }, undefined, { app: { get: jest.fn(() => io) } });
    expect(r.status).toBe(201);
    expect(Message.create).toHaveBeenCalledWith({ conversationId: "c1", sender: ME, content: "hi" });
    expect(Conversation.findByIdAndUpdate).toHaveBeenCalledWith("c1", { $set: { lastMessage: "hi", lastMessageAt: "t", hiddenFor: [] } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "message.sent" }));
    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith(`user:${THEM}`);
    expect(io.emit).toHaveBeenCalledWith("receive_message", { _id: "m1", conversationId: "c1" });
    expect(notifyNewMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientId: THEM, actorName: "Me", messagePreview: "hi" }));
  });

  test("WB-MSG-41 no socket server: still saved and returned; a recipient already viewing the thread is not notified; unnamed sender is 'Someone'", async () => {
    wire();
    presence.isViewingConversation.mockReturnValue(true);
    expect((await run({ content: "hi" }, undefined, { app: { get: jest.fn(() => null) } })).status).toBe(201);
    expect(notifyNewMessage).not.toHaveBeenCalled();
    presence.isViewingConversation.mockReturnValue(false);
    Message.findById.mockReturnValue(query({ sender: null, toObject: () => ({}) }));
    await run();
    expect(notifyNewMessage.mock.calls[0][0].actorName).toBe("Someone");
  });

  test("WB-MSG-42 a notification failure is swallowed (warned) and the message still succeeds", async () => {
    wire();
    notifyNewMessage.mockRejectedValue(new Error("smtp"));
    expect((await run()).status).toBe(201);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("WB-MSG-43 KNOWN-ISSUE: once a conversation exists, sendMessage re-checks neither the role/age rules nor privacy, so a restriction added after creation (or a 15-17 account contacted via the default-privacy path) does not stop messages", async () => {
    wire();
    getAgeDenial.mockReturnValue({ code: "AGE" });
    getAgeTier.mockReturnValue("minor");
    expect((await run()).status).toBe(201);
    expect(getAgeDenial).not.toHaveBeenCalled();
  });

  test("WB-MSG-44 DB failure is a generic 500", async () => {
    Conversation.findById.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to send message" });
  });
});

// ---------------------------------------------------------------------------
describe("unsendMessage", () => {
  const run = (over = {}) => call(ctl.unsendMessage, mreq({ params: { messageId: "m1" }, ...over }));
  const msg = (o = {}) => ({ _id: "m1", sender: ME, conversationId: "c1", content: "hi", createdAt: new Date(), save: jest.fn().mockResolvedValue(), ...o });

  test("WB-MSG-45 unknown 404; not the sender 403; already unsent 400", async () => {
    Message.findById.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
    Message.findById.mockResolvedValue(msg({ sender: THEM }));
    expect((await run()).status).toBe(403);
    Message.findById.mockResolvedValue(msg({ isUnsent: true }));
    expect((await run()).body.message).toBe("This message has already been unsent");
  });

  test("WB-MSG-46 the 15-minute window: just inside is allowed, just outside is refused", async () => {
    Message.findById.mockResolvedValue(msg({ createdAt: new Date(Date.now() - 14 * 60 * 1000) }));
    Message.findOne.mockReturnValue(query(null));
    expect((await run()).status).toBe(200);
    const old = msg({ createdAt: new Date(Date.now() - 16 * 60 * 1000) });
    Message.findById.mockResolvedValue(old);
    const r = await run();
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/within 15 minutes/);
    expect(old.save).not.toHaveBeenCalled();
  });

  test("WB-MSG-47 success blanks the content (the row stays), flags it unsent, and audits", async () => {
    const m = msg();
    Message.findById.mockResolvedValue(m);
    Message.findOne.mockReturnValue(query({ _id: "other" }));
    const r = await run();
    expect(m).toMatchObject({ content: "", isUnsent: true });
    expect(m.unsentAt).toBeInstanceOf(Date);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "message.unsent" }));
    expect(r.body).toEqual({ messageId: "m1", conversationId: "c1" });
  });

  test("WB-MSG-48 the conversation preview is replaced only when this was the LATEST message", async () => {
    Message.findById.mockResolvedValue(msg());
    Message.findOne.mockReturnValue(query({ _id: "m1" }));
    Conversation.findByIdAndUpdate.mockResolvedValue();
    await run();
    expect(Conversation.findByIdAndUpdate).toHaveBeenCalledWith("c1", { $set: { lastMessage: "Message unsent" } });
    Conversation.findByIdAndUpdate.mockClear();
    Message.findOne.mockReturnValue(query({ _id: "newer" }));
    await run();
    Message.findOne.mockReturnValue(query(null));
    await run();
    expect(Conversation.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-MSG-49 the other participant is told over the socket; no socket, a missing conversation, or no other participant means no emit", async () => {
    Message.findById.mockResolvedValue(msg());
    Message.findOne.mockReturnValue(query({ _id: "x" }));
    const io = mkIo();
    Conversation.findById.mockReturnValue(query({ participants: [ME, THEM] }));
    await run({ app: { get: jest.fn(() => io) } });
    expect(io.to).toHaveBeenCalledWith(`user:${THEM}`);
    expect(io.emit).toHaveBeenCalledWith("message_unsent", { messageId: "m1", conversationId: "c1" });
    io.to.mockClear();
    Conversation.findById.mockReturnValue(query(null));
    await run({ app: { get: jest.fn(() => io) } });
    Conversation.findById.mockReturnValue(query({ participants: [ME] }));
    await run({ app: { get: jest.fn(() => io) } });
    await run({ app: { get: jest.fn(() => null) } });
    expect(io.to).not.toHaveBeenCalled();
  });

  test("WB-MSG-50 failure goes through the shared error helper (generic message)", async () => {
    Message.findById.mockRejectedValue(dbError());
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ message: "Failed to unsend message" });
  });
});

// ---------------------------------------------------------------------------
describe("deleteConversation", () => {
  const run = () => call(ctl.deleteConversation, mreq({ params: { conversationId: "c1" } }));
  const conv = (o = {}) => ({ _id: "c1", participants: [ME, THEM], hiddenFor: [], ...o });

  test("WB-MSG-51 unknown 404; non-participant 403 and nothing is changed", async () => {
    Conversation.findById.mockReturnValue(query(null));
    expect((await run()).status).toBe(404);
    Conversation.findById.mockReturnValue(query(conv({ participants: ["x", "y"] })));
    expect((await run()).status).toBe(403);
    expect(Conversation.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("WB-MSG-52 the first person to delete only hides the thread for themself (the other copy and the messages survive)", async () => {
    Conversation.findById.mockReturnValue(query(conv()));
    Conversation.findByIdAndUpdate.mockResolvedValue();
    const r = await run();
    expect(Conversation.findByIdAndUpdate).toHaveBeenCalledWith("c1", { $addToSet: { hiddenFor: ME } });
    expect(Conversation.findByIdAndDelete).not.toHaveBeenCalled();
    expect(Message.deleteMany).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "message.conversation.deleted" }));
    expect(r.body).toEqual({ message: "Conversation deleted" });
  });

  test("WB-MSG-53 once EVERY participant has deleted it, the conversation and its messages are removed for real", async () => {
    Conversation.findById.mockReturnValue(query(conv({ hiddenFor: [THEM] })));
    Conversation.findByIdAndUpdate.mockResolvedValue();
    Conversation.findByIdAndDelete.mockResolvedValue();
    Message.deleteMany.mockResolvedValue();
    await run();
    expect(Conversation.findByIdAndDelete).toHaveBeenCalledWith("c1");
    expect(Message.deleteMany).toHaveBeenCalledWith({ conversationId: "c1" });
  });

  test("WB-MSG-54 populated participant objects and duplicate ids are handled; a hiddenFor with only the caller is not enough", async () => {
    Conversation.findById.mockReturnValue(query(conv({ participants: [{ _id: ME }, { _id: THEM }, ME], hiddenFor: [{ _id: THEM }] })));
    Conversation.findByIdAndUpdate.mockResolvedValue();
    await run();
    expect(Conversation.findByIdAndDelete).toHaveBeenCalled();
    Conversation.findByIdAndDelete.mockClear();
    Conversation.findById.mockReturnValue(query(conv({ hiddenFor: [ME] })));
    await run();
    expect(Conversation.findByIdAndDelete).not.toHaveBeenCalled();
  });

  test("WB-MSG-55 DB failure is a generic 500", async () => {
    Conversation.findById.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to delete conversation" });
  });
});

// ---------------------------------------------------------------------------
describe("getUnreadCount", () => {
  const run = () => call(ctl.getUnreadCount, mreq());

  test("WB-MSG-56 no conversations means 0 without counting messages", async () => {
    Conversation.find.mockReturnValue(query([]));
    expect((await run()).body).toEqual({ count: 0 });
    expect(Message.countDocuments).not.toHaveBeenCalled();
  });

  test("WB-MSG-57 counts only unread messages sent by the OTHER side across the caller's conversations", async () => {
    Conversation.find.mockReturnValue(query([{ _id: "c1" }, { _id: "c2" }]));
    Message.countDocuments.mockResolvedValue(7);
    expect((await run()).body).toEqual({ count: 7 });
    expect(Message.countDocuments).toHaveBeenCalledWith({ conversationId: { $in: ["c1", "c2"] }, sender: { $ne: ME }, isRead: false });
  });

  test("WB-MSG-58 DB failure is a generic 500", async () => {
    Conversation.find.mockReturnValue(failingQuery(dbError()));
    expect((await run()).body).toEqual({ message: "Failed to fetch unread count" });
  });
});
