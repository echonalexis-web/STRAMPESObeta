// Where links in outbound email/redirects should point (the SPA). Falls back
// to the first allowed client origin, then localhost dev. Extracted out of
// authController.js (its original home) so other services — notificationService
// / emailOutboxService, building links into notification emails — can build
// the same absolute URLs without duplicating this logic.
const clientBaseUrl = () =>
  (process.env.APP_URL ||
    (process.env.CLIENT_ORIGINS || "http://localhost:5173").split(",")[0] ||
    "http://localhost:5173")
    .trim()
    .replace(/\/+$/, "");

module.exports = { clientBaseUrl };
