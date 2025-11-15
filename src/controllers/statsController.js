const pool = require('../config/database.js');

const getStats = async (req, res, next) => {
  try {
    const totalResearch = await pool.query('SELECT COUNT(*) FROM research_items');
    const totalResearchers = await pool.query('SELECT COUNT(*) FROM users');
    const totalFrameworks = await pool.query(
      'SELECT COUNT(DISTINCT jsonb_array_elements_text(framework_alignment)) FROM compass_metadata'
    );

    const recentSubmissions = await pool.query(
      `SELECT r.id, r.title, r.created_at, u.first_name, u.last_name
       FROM research_items r
       JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC
       LIMIT 5`
    );

    const topFrameworks = await pool.query(
      `SELECT
        jsonb_array_elements_text(framework_alignment) as framework,
        COUNT(*) as count
       FROM compass_metadata
       GROUP BY framework
       ORDER BY count DESC
       LIMIT 10`
    );

    res.json({
      total_research: parseInt(totalResearch.rows[0].count),
      total_researchers: parseInt(totalResearchers.rows[0].count),
      total_frameworks: parseInt(totalFrameworks.rows[0].count),
      recent_submissions: recentSubmissions.rows,
      top_frameworks: topFrameworks.rows
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStats };