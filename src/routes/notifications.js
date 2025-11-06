import express from 'express';
import * as notificationsController from '../controllers/notificationsController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticateToken } = require('../middleware/auth.cjs');

const router = express.Router();

router.get('/', authenticateToken, notificationsController.getNotifications);
router.put('/:id/read', authenticateToken, notificationsController.markAsRead);
router.put('/read-all', authenticateToken, notificationsController.markAllAsRead);
router.get('/unread/count', authenticateToken, notificationsController.getUnreadCount);
router.delete('/:id', authenticateToken, notificationsController.deleteNotification);

export default router;
