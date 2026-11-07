// Messenger-style active status: server presence service + settings route.
// Fake timers, fake io/sockets and mocked models; nothing touches a database.

jest.mock("../models/User", () => ({ find: jest.fn(), updateOne: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock("../models/Conversation", () => ({ find: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const Conversation = require("../models/Conversation");
const logger = require("../utils/logger");
const { createActiveStatusService, ACTIVE_STATUS_CONFIG, EVENTS } = require("../services/activeStatusService");
const { updateSettings } = require("../controllers/authController");

const A = "aaaaaaaaaaaaaaaaaaaaaaa1"; // jobseeker
const B = "bbbbbbbbbbbbbbbbbbbbbbb1"; // employer, shares a conversation with A
const C = "ccccccccccccccccccccccc1"; // stranger: no conversation with A
const H = "ddddddddddddddddddddddd1"; // hides their status
const S = "eeeeeeeeeeeeeeeeeeeeeee1"; // suspended
const L = "fffffffffffffffffffffff1"; // legacy: no stored setting at all

let users;
let conversations;

const mockModels = () => {
  User.find.mockImplementation((query) => ({
    select: () => ({
      lean: async () => users.filter((u) => query._id.$in.includes(String(u._id))),
    }),
  }));
  User.updateOne.mockResolvedValue({});
  Conversation.find.mockImplementation((query) => ({
    select: () => ({
      lean: async () => conversations.filter((c) => c.participants.map(String).includes(String(query.participants))),
    }),
  }));
};

const buildIo = () => {
  const sent = [];
  return {
    sent,
    sockets: { sockets: new Map() },
    to: jest.fn((room) => ({ emit: (event, payload) => sent.push({ room, event, payload }) })),
  };
};

const flush = () => jest.advanceTimersByTimeAsync(0);

let io;
let service;

const connect = (id, userId) => {
  const handlers = {};
  const socket = {
    id,
    userId,
    emitted: [],
    on: (event, fn) => { handlers[event] = fn; },
    emit(event, payload) { this.emitted.push({ event, payload }); },
    trigger: async (event, payload) => { handlers[event] && handlers[event](payload); await flush(); },
  };
  io.sockets.sockets.set(id, socket);
  service.handleConnection(socket);
  return socket;
};

const disconnect = async (socket) => {
  io.sockets.sockets.delete(socket.id);
  await socket.trigger("disconnect");
};

// Events delivered to one user's room.
const changesFor = (userId) => io.sent.filter((e) => e.room === `user:${userId}` && e.event === EVENTS.CHANGED).map((e) => e.payload);
const lastChangeFor = (userId, about) => changesFor(userId).filter((p) => p.userId === about).pop();
const eventsFor = (userId, event) => io.sent.filter((e) => e.room === `user:${userId}` && e.event === event).map((e) => e.payload);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-08T08:00:00.000Z"));
  jest.clearAllMocks();
  users = [
    { _id: A, isActive: true, privacy: { showActiveStatus: true }, lastActiveAt: null },
    { _id: B, isActive: true, privacy: { showActiveStatus: true }, lastActiveAt: new Date("2026-11-08T05:00:00.000Z") },
    { _id: C, isActive: true, privacy: { showActiveStatus: true }, lastActiveAt: null },
    { _id: H, isActive: true, privacy: { showActiveStatus: false }, lastActiveAt: new Date("2026-11-08T07:00:00.000Z") },
    { _id: S, isActive: false, privacy: { showActiveStatus: true }, lastActiveAt: new Date("2026-11-08T07:00:00.000Z") },
    { _id: L, isActive: true, lastActiveAt: null }, // no privacy object at all
  ];
  conversations = [
    { participants: [A, B], hiddenFor: [] },
    { participants: [A, H], hiddenFor: [] },
    { participants: [A, S], hiddenFor: [] },
    { participants: [A, L], hiddenFor: [] },
    { participants: [B, C], hiddenFor: [] },
  ];
  mockModels();
  io = buildIo();
  service = createActiveStatusService({ io, User, Conversation });
});

afterEach(() => {
  service.stop();
  jest.useRealTimers();
});

describe("activity and aggregation", () => {
  test("a new connection is not active until it reports activity; nothing is persisted at startup", async () => {
    connect("a1", A);
    await flush();

    expect(changesFor(B)).toHaveLength(0);
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test("real activity makes the user active and their partner is told, with no extra data", async () => {
    connect("b1", B); // partner must be online to receive
    const a1 = connect("a1", A);

    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    const change = lastChangeFor(B, A);
    expect(change).toEqual({ userId: A, state: "active", lastActiveAt: "2026-11-08T08:00:00.000Z" });
    expect(Object.keys(change).sort()).toEqual(["lastActiveAt", "state", "userId"]);
  });

  test("no activity: the sweep marks the user not active after the grace period and keeps lastActiveAt", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    service.start();
    await jest.advanceTimersByTimeAsync(ACTIVE_STATUS_CONFIG.ACTIVE_GRACE_MS + ACTIVE_STATUS_CONFIG.SWEEP_INTERVAL_MS);

    expect(lastChangeFor(B, A)).toEqual({ userId: A, state: "inactive", lastActiveAt: "2026-11-08T08:00:00.000Z" });
  });

  test("an explicit idle message ends the active state immediately", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });
    await jest.advanceTimersByTimeAsync(2000);

    await a1.trigger(EVENTS.UPDATE, { state: "idle" });

    expect(lastChangeFor(B, A).state).toBe("inactive");
  });

  test("several sockets aggregate: active while ANY is active, inactive only when none are", async () => {
    connect("b1", B);
    const tab1 = connect("a1", A);
    const tab2 = connect("a2", A);
    await tab1.trigger(EVENTS.UPDATE, { state: "active" });
    await tab2.trigger(EVENTS.UPDATE, { state: "active" });
    await jest.advanceTimersByTimeAsync(2000);

    await tab1.trigger(EVENTS.UPDATE, { state: "idle" });
    expect(lastChangeFor(B, A).state).toBe("active"); // tab2 still active

    await jest.advanceTimersByTimeAsync(2000);
    await tab2.trigger(EVENTS.UPDATE, { state: "idle" });
    expect(lastChangeFor(B, A).state).toBe("inactive");
  });

  test("closing one of two tabs keeps the user active; closing the last one sets lastActiveAt and broadcasts not active", async () => {
    connect("b1", B);
    const tab1 = connect("a1", A);
    const tab2 = connect("a2", A);
    await tab1.trigger(EVENTS.UPDATE, { state: "active" });
    await tab2.trigger(EVENTS.UPDATE, { state: "active" });
    await jest.advanceTimersByTimeAsync(5000);

    await disconnect(tab1);
    expect(lastChangeFor(B, A).state).toBe("active");

    jest.setSystemTime(new Date("2026-11-08T08:10:00.000Z"));
    await disconnect(tab2);

    expect(lastChangeFor(B, A)).toEqual({ userId: A, state: "inactive", lastActiveAt: "2026-11-08T08:10:00.000Z" });
    const persisted = User.updateOne.mock.calls.filter(([filter]) => filter._id === A).pop();
    expect(persisted[1].$set.lastActiveAt.toISOString()).toBe("2026-11-08T08:10:00.000Z");
  });

  test("the sweep expires a ghost socket that is still registered but silent, and drops one the server no longer has", async () => {
    connect("b1", B);
    const ghost = connect("a1", A);
    await ghost.trigger(EVENTS.UPDATE, { state: "active" });
    const gone = connect("a2", A);
    io.sockets.sockets.delete("a2"); // the server no longer knows this socket

    service.start();
    await jest.advanceTimersByTimeAsync(ACTIVE_STATUS_CONFIG.ACTIVE_GRACE_MS + ACTIVE_STATUS_CONFIG.SWEEP_INTERVAL_MS);

    expect(lastChangeFor(B, A).state).toBe("inactive");
    expect(service._state.sockets.has("a2")).toBe(false);
    expect(gone).toBeDefined();
  });

  test("lastActiveAt is persisted on transitions and at most about once a minute while active", async () => {
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" }); // transition: persisted
    const afterFirst = User.updateOne.mock.calls.length;

    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(5000);
      await a1.trigger(EVENTS.UPDATE, { state: "active" }); // heartbeats within the minute
    }
    expect(User.updateOne.mock.calls.length).toBe(afterFirst);

    await jest.advanceTimersByTimeAsync(ACTIVE_STATUS_CONFIG.PERSIST_MIN_INTERVAL_MS);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });
    expect(User.updateOne.mock.calls.length).toBe(afterFirst + 1);
  });
});

describe("who is told", () => {
  test("presence reaches only users who share a conversation; strangers get nothing", async () => {
    connect("b1", B);
    connect("c1", C);
    const a1 = connect("a1", A);

    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    expect(changesFor(B).map((p) => p.userId)).toContain(A);
    expect(changesFor(C)).toHaveLength(0);
    expect(io.sent.every((e) => e.room.startsWith("user:"))).toBe(true); // never a broadcast to everyone
  });

  test("a conversation the viewer deleted (hiddenFor) does not count as shared", async () => {
    conversations[0].hiddenFor = [B];
    connect("b1", B);
    const a1 = connect("a1", A);

    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    expect(changesFor(B)).toHaveLength(0);
  });

  test("offline partners are not messaged at all", async () => {
    const a1 = connect("a1", A);

    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    expect(io.sent).toHaveLength(0);
  });

  test("a suspended or deactivated account is never shown to anyone", async () => {
    connect("a1", A);
    const s1 = connect("s1", S);

    await s1.trigger(EVENTS.UPDATE, { state: "active" });
    expect(changesFor(A).filter((p) => p.userId === S)).toHaveLength(0);

    const a1 = [...io.sockets.sockets.values()].find((s) => s.id === "a1");
    await a1.trigger(EVENTS.SNAPSHOT_REQUEST);
    const snapshot = a1.emitted.filter((e) => e.event === EVENTS.SNAPSHOT).pop().payload.users;
    expect(snapshot.map((u) => u.userId)).not.toContain(S);
  });
});

describe("security and robustness", () => {
  test("an unauthenticated socket gets no presence handlers and cannot broadcast anything", async () => {
    connect("b1", B);
    const handlers = {};
    const stranger = { id: "x1", userId: undefined, on: (e, f) => { handlers[e] = f; }, emit: jest.fn() };

    service.handleConnection(stranger);

    expect(Object.keys(handlers)).toHaveLength(0);
    expect(service._state.sockets.has("x1")).toBe(false);
    expect(io.sent).toHaveLength(0);
  });

  test("malformed payloads are ignored", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);

    for (const bad of [undefined, null, "active", 5, {}, { state: "online" }, { state: "ACTIVE" }, { state: { $ne: 1 } }]) {
      await a1.trigger(EVENTS.UPDATE, bad);
      await jest.advanceTimersByTimeAsync(1500);
    }

    expect(changesFor(B)).toHaveLength(0);
  });

  test("updates are rate limited per socket", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });
    const before = io.sent.length;

    // Flip-flopping inside the minimum gap is dropped.
    await a1.trigger(EVENTS.UPDATE, { state: "idle" });
    await a1.trigger(EVENTS.UPDATE, { state: "active" });

    expect(io.sent.length).toBe(before);
    expect(lastChangeFor(B, A).state).toBe("active");
  });

  test("snapshot requests are rate limited", async () => {
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.SNAPSHOT_REQUEST);
    await a1.trigger(EVENTS.SNAPSHOT_REQUEST);

    expect(a1.emitted.filter((e) => e.event === EVENTS.SNAPSHOT)).toHaveLength(1);
  });

  test("a database failure in presence is logged with user id and operation and never throws into messaging", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);
    Conversation.find.mockImplementation(() => { throw new Error("mongo down"); });

    await expect(a1.trigger(EVENTS.UPDATE, { state: "active" })).resolves.toBeUndefined();
    await expect(a1.trigger(EVENTS.SNAPSHOT_REQUEST)).resolves.toBeUndefined();
    await expect(disconnect(a1)).resolves.toBeUndefined();

    const entries = logger.error.mock.calls.filter(([m]) => m === "Presence failure").map(([, e]) => e);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.operation && "userId" in e)).toBe(true);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/token|message text/i);
  });

  test("a throwing logger cannot break presence either", async () => {
    const a1 = connect("a1", A);
    Conversation.find.mockImplementation(() => { throw new Error("mongo down"); });
    logger.error.mockImplementation(() => { throw new Error("log sink down"); });

    await expect(a1.trigger(EVENTS.UPDATE, { state: "active" })).resolves.toBeUndefined();
  });
});

describe("privacy: Show my active status", () => {
  test("a user with the setting OFF is never broadcast: not even a 'hidden' message on activity (that would leak timing)", async () => {
    connect("a1", A);
    const h1 = connect("h1", H);

    await h1.trigger(EVENTS.UPDATE, { state: "active" });
    await jest.advanceTimersByTimeAsync(2000);
    await h1.trigger(EVENTS.UPDATE, { state: "idle" });
    await disconnect(h1);

    expect(changesFor(A)).toHaveLength(0);
  });

  test("a user with the setting OFF is omitted from every snapshot", async () => {
    const a1 = connect("a1", A);

    await a1.trigger(EVENTS.SNAPSHOT_REQUEST);

    const snapshot = a1.emitted.filter((e) => e.event === EVENTS.SNAPSHOT).pop().payload.users;
    expect(snapshot.map((u) => u.userId)).toContain(B);
    expect(snapshot.map((u) => u.userId)).not.toContain(H);
    expect(JSON.stringify(snapshot)).not.toContain("2026-11-08T07:00:00.000Z"); // H's stored lastActiveAt
  });

  test("with the setting OFF the user receives an empty snapshot and no live presence about others", async () => {
    const h1 = connect("h1", H);
    conversations.push({ participants: [H, B], hiddenFor: [] });
    connect("b1", B);
    const b1 = [...io.sockets.sockets.values()].find((s) => s.id === "b1");

    await h1.trigger(EVENTS.SNAPSHOT_REQUEST);
    expect(h1.emitted.filter((e) => e.event === EVENTS.SNAPSHOT).pop().payload.users).toEqual([]);

    await b1.trigger(EVENTS.UPDATE, { state: "active" });
    expect(changesFor(H)).toHaveLength(0);
  });

  test("a missing stored value behaves as ON", async () => {
    connect("a1", A);
    const l1 = connect("l1", L);

    await l1.trigger(EVENTS.UPDATE, { state: "active" });

    expect(lastChangeFor(A, L).state).toBe("active");
  });

  test("turning the setting OFF clears peers immediately (hidden, no timestamp) and resets the user", async () => {
    connect("b1", B);
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });
    users.find((u) => String(u._id) === A).privacy.showActiveStatus = false; // what the settings route just saved

    await service.onVisibilityChanged(A);
    await flush();

    expect(lastChangeFor(B, A)).toEqual({ userId: A, state: "hidden", lastActiveAt: null });
    expect(eventsFor(A, EVENTS.RESET)).toHaveLength(1);
  });

  test("turning the setting ON sends peers the current state and the user a fresh snapshot", async () => {
    users.find((u) => String(u._id) === A).privacy.showActiveStatus = false;
    connect("b1", B);
    const a1 = connect("a1", A);
    await a1.trigger(EVENTS.UPDATE, { state: "active" });
    expect(changesFor(B)).toHaveLength(0);
    users.find((u) => String(u._id) === A).privacy.showActiveStatus = true;

    await service.onVisibilityChanged(A);
    await flush();

    expect(lastChangeFor(B, A).state).toBe("active");
    const snapshots = eventsFor(A, EVENTS.SNAPSHOT);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].users.map((u) => u.userId)).toContain(B);
  });

  test("the reciprocal rule lives in one function: a viewer who hides themselves sees nobody", () => {
    const { canView } = require("../services/activeStatusService");
    expect(canView({ visible: true }, { visible: true })).toBe(true);
    expect(canView({ visible: false }, { visible: true })).toBe(false);
    expect(canView({ visible: true }, { visible: false })).toBe(false);
  });
});

describe("settings route: privacy.showActiveStatus", () => {
  const buildApp = (activeStatus) => {
    const app = express();
    app.use(express.json());
    app.set("activeStatus", activeStatus);
    app.put("/settings", (req, res, next) => {
      req.user = { id: A, role: "jobseeker" }; // the authenticated user; the body cannot change this
      next();
    }, updateSettings);
    return app;
  };

  beforeEach(() => {
    User.findByIdAndUpdate.mockReturnValue({
      select: async () => ({ notificationPreferences: {}, emailNotificationPreferences: {}, privacy: { showActiveStatus: false } }),
    });
  });

  test("saves a boolean for the authenticated user only and triggers the live update", async () => {
    const activeStatus = { onVisibilityChanged: jest.fn() };

    const res = await request(buildApp(activeStatus)).put("/settings").send({ privacy: { showActiveStatus: false }, userId: B, _id: B });

    expect(res.status).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [id, update] = User.findByIdAndUpdate.mock.calls[0];
    expect(String(id)).toBe(A); // never B, whatever the body says
    expect(update).toEqual({ $set: { "privacy.showActiveStatus": false } });
    expect(activeStatus.onVisibilityChanged).toHaveBeenCalledWith(A);
    expect(res.body.privacy.showActiveStatus).toBe(false);
  });

  test.each(["false", "yes", 0, 1, null, {}, []])("a non-boolean value (%p) is rejected with 400 and nothing is saved", async (value) => {
    const activeStatus = { onVisibilityChanged: jest.fn() };

    const res = await request(buildApp(activeStatus)).put("/settings").send({ privacy: { showActiveStatus: value } });

    expect(res.status).toBe(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(activeStatus.onVisibilityChanged).not.toHaveBeenCalled();
  });

  test("changing other settings does not trigger a presence update", async () => {
    const activeStatus = { onVisibilityChanged: jest.fn() };

    await request(buildApp(activeStatus)).put("/settings").send({ privacy: { profileVisibility: "employers" } });

    expect(activeStatus.onVisibilityChanged).not.toHaveBeenCalled();
  });

  test("saving still works when no presence service is configured", async () => {
    const res = await request(buildApp(undefined)).put("/settings").send({ privacy: { showActiveStatus: true } });

    expect(res.status).toBe(200);
  });
});
