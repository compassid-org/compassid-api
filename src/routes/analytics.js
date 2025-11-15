const express = require('express');
const analyticsController = require('../controllers/analyticsController.js');
const { authenticateToken } = require('../middleware/auth.cjs');
const UsageLimitMiddleware = require('../middleware/usageLimit.js');

const router = express.Router();

// Public endpoints - analytics data is public for transparency

// Get weekly trends for map visualization
router.get('/trends', analyticsController.getWeeklyTrends);

// Get analyzed papers with filters
router.get('/papers', analyticsController.getAnalyzedPapers);

// Get trending topics
router.get('/trending-topics', analyticsController.getTrendingTopics);

// Get analytics summary statistics
router.get('/summary', analyticsController.getAnalyticsSummary);

// Get map data (formatted for frontend map)
router.get('/map-data', analyticsController.getMapData);

// Get database statistics with growth metrics
router.get('/database-stats', analyticsController.getDatabaseStats);

// Get latest papers added to database
router.get('/latest-papers', analyticsController.getLatestPapers);

// Get temporal trends data for charts
router.get('/temporal-trends', analyticsController.getTemporalTrends);

// AI-Powered Insights: Research Gaps Analysis (Kosmos-inspired)
router.get('/research-gaps', authenticateToken, UsageLimitMiddleware.checkUsageLimit('ai_analysis'), analyticsController.getResearchGaps);

// AI-Powered Insights: Conservation Strategy Synthesis (Kosmos-inspired)
router.post('/synthesize-strategy', authenticateToken, UsageLimitMiddleware.checkUsageLimit('ai_synthesis'), analyticsController.synthesizeStrategy);

// AI-Powered Insights: Trending Discoveries (Kosmos-inspired)
router.get('/trending-discoveries', analyticsController.getTrendingDiscoveries);

// Get predictive analytics and trend forecasts
router.get('/predictions', analyticsController.getPredictiveAnalytics);

// Get collaboration networks and co-authorship patterns
router.get('/collaborations', analyticsController.getCollaborationNetworks);

// Get weekly highlights - compelling papers from last 7 days
router.get('/weekly-highlights', analyticsController.getWeeklyHighlights);

module.exports = router;
