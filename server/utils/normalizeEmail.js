// Canonical form for every email address the app touches: trimmed and
// lowercased, so "Test@Gmail.com", "test@gmail.com ", and "TEST@GMAIL.COM"
// are always treated — and stored — as the same address. Used at every point
// an email enters a query or gets persisted, so there is exactly one place
// this can ever get wrong instead of one per call site.
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

module.exports = { normalizeEmail };
