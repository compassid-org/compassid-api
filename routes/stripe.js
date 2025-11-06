import express from 'express';
import jwt from 'jsonwebtoken';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  cancelSubscription,
  handleWebhook
} from '../src/controllers/stripeController.js';

const router = express.Router();

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = req.cookies?.token || (authHeader && authHeader.split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Create checkout session (requires authentication)
router.post('/create-checkout-session', authenticate, createCheckoutSession);

// Create customer portal session (requires authentication)
router.post('/create-portal-session', authenticate, createPortalSession);

// Get user's subscription details (requires authentication)
router.get('/subscription', authenticate, getSubscription);

// Cancel subscription (requires authentication)
router.post('/cancel-subscription', authenticate, cancelSubscription);

// Webhook endpoint (NO authentication - Stripe calls this)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

export default router;
