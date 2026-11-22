const express = require('express');
const router = express.Router();
const { hybridSearch, suggestJobs } = require('../controllers/recommendationController');
const { optionalAuth, requireJobViewAge } = require('../middleware/auth');
const { publicJobsListLimiter, visitorOnly } = require('../middleware/publicJobsLimiter');

// Use optional auth so unauthenticated users can still see jobs
// If token is present, req.user will be set; otherwise req.user = null
// A signed-out caller is rate limited per IP (signed-in users are not affected).
router.get('/jobs/suggest', optionalAuth, requireJobViewAge, suggestJobs);
router.get('/jobs', optionalAuth, visitorOnly(publicJobsListLimiter()), requireJobViewAge, hybridSearch);

module.exports = router;