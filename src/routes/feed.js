const express = require('express');
const router = express.Router();
const feedController = require('../controllers/feedController');
const { authenticateToken, optionalAuth } = require('../middleware/auth.cjs');

// Public routes (with optional auth for user-specific data)
router.get('/posts', optionalAuth, feedController.getFeed);
router.get('/hashtags/trending', feedController.getTrendingHashtags);
router.get('/posts/:id/replies', optionalAuth, feedController.getPostReplies);

// Authenticated routes
router.post('/posts', authenticateToken, feedController.createPost);
router.post('/posts/:id/like', authenticateToken, feedController.likePost);
router.delete('/posts/:id/like', authenticateToken, feedController.unlikePost);
router.post('/posts/:id/share', authenticateToken, feedController.sharePost);
router.delete('/posts/:id/share', authenticateToken, feedController.unsharePost);
router.delete('/posts/:id', authenticateToken, feedController.deletePost);

module.exports = router;