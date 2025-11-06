const express = require('express');
const router = express.Router();
const researchersController = require('../controllers/researchersController.cjs');

router.get('/find', researchersController.findResearchers);
router.get('/:id', researchersController.getResearcherProfile);

module.exports = router;