const express = require('express');
const router = express.Router();
const researchController = require('../controllers/researchController');
const { authenticateToken, optionalAuth } = require('../middleware/auth.cjs');
const { validateRequest, schemas } = require('../middleware/validation');
const UsageLimitMiddleware = require('../middleware/usageLimit');

router.post('/submit', authenticateToken, validateRequest(schemas.researchSubmit), researchController.submitResearch);
router.post('/preview-suggestions', researchController.previewAISuggestions);
router.post('/:id/generate-metadata', researchController.generateMetadataForPaper);
router.post('/natural-language-search', authenticateToken, UsageLimitMiddleware.checkUsageLimit('ai_search'), researchController.naturalLanguageSearch);
router.get('/search', researchController.searchResearch);
router.get('/map', researchController.getResearchForMap);
router.get('/my-research', authenticateToken, researchController.getMyResearch);
router.get('/my-suggestions', authenticateToken, researchController.getMySuggestions);
router.get('/pending-suggestions', authenticateToken, researchController.getPendingSuggestionsForMyResearch);
router.get('/:id', researchController.getResearchById);
router.get('/:id/suggestions', researchController.getSuggestionsForResearch);
router.put('/:id/suggest', authenticateToken, validateRequest(schemas.metadataSuggestion), researchController.suggestMetadata);
router.post('/suggestions/:id/review', authenticateToken, researchController.reviewSuggestion);

// Paper claiming endpoints
router.post('/:id/claim', authenticateToken, researchController.claimPaper);
router.get('/claims/my-claims', authenticateToken, researchController.getMyClaims);
router.get('/claims/pending', authenticateToken, researchController.getPendingClaims); // Admin only
router.put('/claims/:id/review', authenticateToken, researchController.reviewClaim); // Admin only

// Direct metadata editing (paper owners only)
router.put('/:id/metadata', authenticateToken, researchController.updateMetadataDirectly);
router.get('/:id/metadata-history', researchController.getMetadataHistory);

module.exports = router;