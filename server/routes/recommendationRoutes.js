const express = require('express');
const router = express.Router();
const { hybridSearch } = require('../controllers/recommendationController');
const { optionalAuth } = require('../middleware/auth');

// Use optional auth so unauthenticated users can still see jobs
// If token is present, req.user will be set; otherwise req.user = null
router.get('/jobs', optionalAuth, hybridSearch);

module.exports = router;