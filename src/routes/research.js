const express = require('express');
const router = express.Router();
const researchController = require('../controllers/researchController');
const { authenticateToken, optionalAuth } = require('../middleware/auth.cjs');
const { validateRequest, schemas } = require('../middleware/validation');

router.post('/submit', authenticateToken, validateRequest(schemas.researchSubmit), researchController.submitResearch);
router.post('/preview-suggestions', researchController.previewAISuggestions);
router.post('/:id/generate-metadata', researchController.generateMetadataForPaper);
router.post('/natural-language-search', optionalAuth, researchController.naturalLanguageSearch);
router.get('/search', researchController.searchResearch);
router.get('/map', researchController.getResearchForMap);
router.get('/my-research', authenticateToken, researchController.getMyResearch);
router.get('/my-suggestions', authenticateToken, researchController.getMySuggestions);
router.get('/pending-suggestions', authenticateToken, researchController.getPendingSuggestionsForMyResearch);
router.get('/:id', researchController.getResearchById);
router.get('/:id/suggestions', researchController.getSuggestionsForResearch);
router.put('/:id/suggest', authenticateToken, validateRequest(schemas.metadataSuggestion), researchController.suggestMetadata);
router.post('/suggestions/:id/review', authenticateToken, researchController.reviewSuggestion);

module.exports = router;