const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');
const { authenticate } = require('../middleware/auth.cjs');

// Create checkout session (requires authentication)
router.post('/create-checkout-session', authenticate, stripeController.createCheckoutSession);

// Create customer portal session (requires authentication)
router.post('/create-portal-session', authenticate, stripeController.createPortalSession);

// Get user's subscription details (requires authentication)
router.get('/subscription', authenticate, stripeController.getSubscription);

// Cancel subscription (requires authentication)
router.post('/cancel-subscription', authenticate, stripeController.cancelSubscription);

// Webhook endpoint (NO authentication - Stripe calls this)
// NOTE: This must use raw body, not JSON parsed body
router.post('/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

module.exports = router;
