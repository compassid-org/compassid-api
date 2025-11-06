const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { authenticateToken, optionalAuth } = require('../middleware/auth.cjs');

// Public routes
router.get('/posts', blogController.getAllPosts);
router.get('/posts/:slug', blogController.getPostBySlug);
router.get('/categories', blogController.getCategories);
router.get('/tags', blogController.getTags);

// Comment routes (with optional auth for guest comments)
router.post('/posts/:slug/comments', optionalAuth, blogController.addComment);

// Admin routes (require authentication and admin/editor role)
router.post('/posts', authenticateToken, blogController.createPost);
router.put('/posts/:id', authenticateToken, blogController.updatePost);
router.delete('/posts/:id', authenticateToken, blogController.deletePost);

module.exports = router;