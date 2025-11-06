import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';

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

// Get research gaps analysis
router.get('/research-gaps', analyticsController.getResearchGaps);

// Get predictive analytics and trend forecasts
router.get('/predictions', analyticsController.getPredictiveAnalytics);

// Get collaboration networks and co-authorship patterns
router.get('/collaborations', analyticsController.getCollaborationNetworks);

// Get weekly highlights - compelling papers from last 7 days
router.get('/weekly-highlights', analyticsController.getWeeklyHighlights);

export default router;
