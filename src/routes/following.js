import express from 'express';
import * as followController from '../controllers/followController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticateToken } = require('../middleware/auth.cjs');

const router = express.Router();

router.post('/users/:id/follow', authenticateToken, followController.followUser);
router.delete('/users/:id/follow', authenticateToken, followController.unfollowUser);
router.get('/users/:id/followers', authenticateToken, followController.getFollowers);
router.get('/users/:id/following', authenticateToken, followController.getFollowing);
router.get('/users/:id/follow-status', authenticateToken, followController.checkFollowStatus);

export default router;
