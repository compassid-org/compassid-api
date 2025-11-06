const express = require('express');
const { authenticateToken } = require('../middleware/auth.cjs');
const {
  // Institutions
  getInstitutions,
  createInstitution,
  getUserInstitutions,

  // Job Postings
  getJobPostings,
  getJobPosting,
  createJobPosting,
  updateJobPosting,

  // Applications
  applyToJob,
  getUserApplications,

  // Utilities
  getJobCategories,
  toggleSavedJob,
  getSavedJobs
} = require('../controllers/jobBoardController');

const router = express.Router();

// =============================================================================
// INSTITUTION ROUTES
// =============================================================================

// Public routes
router.get('/institutions', getInstitutions);

// Protected routes (require authentication)
router.post('/institutions', authenticateToken, createInstitution);
router.get('/my/institutions', authenticateToken, getUserInstitutions);

// =============================================================================
// JOB POSTING ROUTES
// =============================================================================

// Public routes
router.get('/postings', getJobPostings);
router.get('/postings/:id', getJobPosting);

// Protected routes (require authentication)
router.post('/postings', authenticateToken, createJobPosting);
router.put('/postings/:id', authenticateToken, updateJobPosting);

// =============================================================================
// JOB APPLICATION ROUTES
// =============================================================================

// All application routes require authentication
router.post('/postings/:job_posting_id/apply', authenticateToken, applyToJob);
router.get('/my/applications', authenticateToken, getUserApplications);

// =============================================================================
// SAVED JOBS ROUTES
// =============================================================================

router.post('/postings/:job_posting_id/save', authenticateToken, toggleSavedJob);
router.get('/my/saved', authenticateToken, getSavedJobs);

// =============================================================================
// UTILITY ROUTES
// =============================================================================

// Public routes
router.get('/categories', getJobCategories);

module.exports = router;