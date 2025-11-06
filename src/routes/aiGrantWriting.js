const express = require('express');
const router = express.Router();
const aiGrantWritingController = require('../controllers/aiGrantWritingController');
const { authenticateToken } = require('../middleware/auth.cjs');

// All routes require authentication
router.use(authenticateToken);

// Templates
router.get('/templates', aiGrantWritingController.getTemplates);

// Grant applications
router.get('/applications', aiGrantWritingController.getUserApplications);
router.post('/applications', aiGrantWritingController.createApplication);
router.get('/applications/:id', aiGrantWritingController.getApplication);
router.put('/applications/:id', aiGrantWritingController.updateApplication);

// AI assistance
router.post('/generate', aiGrantWritingController.generateContent);

// Writing tips
router.get('/tips', aiGrantWritingController.getWritingTips);

// Subscription management
router.get('/subscription/plans', aiGrantWritingController.getSubscriptionPlans);
router.get('/subscription/status', aiGrantWritingController.getSubscriptionStatus);

module.exports = router;