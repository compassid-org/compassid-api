const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const analyticsController = require('../controllers/analyticsController.js');

router.get('/', statsController.getStats);

// Analytics endpoints (used by frontend home page)
router.get('/database-stats', analyticsController.getDatabaseStats);
router.get('/weekly-highlights', analyticsController.getWeeklyHighlights);

module.exports = router;