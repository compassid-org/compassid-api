const express = require('express');
const papersController = require('../controllers/papersController.js');
const { authenticateToken } = require('../middleware/auth.cjs');

const router = express.Router();

// Folders (must come before /:id routes)
router.post('/folders', authenticateToken, papersController.createFolder);
router.get('/folders', authenticateToken, papersController.getFolders);
router.post('/folders/:id/papers', authenticateToken, papersController.addPaperToFolder);
router.delete('/folders/:id/papers/:paper_id', authenticateToken, papersController.removePaperFromFolder);

// Papers
router.post('/save', authenticateToken, papersController.savePaper);
router.get('/saved', authenticateToken, papersController.getSavedPapers);
router.delete('/:id', authenticateToken, papersController.unsavePaper);

module.exports = router;
