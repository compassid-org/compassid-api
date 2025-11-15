const express = require('express');
const creditsController = require('../controllers/creditsController.js');
const { authenticateToken } = require('../middleware/auth.cjs');

const router = express.Router();

// Get available credit packs (public - no auth required)
router.get('/packs', creditsController.getCreditPacks);

// Create checkout session for credit purchase (requires authentication)
router.post('/purchase', authenticateToken, creditsController.createCreditPurchaseSession);

// Get user's credit balance and usage (requires authentication)
router.get('/balance', authenticateToken, creditsController.getCreditBalance);

// Get usage summary across all AI features (requires authentication)
router.get('/usage-summary', authenticateToken, creditsController.getUsageSummary);

// Webhook endpoint for credit purchases (NO authentication - Stripe calls this)
// NOTE: This must use raw body, not JSON parsed body
router.post('/webhook', express.raw({ type: 'application/json' }), creditsController.handleCreditPurchaseWebhook);

module.exports = router;
