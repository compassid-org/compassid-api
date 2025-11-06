import express from 'express';
import * as papersController from '../controllers/papersController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

export default router;
