const express = require('express');
const router = express.Router();
const pool = require('../../config/database.js');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        code,
        name,
        description,
        parent_id,
        version,
        category,
        created_at
      FROM frameworks
      ORDER BY parent_id NULLS FIRST, code ASC
    `);

    res.json({
      frameworks: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching frameworks:', error);
    res.status(500).json({ error: 'Failed to fetch frameworks' });
  }
});

module.exports = router;