// Realtime "new announcement" push (event: news:published).
//
// Called once, best-effort, AFTER a news item has been saved as published. It
// tells online users who are allowed to see the item that something new is
// there, so the client can offer a Refresh. It carries no body text and no
// author details, only what the toast needs.
//
// Audience is decided on the server, never from client input:
//   - the category rule is the same one notifyNewsPublished uses for the bell:
//     hiring / training / advisory / spes are jobseeker-only, general / event
//     also go to employers;
//   - staff (admin, superadmin) are not sent it: they publish from the admin
//     UI and are not in the notification audience either;
//   - the role and isActive flag are re-read from the database for the
//     connected user ids, because socket.userRole is only a claim copied from
//     the JWT at handshake time and can be stale;
//   - the author's own sockets are skipped.
//
// Note: io.fetchSockets() only sees sockets connected to THIS server
// instance. With several instances and no Socket.IO adapter, users on other
// instances do not get the event (the client also re-checks on reconnect).
const User = require("../models/User");

// Categories that only matter to jobseekers; also used by newsController.
const JOBSEEKER_ONLY_CATEGORIES = ["hiring", "training", "advisory", "spes"];

// Legacy role names still treated as jobseekers across the app.
const JOBSEEKER_ROLES = ["jobseeker", "employee", "resident"];
const EMPLOYER_ROLES = ["employer"];

const NEWS_PUBLISHED_EVENT = "news:published";

const audienceRolesFor = (category) =>
  JOBSEEKER_ONLY_CATEGORIES.includes(category) ? JOBSEEKER_ROLES : [...JOBSEEKER_ROLES, ...EMPLOYER_ROLES];

// Minimal payload: id, title, category, published time. Nothing else.
const buildNewsPublishedPayload = (announcement) => ({
  id: String(announcement._id),
  title: announcement.title,
  category: announcement.category,
  publishedAt: new Date(announcement.publishedAt || announcement.createdAt || Date.now()).toISOString(),
});

/**
 * @param {{io: import("socket.io").Server|null, announcement: object, authorId?: string}} args
 * @returns {Promise<number>} how many users the event was sent to
 */
const emitNewsPublished = async ({ io, announcement, authorId }) => {
  if (!io || typeof io.fetchSockets !== "function") return 0;

  const sockets = await io.fetchSockets();
  const author = authorId ? String(authorId) : null;
  const connectedIds = [...new Set(sockets.map((socket) => (socket.userId ? String(socket.userId) : null)).filter(Boolean))].filter(
    (id) => id !== author
  );
  if (connectedIds.length === 0) return 0;

  const recipients = await User.find({
    _id: { $in: connectedIds },
    role: { $in: audienceRolesFor(announcement.category) },
    isActive: { $ne: false },
  }).select("_id");

  const payload = buildNewsPublishedPayload(announcement);
  for (const recipient of recipients) {
    io.to(`user:${String(recipient._id)}`).emit(NEWS_PUBLISHED_EVENT, payload);
  }
  return recipients.length;
};

module.exports = {
  JOBSEEKER_ONLY_CATEGORIES,
  NEWS_PUBLISHED_EVENT,
  audienceRolesFor,
  buildNewsPublishedPayload,
  emitNewsPublished,
};
