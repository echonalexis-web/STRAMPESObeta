const router = require("express").Router();
const { verifyToken: protect } = require("../middleware/auth");
const { sanitizeQueryParams } = require("../middleware/validation");
const { getSignedUrl } = require("../controllers/fileController");

// Resolve a private storage ref to a short-lived signed URL.
router.get("/signed-url", protect, sanitizeQueryParams, getSignedUrl);

module.exports = router;
