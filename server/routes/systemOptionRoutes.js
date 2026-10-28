const router = require("express").Router();
const { verifyToken: protect, isSuperadmin } = require("../middleware/auth");
const { sanitizeRequestBody, sanitizeQueryParams, validateMongoId } = require("../middleware/validation");
const { detectMaliciousPayload } = require("../middleware/security");
const {
  listByCategory,
  createOption,
  updateOption,
  deleteOption,
} = require("../controllers/systemOptionController");

router.use(protect);

// Any authenticated role can read — the job posting form, filters, and
// edit-profile dropdowns all need this regardless of who's viewing them.
router.get("/:category", sanitizeQueryParams, listByCategory);

// Catalog-shaping writes are superadmin-only, matching the precedent set by
// match-weight bounds (another schema-shaping admin action).
router.post("/", isSuperadmin, sanitizeRequestBody, detectMaliciousPayload, createOption);
router.put("/:id", isSuperadmin, validateMongoId("id"), sanitizeRequestBody, detectMaliciousPayload, updateOption);
router.delete("/:id", isSuperadmin, validateMongoId("id"), deleteOption);

module.exports = router;
