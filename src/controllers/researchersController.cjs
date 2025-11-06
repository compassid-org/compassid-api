const pool = require('../config/database.cjs');

const findResearchers = async (req, res, next) => {
  try {
    const { frameworks, geo_region, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT DISTINCT
        u.id, u.first_name, u.last_name, u.institution, u.orcid_id,
        COUNT(DISTINCT r.id) as research_count,
        json_agg(DISTINCT c.framework_alignment) as frameworks
      FROM users u
      JOIN research_items r ON u.id = r.user_id
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE 1=1
    `;

    const params = [];
    let paramCounter = 1;

    if (frameworks) {
      const frameworkArray = frameworks.split(',');
      query += ` AND c.framework_alignment ?| $${paramCounter}`;
      params.push(frameworkArray);
      paramCounter++;
    }

    query += `
      GROUP BY u.id, u.first_name, u.last_name, u.institution, u.orcid_id
      ORDER BY research_count DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      researchers: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getResearcherProfile = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if the ID is a UUID or a compass_id
    const isUUID = id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const profileQuery = await pool.query(`
      SELECT
        id, email, first_name, last_name, institution, orcid_id, created_at, compass_id,
        position, department, bio, location, website, research_interests, avatar_url
      FROM users
      WHERE ${isUUID ? 'id' : 'compass_id'} = $1
    `, [id]);

    if (profileQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Researcher not found' });
    }

    const researcher = profileQuery.rows[0];
    const userId = researcher.id; // Use the actual user ID from the database

    const researchQuery = await pool.query(`
      SELECT
        r.id, r.title, r.abstract, r.doi, r.publication_year, r.journal, r.authors, r.created_at,
        c.framework_alignment, c.geo_scope_text, c.taxon_scope, c.methods,
        c.temporal_start, c.temporal_end, c.ecosystem_type
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
    `, [userId]);

    const frameworksQuery = await pool.query(`
      SELECT
        framework_elem.value as framework,
        COUNT(*) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      CROSS JOIN LATERAL jsonb_array_elements_text(c.framework_alignment) AS framework_elem(value)
      WHERE r.user_id = $1
      GROUP BY framework_elem.value
      ORDER BY count DESC
    `, [userId]);

    const statsQuery = await pool.query(`
      SELECT
        COUNT(DISTINCT r.id) as total_research,
        COUNT(DISTINCT CASE WHEN r.created_at > NOW() - INTERVAL '1 year' THEN r.id END) as recent_research,
        (
          SELECT array_agg(DISTINCT framework_elem)
          FROM research_items r2
          LEFT JOIN compass_metadata c2 ON r2.id = c2.research_id
          CROSS JOIN LATERAL jsonb_array_elements_text(c2.framework_alignment) AS framework_elem
          WHERE r2.user_id = $1
        ) as all_frameworks
      FROM research_items r
      WHERE r.user_id = $1
    `, [userId]);

    res.json({
      researcher: {
        ...researcher,
        email: undefined
      },
      research: researchQuery.rows,
      frameworks: frameworksQuery.rows,
      stats: statsQuery.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchPattern = `%${q}%`;

    const result = await pool.query(`
      SELECT
        id, first_name, last_name, email, institution, compass_id, avatar_url,
        position, department, bio
      FROM users
      WHERE first_name ILIKE $1
         OR last_name ILIKE $1
         OR email ILIKE $1
         OR institution ILIKE $1
         OR position ILIKE $1
      ORDER BY first_name, last_name
      LIMIT 20
    `, [searchPattern]);

    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { findResearchers, getResearcherProfile, searchUsers };