import express from 'express';
import * as messagesController from '../controllers/messagesController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticateToken } = require('../middleware/auth.cjs');

const router = express.Router();

router.post('/', authenticateToken, messagesController.sendMessage);
router.get('/conversations', authenticateToken, messagesController.getConversations);
router.get('/conversation/:userId', authenticateToken, messagesController.getConversationMessages);
router.put('/:id/read', authenticateToken, messagesController.markAsRead);
router.delete('/:id', authenticateToken, messagesController.deleteMessage);
router.get('/unread/count', authenticateToken, messagesController.getUnreadCount);

export default router;
