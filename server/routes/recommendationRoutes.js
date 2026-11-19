const express = require('express');
const router = express.Router();
const { hybridSearch, suggestJobs } = require('../controllers/recommendationController');
const { optionalAuth, requireJobViewAge } = require('../middleware/auth');

// Use optional auth so unauthenticated users can still see jobs
// If token is present, req.user will be set; otherwise req.user = null
router.get('/jobs/suggest', optionalAuth, requireJobViewAge, suggestJobs);
router.get('/jobs', optionalAuth, requireJobViewAge, hybridSearch);

module.exports = router;