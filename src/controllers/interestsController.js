import pool from '../config/database.js';
// Logging is optional - comment out if winston isn't installed
// import { createRequire } from 'module';
// const require = createRequire(import.meta.url);
// const logger = require('../config/logger.cjs');
const logger = { info: () => {}, error: () => {} }; // Simple stub logger

// Get user's interests
const getUserInterests = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT interest_type, interest_value FROM user_interests WHERE user_id = $1',
      [req.user.userId]
    );

    // Group by type for easier frontend consumption
    const interests = {
      frameworks: [],
      taxa: [],
      geographies: [],
      ecosystems: [],
      methods: [],
      keywords: []
    };

    result.rows.forEach(row => {
      const key = row.interest_type === 'taxon' ? 'taxa' : `${row.interest_type}s`;
      if (interests[key]) {
        interests[key].push(row.interest_value);
      }
    });

    res.json({ interests });
  } catch (error) {
    next(error);
  }
};

// Update user's interests (replaces all)
const updateUserInterests = async (req, res, next) => {
  const { interests } = req.body;

  try {
    // Start transaction
    await pool.query('BEGIN');

    // Delete existing interests
    await pool.query('DELETE FROM user_interests WHERE user_id = $1', [req.user.userId]);

    // Insert new interests
    const insertPromises = [];

    Object.entries(interests).forEach(([type, values]) => {
      // Convert plural back to singular for DB
      let dbType = type;
      if (type === 'taxa') dbType = 'taxon';
      else if (type.endsWith('s')) dbType = type.slice(0, -1);

      values.forEach(value => {
        insertPromises.push(
          pool.query(
            'INSERT INTO user_interests (user_id, interest_type, interest_value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [req.user.userId, dbType, value]
          )
        );
      });
    });

    await Promise.all(insertPromises);
    await pool.query('COMMIT');

    logger.info(`User ${req.user.userId} updated interests`);
    res.json({ message: 'Interests updated successfully' });
  } catch (error) {
    await pool.query('ROLLBACK');
    next(error);
  }
};

// Get trending topics
const getTrendingTopics = async (req, res, next) => {
  const { limit = 10 } = req.query;

  try {
    const result = await pool.query(
      `SELECT topic_type, topic_value, SUM(mention_count) as total_mentions
       FROM trending_topics
       WHERE trend_date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY topic_type, topic_value
       ORDER BY total_mentions DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    const trending = {
      frameworks: [],
      taxa: [],
      geographies: [],
      ecosystems: [],
      keywords: []
    };

    result.rows.forEach(row => {
      const key = row.topic_type === 'taxon' ? 'taxa' : `${row.topic_type}s`;
      if (trending[key]) {
        trending[key].push({
          value: row.topic_value,
          mentions: parseInt(row.total_mentions)
        });
      }
    });

    res.json({ trending });
  } catch (error) {
    next(error);
  }
};

// Get activity feed for user
const getActivityFeed = async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Get recent research that matches user's interests
    const result = await pool.query(
      `SELECT DISTINCT
         r.id,
         r.title,
         r.created_at,
         'research' as content_type,
         ARRAY_AGG(DISTINCT ui.interest_type || ':' || ui.interest_value) as matched_interests
       FROM research_items r
       JOIN compass_metadata cm ON r.id = cm.research_id
       JOIN user_interests ui ON ui.user_id = $3
       WHERE (
         -- Match frameworks
         (ui.interest_type = 'framework' AND cm.framework_alignment @> jsonb_build_array(ui.interest_value))
         OR
         -- Match taxa
         (ui.interest_type = 'taxon' AND cm.taxon_scope @> jsonb_build_array(ui.interest_value))
         OR
         -- Match methods
         (ui.interest_type = 'method' AND cm.methods @> jsonb_build_array(ui.interest_value))
         OR
         -- Match geography (simplified - you might want more complex logic)
         (ui.interest_type = 'geography' AND cm.geo_scope_text ILIKE '%' || ui.interest_value || '%')
         OR
         -- Match keywords in title/abstract
         (ui.interest_type = 'keyword' AND (r.title ILIKE '%' || ui.interest_value || '%' OR r.abstract ILIKE '%' || ui.interest_value || '%'))
       )
       AND r.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY r.id, r.title, r.created_at
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset), req.user.userId]
    );

    const feed = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      type: row.content_type,
      createdAt: row.created_at,
      matchedInterests: row.matched_interests
    }));

    res.json({ feed, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    logger.error('Error fetching activity feed:', error);
    next(error);
  }
};

// Get available options for each interest type (for autocomplete)
const getAvailableInterests = async (req, res, next) => {
  const { q, type } = req.query;  // q = search query, type = interest type

  try {
    let frameworksResult;

    // If searching frameworks, query the frameworks table
    if (!type || type === 'frameworks') {
      frameworksResult = await pool.query(
        `SELECT code, name FROM frameworks
         WHERE LOWER(code) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1)
         ORDER BY code LIMIT 20`,
        [`%${q || ''}%`]
      );

      if (type === 'frameworks') {
        return res.json({
          frameworks: frameworksResult.rows.map(r => ({ code: r.code, name: r.name }))
        });
      }
    }

    // For taxa, methods - get from compass_metadata or predefined list
    const taxa = [
      'Fish', 'Sharks', 'Rays', 'Marine Mammals', 'Whales', 'Dolphins', 'Seals',
      'Sea Turtles', 'Seabirds', 'Corals', 'Sponges', 'Mollusks', 'Crustaceans',
      'Echinoderms', 'Zooplankton', 'Phytoplankton', 'Seagrasses', 'Macroalgae',
      'Microalgae', 'Bacteria', 'Archaea', 'Viruses', 'Jellyfish', 'Cephalopods',
      'Octopus', 'Squid', 'Worms', 'Bryozoans', 'Anemones', 'Krill'
    ].filter(t => !q || t.toLowerCase().includes(q.toLowerCase())).slice(0, 20);

    const methods = [
      'Field Surveys', 'Remote Sensing', 'Acoustic Monitoring', 'Satellite Imagery',
      'DNA Barcoding', 'Genomics', 'Metagenomics', 'eDNA', 'Stable Isotope Analysis',
      'Mark-Recapture', 'Telemetry', 'Video Surveys', 'ROV', 'Submersible',
      'Scuba Diving', 'Experimental Studies', 'Mesocosm', 'Laboratory Analysis',
      'Statistical Modeling', 'Species Distribution Modeling', 'Niche Modeling',
      'Social Surveys', 'Economic Valuation', 'Participatory Research',
      'Citizen Science', 'Long-term Monitoring', 'Tagging', 'Otolith Analysis'
    ].filter(m => !q || m.toLowerCase().includes(q.toLowerCase())).slice(0, 20);

    const geographies = [
      'Antarctic', 'Arctic', 'Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean',
      'Southern Ocean', 'Mediterranean Sea', 'Caribbean', 'North Sea', 'Baltic Sea',
      'Coral Triangle', 'Great Barrier Reef', 'Patagonia', 'Galapagos',
      'Red Sea', 'Persian Gulf', 'Gulf of Mexico', 'Bering Sea', 'Scotia Sea'
    ].filter(g => !q || g.toLowerCase().includes(q.toLowerCase())).slice(0, 20);

    // IUCN Global Ecosystem Typology - Marine & Coastal systems
    const ecosystems = [
      // Marine Shelf (M1)
      'M1.1 Seagrass meadows', 'M1.2 Kelp forests', 'M1.3 Photic coral reefs',
      'M1.4 Shellfish beds', 'M1.5 Photo-limited marine animal forests',
      'M1.6 Subtidal rocky reefs', 'M1.7 Subtidal sand beds', 'M1.8 Subtidal mud plains',
      'M1.9 Upwelling zones',
      // Pelagic Ocean Waters (M2)
      'M2.1 Epipelagic ocean waters', 'M2.2 Mesopelagic ocean waters',
      'M2.3 Bathypelagic ocean waters', 'M2.4 Abyssopelagic ocean waters',
      'M2.5 Sea ice',
      // Deep Sea Floors (M3)
      'M3.1 Continental slopes', 'M3.2 Submarine canyons', 'M3.3 Abyssal plains',
      'M3.4 Seamounts', 'M3.5 Deepwater biogenic beds', 'M3.6 Hadal trenches',
      'M3.7 Chemosynthetic ecosystems',
      // Anthropogenic Marine (M4)
      'M4.1 Submerged artificial structures', 'M4.2 Marine aquafarms',
      // Shoreline Systems (MT1-MT3)
      'MT1.1 Rocky shores', 'MT1.2 Muddy shores', 'MT1.3 Sandy shores',
      'MT2.1 Coastal shrublands', 'MT3.1 Artificial shorelines',
      // Supralittoral Coastal (MFT1)
      'MFT1.1 Coastal river deltas', 'MFT1.2 Intertidal forests',
      'MFT1.3 Coastal saltmarshes'
    ].filter(e => !q || e.toLowerCase().includes(q.toLowerCase())).slice(0, 20);

    res.json({
      frameworks: frameworksResult?.rows.map(r => ({ code: r.code, name: r.name })) || [],
      taxa,
      methods,
      geographies,
      ecosystems
    });
  } catch (error) {
    next(error);
  }
};

// Get featured frameworks for landing page (fallback when no trending data)
const getFeaturedFrameworks = async (req, res, next) => {
  const { limit = 12 } = req.query;

  try {
    // Get top frameworks by usage, or just return popular ones
    const result = await pool.query(
      `SELECT code, name, description
       FROM frameworks
       WHERE code LIKE 'SDG%' OR code IN ('CCAMLR', 'CBD-TARGET%', 'PA-ARTICLE%', 'RAMSAR')
       ORDER BY
         CASE
           WHEN code LIKE 'SDG%' THEN 1
           ELSE 2
         END,
         code
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({ frameworks: result.rows });
  } catch (error) {
    next(error);
  }
};

export {
  getUserInterests,
  updateUserInterests,
  getTrendingTopics,
  getActivityFeed,
  getAvailableInterests,
  getFeaturedFrameworks
};
