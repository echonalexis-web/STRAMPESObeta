// Real-time session revocation. Blocking a suspended/deleted/deactivated
// account's *next* HTTP request already happens unconditionally in
// middleware/auth.js (every request re-checks the User document) — that part
// needs no help from Socket.IO. This module covers the gap that leaves: a
// browser tab the account already has open, sitting idle, with nothing new
// to trigger that re-check. Emitting straight to the account's socket room
// lets an admin action end that session immediately instead of only once the
// user happens to click something.
const forceLogout = (io, userId, payload = {}) => {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit("account:forced_logout", payload);
};

module.exports = { forceLogout };
