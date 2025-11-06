const express = require('express');
const router = express.Router();
const eventsController = require('../controllers/eventsController');
const { authenticateToken } = require('../middleware/auth.cjs');

// Public routes (no auth required for viewing public events)
router.get('/user/:userId', eventsController.getUserEvents);
router.get('/:id', eventsController.getEventById);

// Protected routes (require authentication)
router.post('/', authenticateToken, eventsController.createEvent);
router.put('/:id', authenticateToken, eventsController.updateEvent);
router.delete('/:id', authenticateToken, eventsController.deleteEvent);

module.exports = router;
