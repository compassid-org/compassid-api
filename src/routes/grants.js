const express = require('express');
const router = express.Router();
const grantsController = require('../controllers/grantsController');
const { authenticateToken, optionalAuth } = require('../middleware/auth.cjs');

// Public routes (with optional auth for bookmarking status)
router.get('/search', optionalAuth, grantsController.searchGrants);
router.get('/funders', grantsController.getFunders);
router.get('/tags', grantsController.getGrantTags);
router.get('/:id', optionalAuth, grantsController.getGrantById);

// Authenticated routes
router.post('/:id/bookmark', authenticateToken, grantsController.bookmarkGrant);
router.delete('/:id/bookmark', authenticateToken, grantsController.removeBookmark);
router.get('/user/bookmarks', authenticateToken, grantsController.getUserBookmarks);

// Grant creation/management (for funders and admins)
router.post('/', authenticateToken, grantsController.createGrant);
router.put('/:id', authenticateToken, grantsController.updateGrant);

module.exports = router;