// Messenger-style "active status".
//
// What it does
//   - Tracks activity per socket and aggregates it per user: a user is active
//     if ANY of their sockets reported real activity recently. Several tabs or
//     devices therefore keep them active until all of them are idle.
//   - Runs a sweep that expires users on its own when heartbeats stop, so a
//     frozen tab, a sleeping laptop or a ghost connection cannot stay
//     "active" until the transport timeout.
//   - Tells conversation partners about changes, and gives the client a
//     snapshot of its partners' status.
//
// What it never does
//   - It never broadcasts to everyone: only to people who share a conversation
//     with the user, and only when the privacy rule below allows it.
//   - It never trusts the client for who the user is or for the privacy
//     setting: the user id comes from the authenticated socket and the setting
//     is read from the database.
//   - It never lets a presence failure break messaging: every entry point is
//     wrapped, logged with the user id and operation (no tokens, no message
//     text), and swallowed.
//
// State is in memory only (like presenceService.js): nothing "online" is ever
// persisted, so nothing stale can survive a restart. Only lastActiveAt is
// stored. With several server instances and no Socket.IO adapter each
// instance sees only its own sockets.
const logger = require("../utils/logger");

// All tunables live here so they are easy to change.
const ACTIVE_STATUS_CONFIG = Object.freeze({
  // How often the sweep looks for users whose heartbeats stopped.
  SWEEP_INTERVAL_MS: 30 * 1000,
  // A socket counts as active for this long after its last activity message.
  // The client sends a heartbeat every 30s while active, so 90s tolerates a
  // missed beat or two before the user is expired.
  ACTIVE_GRACE_MS: 90 * 1000,
  // lastActiveAt is written on transitions and at most this often otherwise.
  PERSIST_MIN_INTERVAL_MS: 60 * 1000,
  // Rate limit for presence:update from one socket.
  UPDATE_MIN_INTERVAL_MS: 1000,
  UPDATE_MAX_PER_MINUTE: 30,
  // Rate limit for presence:snapshot:request from one socket.
  SNAPSHOT_MIN_INTERVAL_MS: 2000,
});

const EVENTS = Object.freeze({
  UPDATE: "presence:update", // client -> server: { state: "active" | "idle" }
  SNAPSHOT_REQUEST: "presence:snapshot:request", // client -> server
  CHANGED: "presence:changed", // server -> client: one user's status
  SNAPSHOT: "presence:snapshot", // server -> client: { users: [...] }
  RESET: "presence:reset", // server -> client: forget everything
});

const STATES = Object.freeze({ ACTIVE: "active", INACTIVE: "inactive", HIDDEN: "hidden" });

// THE privacy rule, in one place. Today it is reciprocal, like Messenger: you
// only see someone's status if you show your own, and they show theirs.
// To make it non-reciprocal (hiding yourself does not stop you from seeing
// others), change this to `return subject.visible;`.
const canView = (viewer, subject) => viewer.visible && subject.visible;

const createActiveStatusService = ({ io, User, Conversation, config = {}, log = logger }) => {
  const cfg = { ...ACTIVE_STATUS_CONFIG, ...config };

  // socketId -> { userId, state: "active"|"idle", lastActivityAt, lastUpdateAt, windowStart, windowCount, lastSnapshotAt }
  const sockets = new Map();
  // userId -> { socketIds: Set, publicState: "active"|"inactive", lastActiveAt: ms|null, lastPersistedAt: ms }
  const users = new Map();
  let sweepTimer = null;

  const safe = async (operation, userId, fn) => {
    try {
      return await fn();
    } catch (error) {
      try {
        log.error("Presence failure", { operation, userId: userId ? String(userId) : null, error: error && error.message });
      } catch {
        // logging must never throw into messaging
      }
      return undefined;
    }
  };

  // ---- profile + relationship lookups (database truth, never client input) ----
  const loadProfiles = async (ids) => {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) return new Map();
    const rows = await User.find({ _id: { $in: unique } })
      .select("isActive privacy.showActiveStatus lastActiveAt")
      .lean();
    const map = new Map();
    for (const row of rows) {
      map.set(String(row._id), {
        // Suspended / deactivated accounts are never shown. A missing stored
        // setting means ON.
        visible: row.isActive !== false && !(row.privacy && row.privacy.showActiveStatus === false),
        lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt).getTime() : null,
      });
    }
    return map;
  };

  // Users who share a conversation with `userId`, from the point of view of
  // that user's inbox (a conversation they deleted does not count).
  const partnerIdsOf = async (userId) => {
    const conversations = await Conversation.find({ participants: userId }).select("participants hiddenFor").lean();
    const partners = new Set();
    for (const conversation of conversations) {
      const hidden = (conversation.hiddenFor || []).map(String);
      if (hidden.includes(String(userId))) continue;
      for (const participant of conversation.participants || []) {
        if (participant && String(participant) !== String(userId)) partners.add(String(participant));
      }
    }
    return [...partners];
  };

  // Conversations of `subjectId`, as the pairs a recipient may be told about:
  // recipients who share a conversation that is not hidden for them.
  const viewerIdsFor = async (subjectId) => {
    const conversations = await Conversation.find({ participants: subjectId }).select("participants hiddenFor").lean();
    const viewers = new Set();
    for (const conversation of conversations) {
      const hidden = (conversation.hiddenFor || []).map(String);
      for (const participant of conversation.participants || []) {
        const id = participant ? String(participant) : null;
        if (id && id !== String(subjectId) && !hidden.includes(id)) viewers.add(id);
      }
    }
    return [...viewers];
  };

  // ---- in-memory state ----
  const getUserState = (userId) => users.get(String(userId));

  const isSocketActive = (entry, now) => entry.state === "active" && now - entry.lastActivityAt <= cfg.ACTIVE_GRACE_MS;

  const computeUser = (userId, now) => {
    const record = getUserState(userId);
    if (!record) return { active: false, lastActivity: null };
    let active = false;
    let lastActivity = record.lastActiveAt;
    for (const socketId of record.socketIds) {
      const entry = sockets.get(socketId);
      if (!entry) continue;
      if (isSocketActive(entry, now)) active = true;
      if (entry.state === "active" && (lastActivity === null || entry.lastActivityAt > lastActivity)) {
        lastActivity = entry.lastActivityAt;
      }
    }
    return { active, lastActivity };
  };

  const publicPayload = (userId, subject, now) => {
    if (!subject.visible) return { userId: String(userId), state: STATES.HIDDEN, lastActiveAt: null };
    const record = getUserState(userId);
    const { active } = computeUser(userId, now);
    const lastMs = record && record.lastActiveAt !== null ? record.lastActiveAt : subject.lastActiveAt;
    return {
      userId: String(userId),
      state: active ? STATES.ACTIVE : STATES.INACTIVE,
      lastActiveAt: lastMs ? new Date(lastMs).toISOString() : null,
    };
  };

  const isOnline = (userId) => {
    const record = getUserState(userId);
    return Boolean(record && record.socketIds.size > 0);
  };

  const emitToUser = (userId, event, payload) => io.to(`user:${String(userId)}`).emit(event, payload);

  const persistLastActive = (userId, ms, { force = false } = {}) => {
    const record = getUserState(userId);
    const now = Date.now();
    if (record && !force && now - (record.lastPersistedAt || 0) < cfg.PERSIST_MIN_INTERVAL_MS) return;
    if (record) record.lastPersistedAt = now;
    return safe("persistLastActive", userId, () => User.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date(ms) } }));
  };

  // Tell the people who may see `userId` about their current status.
  //
  // A hidden user is NEVER announced on ordinary activity changes: even a
  // "hidden" message arriving exactly when they become active or idle would
  // reveal their activity timing. `announceHidden` is set only when the user
  // has just changed the setting, so peers clear what they were showing.
  const broadcast = (userId, { announceHidden = false } = {}) =>
    safe("broadcast", userId, async () => {
      const now = Date.now();
      const viewerIds = await viewerIdsFor(userId);
      const profiles = await loadProfiles([userId, ...viewerIds]);
      const subject = profiles.get(String(userId)) || { visible: false, lastActiveAt: null };
      if (!subject.visible && !announceHidden) return;
      const payload = publicPayload(userId, subject, now);
      for (const viewerId of viewerIds) {
        if (!isOnline(viewerId)) continue;
        const viewer = profiles.get(viewerId) || { visible: false };
        // "hidden" reveals nothing, so it goes to every online partner; a
        // real status only goes to viewers the privacy rule allows.
        if (subject.visible && !canView(viewer, subject)) continue;
        emitToUser(viewerId, EVENTS.CHANGED, payload);
      }
    });

  // Recompute a user's aggregate; on a change, persist and broadcast.
  const reconcile = (userId, { disconnected = false } = {}) =>
    safe("reconcile", userId, async () => {
      const record = getUserState(userId);
      if (!record) return;
      const now = Date.now();
      const { active, lastActivity } = computeUser(userId, now);
      const was = record.publicState;
      const next = active ? STATES.ACTIVE : STATES.INACTIVE;
      if (disconnected) record.lastActiveAt = now; // last socket gone: active until now
      else if (lastActivity !== null) record.lastActiveAt = lastActivity;
      record.publicState = next;
      const changed = disconnected || was !== next;
      if (changed) persistLastActive(userId, record.lastActiveAt ?? now, { force: true });
      else if (next === STATES.ACTIVE) persistLastActive(userId, record.lastActiveAt ?? now); // throttled
      if (changed) await broadcast(userId);
    });

  // ---- snapshot ----
  const buildSnapshot = async (userId) => {
    const partnerIds = await partnerIdsOf(userId);
    const profiles = await loadProfiles([userId, ...partnerIds]);
    const viewer = profiles.get(String(userId)) || { visible: false };
    // A user who hides their own status receives nobody's.
    if (!viewer.visible) return [];
    const now = Date.now();
    const list = [];
    for (const partnerId of partnerIds) {
      const subject = profiles.get(partnerId);
      if (!subject || !canView(viewer, subject)) continue; // hidden users are omitted
      list.push(publicPayload(partnerId, subject, now));
    }
    return list;
  };

  const sendSnapshot = (userId, target) =>
    safe("snapshot", userId, async () => {
      const list = await buildSnapshot(userId);
      const payload = { users: list };
      if (target) target.emit(EVENTS.SNAPSHOT, payload);
      else emitToUser(userId, EVENTS.SNAPSHOT, payload);
    });

  // ---- socket lifecycle ----
  const handleConnection = (socket) => {
    const userId = socket.userId ? String(socket.userId) : null;
    if (!userId) return; // only authenticated sockets take part
    try {
      const now = Date.now();
      sockets.set(socket.id, { userId, state: "idle", lastActivityAt: now, lastUpdateAt: 0, windowStart: now, windowCount: 0, lastSnapshotAt: 0 });
      if (!users.has(userId)) users.set(userId, { socketIds: new Set(), publicState: STATES.INACTIVE, lastActiveAt: null, lastPersistedAt: 0 });
      users.get(userId).socketIds.add(socket.id);

      socket.on(EVENTS.UPDATE, (payload) => {
        safe("update", userId, async () => {
          const entry = sockets.get(socket.id);
          if (!entry) return;
          if (!payload || (payload.state !== "active" && payload.state !== "idle")) return; // validate
          const at = Date.now();
          // Rate limit: minimum gap, plus a per-minute cap.
          if (at - entry.lastUpdateAt < cfg.UPDATE_MIN_INTERVAL_MS) return;
          if (at - entry.windowStart > 60 * 1000) {
            entry.windowStart = at;
            entry.windowCount = 0;
          }
          if (entry.windowCount >= cfg.UPDATE_MAX_PER_MINUTE) return;
          entry.windowCount += 1;
          entry.lastUpdateAt = at;
          entry.state = payload.state;
          if (payload.state === "active") entry.lastActivityAt = at;
          await reconcile(userId);
        });
      });

      socket.on(EVENTS.SNAPSHOT_REQUEST, () => {
        safe("snapshotRequest", userId, async () => {
          const entry = sockets.get(socket.id);
          if (!entry) return;
          const at = Date.now();
          if (at - entry.lastSnapshotAt < cfg.SNAPSHOT_MIN_INTERVAL_MS) return;
          entry.lastSnapshotAt = at;
          await sendSnapshot(userId, socket);
        });
      });

      socket.on("disconnect", () => handleDisconnect(socket));
    } catch (error) {
      log.error("Presence failure", { operation: "connection", userId, error: error && error.message });
    }
  };

  const handleDisconnect = (socket) =>
    safe("disconnect", socket.userId, async () => {
      const entry = sockets.get(socket.id);
      if (!entry) return;
      sockets.delete(socket.id);
      const record = getUserState(entry.userId);
      if (!record) return;
      record.socketIds.delete(socket.id);
      if (record.socketIds.size === 0) {
        // Last socket gone (closed tab, logout, lost connection): not active
        // now, lastActiveAt = now.
        await reconcile(entry.userId, { disconnected: true });
        users.delete(entry.userId);
      } else {
        await reconcile(entry.userId);
      }
    });

  // ---- sweep ----
  const sweep = () =>
    safe("sweep", null, async () => {
      const now = Date.now();
      for (const [socketId, entry] of [...sockets]) {
        // A socket the server no longer knows about is a ghost: drop it.
        const live = io.sockets && io.sockets.sockets ? io.sockets.sockets.has(socketId) : true;
        if (!live) {
          sockets.delete(socketId);
          const record = getUserState(entry.userId);
          if (record) record.socketIds.delete(socketId);
        }
      }
      for (const userId of [...users.keys()]) {
        const record = getUserState(userId);
        if (!record) continue;
        if (record.socketIds.size === 0) {
          await reconcile(userId, { disconnected: true });
          users.delete(userId);
          continue;
        }
        const { active } = computeUser(userId, now);
        const next = active ? STATES.ACTIVE : STATES.INACTIVE;
        if (next !== record.publicState) await reconcile(userId);
      }
    });

  const start = () => {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweep, cfg.SWEEP_INTERVAL_MS);
    if (sweepTimer.unref) sweepTimer.unref();
  };

  const stop = () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  };

  // Called by the settings route right after "Show my active status" changes,
  // so it takes effect over the existing sockets with no reconnect.
  const onVisibilityChanged = (userId) =>
    safe("visibilityChanged", userId, async () => {
      const profiles = await loadProfiles([userId]);
      const me = profiles.get(String(userId)) || { visible: false };
      await broadcast(userId, { announceHidden: true }); // peers: hidden (off) or the current state (on)
      if (me.visible) {
        await sendSnapshot(userId); // fresh snapshot for the user
      } else {
        emitToUser(userId, EVENTS.RESET, {}); // the user stops seeing anyone
      }
    });

  return {
    config: cfg,
    handleConnection,
    handleDisconnect,
    sweep,
    start,
    stop,
    onVisibilityChanged,
    // exposed for tests
    _state: { sockets, users },
  };
};

module.exports = { createActiveStatusService, ACTIVE_STATUS_CONFIG, EVENTS, STATES, canView };
