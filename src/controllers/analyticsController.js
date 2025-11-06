import Anthropic from '@anthropic-ai/sdk';
import pool from '../../config/database.js';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// In-memory cache for geocoded coordinates (persist across requests)
const geocodeCache = new Map();

/**
 * Get weekly trends for the analytics map
 * @route GET /api/analytics/trends
 * @query {string} week_start - Optional: ISO date for specific week
 * @query {string} region - Optional: Filter by region
 */
export async function getWeeklyTrends(req, res) {
  try {
    const { week_start, region } = req.query;

    let query = `
      SELECT
        id,
        week_start,
        region,
        activity_score,
        studies_count,
        datasets_count,
        researchers_count,
        topic_focus,
        trend,
        dominant_taxa,
        dominant_framework,
        dominant_ecosystem,
        methods,
        created_at
      FROM weekly_trends
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (week_start) {
      query += ` AND week_start = $${paramCount}`;
      params.push(week_start);
      paramCount++;
    } else {
      // Default: get most recent week
      query += ` AND week_start = (SELECT MAX(week_start) FROM weekly_trends)`;
    }

    if (region) {
      query += ` AND region = $${paramCount}`;
      params.push(region);
      paramCount++;
    }

    query += ` ORDER BY activity_score DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      trends: result.rows,
    });
  } catch (error) {
    console.error('Get weekly trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly trends',
    });
  }
}

/**
 * Get analyzed papers with optional filters
 * @route GET /api/analytics/papers
 * @query {number} week_number - Optional: Filter by week number
 * @query {string} region - Optional: Filter by region
 * @query {string} framework - Optional: Filter by framework
 * @query {string} taxa - Optional: Filter by taxa
 * @query {number} limit - Optional: Limit results (default: 50)
 * @query {number} offset - Optional: Offset for pagination (default: 0)
 */
export async function getAnalyzedPapers(req, res) {
  try {
    const {
      week_number,
      region,
      framework,
      taxa,
      ecosystem,
      methods,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT
        id,
        doi,
        title,
        abstract,
        authors,
        published_date,
        journal,
        framework,
        taxa,
        ecosystem,
        region,
        methods,
        week_number,
        analyzed_at,
        created_at
      FROM analyzed_papers
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (week_number) {
      query += ` AND week_number = $${paramCount}`;
      params.push(week_number);
      paramCount++;
    }

    if (region) {
      query += ` AND region = $${paramCount}`;
      params.push(region);
      paramCount++;
    }

    if (framework) {
      query += ` AND framework = $${paramCount}`;
      params.push(framework);
      paramCount++;
    }

    if (taxa) {
      query += ` AND taxa = $${paramCount}`;
      params.push(taxa);
      paramCount++;
    }

    if (ecosystem) {
      query += ` AND ecosystem = $${paramCount}`;
      params.push(ecosystem);
      paramCount++;
    }

    if (methods) {
      // Filter by JSONB array containing the method
      query += ` AND methods @> $${paramCount}::jsonb`;
      params.push(JSON.stringify([methods]));
      paramCount++;
    }

    query += ` ORDER BY analyzed_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM analyzed_papers WHERE 1=1`;
    const countParams = [];
    let countParamIdx = 1;

    if (week_number) {
      countQuery += ` AND week_number = $${countParamIdx}`;
      countParams.push(week_number);
      countParamIdx++;
    }

    if (region) {
      countQuery += ` AND region = $${countParamIdx}`;
      countParams.push(region);
      countParamIdx++;
    }

    if (framework) {
      countQuery += ` AND framework = $${countParamIdx}`;
      countParams.push(framework);
      countParamIdx++;
    }

    if (taxa) {
      countQuery += ` AND taxa = $${countParamIdx}`;
      countParams.push(taxa);
      countParamIdx++;
    }

    if (ecosystem) {
      countQuery += ` AND ecosystem = $${countParamIdx}`;
      countParams.push(ecosystem);
      countParamIdx++;
    }

    if (methods) {
      countQuery += ` AND methods @> $${countParamIdx}::jsonb`;
      countParams.push(JSON.stringify([methods]));
      countParamIdx++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      count: result.rows.length,
      total,
      offset: parseInt(offset),
      limit: parseInt(limit),
      papers: result.rows,
    });
  } catch (error) {
    console.error('Get analyzed papers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analyzed papers',
    });
  }
}

/**
 * Get trending topics across all COMPASS metadata dimensions
 * @route GET /api/analytics/trending-topics
 * @query {number} limit - Optional: Number of topics per category (default: 3)
 */
// NEW VERSION - Queries research_items + compass_metadata (the REAL 21K papers database)
export async function getTrendingTopics(req, res) {
  try {
    const { limit = 20, months = 6 } = req.query;

    // Validate and whitelist months parameter to prevent SQL injection
    const monthsStr = String(months);
    let monthsBack;
    if (['1', '3', '6', '12', '24'].includes(monthsStr)) {
      monthsBack = parseInt(monthsStr);
    } else {
      monthsBack = 6; // Default to 6 months if invalid
    }

    // Validate and sanitize limit parameter to prevent SQL injection
    const limitNum = Math.min(Math.max(parseInt(limit) || 3, 1), 50); // Cap between 1 and 50

    // Query frameworks (from framework_alignment JSONB array)
    const frameworksQuery = `
      SELECT
        jsonb_array_elements_text(c.framework_alignment) as name,
        COUNT(DISTINCT r.id) as paper_count,
        COUNT(DISTINCT c.geo_scope_text) as region_count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${monthsBack} months'
        AND r.publication_date IS NOT NULL
        AND c.framework_alignment IS NOT NULL
        AND c.framework_alignment != '[]'::jsonb
      GROUP BY name
      HAVING COUNT(DISTINCT r.id) >= 2
      ORDER BY paper_count DESC
      LIMIT ${limitNum}
    `;

    // Query taxa (from taxon_scope JSONB array) - use CTE to unnest first
    const taxaQuery = `
      WITH taxa_unnested AS (
        SELECT
          r.id as paper_id,
          (jsonb_array_elements(c.taxon_scope)->>'common_name') as taxon_name,
          c.geo_scope_text
        FROM research_items r
        JOIN compass_metadata c ON r.id = c.research_id
        WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${monthsBack} months'
          AND r.publication_date IS NOT NULL
          AND c.taxon_scope IS NOT NULL
          AND c.taxon_scope != '[]'::jsonb
          AND jsonb_array_length(c.taxon_scope) > 0
      )
      SELECT
        taxon_name as name,
        COUNT(DISTINCT paper_id) as paper_count,
        COUNT(DISTINCT geo_scope_text) as region_count
      FROM taxa_unnested
      WHERE taxon_name IS NOT NULL AND taxon_name != ''
      GROUP BY taxon_name
      HAVING COUNT(DISTINCT paper_id) >= 2
      ORDER BY paper_count DESC
      LIMIT ${limitNum}
    `;

    // Query ecosystems (from ecosystem_type text field)
    const ecosystemsQuery = `
      SELECT
        c.ecosystem_type as name,
        COUNT(DISTINCT r.id) as paper_count,
        COUNT(DISTINCT c.geo_scope_text) as region_count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${monthsBack} months'
        AND r.publication_date IS NOT NULL
        AND c.ecosystem_type IS NOT NULL
        AND c.ecosystem_type != ''
      GROUP BY c.ecosystem_type
      HAVING COUNT(DISTINCT r.id) >= 2
      ORDER BY paper_count DESC
      LIMIT ${limitNum}
    `;

    // Query regions (from geo_scope_text)
    // Use 12-month window for geography to capture more location trends
    const regionsQuery = `
      SELECT
        c.geo_scope_text as name,
        COUNT(DISTINCT r.id) as paper_count,
        1 as region_count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.publication_date >= CURRENT_DATE - INTERVAL '12 months'
        AND r.publication_date IS NOT NULL
        AND c.geo_scope_text IS NOT NULL
        AND c.geo_scope_text != ''
        AND c.geo_scope_text NOT ILIKE '%not specified%'
        AND c.geo_scope_text NOT ILIKE '%not applicable%'
        AND c.geo_scope_text NOT ILIKE '%unknown%'
        AND c.geo_scope_text NOT ILIKE 'n/a%'
        AND c.geo_scope_text NOT ILIKE '%laboratory%'
        AND c.geo_scope_text NOT ILIKE '%in vitro%'
        AND c.geo_scope_text NOT ILIKE 'global%'
      GROUP BY c.geo_scope_text
      HAVING COUNT(DISTINCT r.id) >= 2
      ORDER BY paper_count DESC
      LIMIT ${limitNum}
    `;

    // Query methods (from methods->research_methods JSONB array) - use CTE to unnest first
    const methodsQuery = `
      WITH methods_unnested AS (
        SELECT
          r.id as paper_id,
          jsonb_array_elements_text(c.methods->'research_methods') as method_name,
          c.geo_scope_text
        FROM research_items r
        JOIN compass_metadata c ON r.id = c.research_id
        WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${monthsBack} months'
          AND r.publication_date IS NOT NULL
          AND c.methods->'research_methods' IS NOT NULL
          AND jsonb_array_length(c.methods->'research_methods') > 0
      )
      SELECT
        method_name as name,
        COUNT(DISTINCT paper_id) as paper_count,
        COUNT(DISTINCT geo_scope_text) as region_count
      FROM methods_unnested
      WHERE method_name IS NOT NULL
      GROUP BY method_name
      HAVING COUNT(DISTINCT paper_id) >= 2
      ORDER BY paper_count DESC
      LIMIT ${limitNum}
    `;

    // Execute all queries in parallel
    const [frameworksResult, taxaResult, ecosystemsResult, regionsResult, methodsResult] = await Promise.all([
      pool.query(frameworksQuery),
      pool.query(taxaQuery),
      pool.query(ecosystemsQuery),
      pool.query(regionsQuery),
      pool.query(methodsQuery)
    ]);

    // Helper to format topics
    const formatTopic = (row, type, category) => {
      const count = parseInt(row.paper_count);
      const regionCount = parseInt(row.region_count);
      const papers = count === 1 ? 'paper' : 'papers';
      const regions = regionCount === 1 ? 'region' : 'regions';
      const timeDesc = monthsBack === 1 ? 'last month' : `last ${monthsBack} months`;

      return {
        title: row.name,
        originalName: row.name,
        type,
        category,
        activity: `${count} ${papers} • ${regionCount} ${regions}`,
        summary: `${count} recent ${papers} (${timeDesc}) on ${row.name} across ${regionCount} ${regions}`,
        paperCount: count,
        growthRate: 999,
        risingFast: false,
        trendingScore: count
      };
    };

    // Format results
    const topics = {
      frameworks: frameworksResult.rows.map(r => formatTopic(r, 'framework', 'Conservation Frameworks')),
      taxa: taxaResult.rows.map(r => formatTopic(r, 'taxa', 'Taxa')),
      ecosystems: ecosystemsResult.rows.map(r => formatTopic(r, 'ecosystem', 'Ecosystems')),
      regions: regionsResult.rows.map(r => formatTopic(r, 'region', 'Geographic Regions')),
      methods: methodsResult.rows.map(r => formatTopic(r, 'methods', 'Research Methods'))
    };

    const allTopics = [
      ...topics.frameworks,
      ...topics.taxa,
      ...topics.ecosystems,
      ...topics.regions,
      ...topics.methods
    ];

    const timeDesc = monthsBack === 1 ? 'last month' : `last ${monthsBack} months`;

    res.json({
      success: true,
      count: allTopics.length,
      topics: allTopics,
      byCategory: topics,
      metadata: {
        timeWindow: `Recent publications (${timeDesc})`,
        algorithm: `Paper volume from ${timeDesc}`,
        criteriaDescription: `Topics ranked by number of papers published in the ${timeDesc}`
      }
    });
  } catch (error) {
    console.error('Get trending topics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending topics'
    });
  }
}

/**
 * Get analytics summary statistics
 * @route GET /api/analytics/summary
 */
export async function getAnalyticsSummary(req, res) {
  try {
    // Total papers analyzed
    const totalPapersResult = await pool.query(
      'SELECT COUNT(*) FROM analyzed_papers'
    );
    const totalPapers = parseInt(totalPapersResult.rows[0].count);

    // Papers this week
    const thisWeekResult = await pool.query(
      'SELECT COUNT(*) FROM analyzed_papers WHERE week_number = EXTRACT(WEEK FROM NOW())'
    );
    const papersThisWeek = parseInt(thisWeekResult.rows[0].count);

    // Active regions
    const regionsResult = await pool.query(
      'SELECT COUNT(DISTINCT region) FROM weekly_trends WHERE week_start >= NOW() - INTERVAL \'30 days\''
    );
    const activeRegions = parseInt(regionsResult.rows[0].count);

    // Top frameworks
    const topFrameworksResult = await pool.query(
      `SELECT framework, COUNT(*) as count
       FROM analyzed_papers
       WHERE framework IS NOT NULL
       GROUP BY framework
       ORDER BY count DESC
       LIMIT 5`
    );

    // Top taxa
    const topTaxaResult = await pool.query(
      `SELECT taxa, COUNT(*) as count
       FROM analyzed_papers
       WHERE taxa IS NOT NULL
       GROUP BY taxa
       ORDER BY count DESC
       LIMIT 5`
    );

    res.json({
      success: true,
      summary: {
        total_papers: totalPapers,
        papers_this_week: papersThisWeek,
        active_regions: activeRegions,
        top_frameworks: topFrameworksResult.rows,
        top_taxa: topTaxaResult.rows,
      },
    });
  } catch (error) {
    console.error('Get analytics summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics summary',
    });
  }
}

/**
 * AI-powered geocoding function to get precise coordinates for region names
 * Uses Claude to understand regional context and provide accurate lat/lng
 * @param {string} regionName - Name of the region (e.g., "Kashmir, India", "Maluku Islands, Indonesia")
 * @returns {Promise<{lat: number, lng: number} | null>} Coordinates or null if not found
 */
async function geocodeRegionWithAI(regionName) {
  // Check cache first
  if (geocodeCache.has(regionName)) {
    return geocodeCache.get(regionName);
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 150,
      system: 'You are a geography expert. Return ONLY valid JSON with coordinates. NO explanations, NO apologies, NO additional text. For multi-region strings, use the FIRST region. Format: {"lat": number, "lng": number}',
      messages: [
        {
          role: 'user',
          content: `Coordinates for: ${regionName}\n\nJSON only: {"lat": number, "lng": number}`,
        },
      ],
    });

    const responseText = message.content[0].text.trim();

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    if (jsonText.includes('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const coords = JSON.parse(jsonText);

    if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      // Cache the result
      geocodeCache.set(regionName, coords);
      console.log(`✓ Geocoded "${regionName}":`, coords);
      return coords;
    }

    return null;
  } catch (error) {
    console.error(`✗ Geocoding error for "${regionName}":`, error.message);
    return null;
  }
}

/**
 * Get geographic distribution for map visualization
 * @route GET /api/analytics/map-data
 */
export async function getMapData(req, res) {
  try {
    // Aggregate papers by region from analyzed_papers table
    const query = `
      SELECT
        region,
        COUNT(*) as paper_count,
        COUNT(DISTINCT framework) as framework_count,
        COUNT(DISTINCT taxa) as taxa_count,
        COUNT(DISTINCT ecosystem) as ecosystem_count,
        MODE() WITHIN GROUP (ORDER BY framework) as dominant_framework,
        MODE() WITHIN GROUP (ORDER BY taxa) as dominant_taxa,
        MODE() WITHIN GROUP (ORDER BY ecosystem) as dominant_ecosystem,
        jsonb_agg(DISTINCT methods) FILTER (WHERE methods IS NOT NULL) as all_methods,
        string_agg(DISTINCT title, ' | ') as sample_titles
      FROM analyzed_papers
      WHERE region IS NOT NULL
        AND region != ''
        AND region != 'Not specified'
      GROUP BY region
      ORDER BY paper_count DESC
    `;

    const result = await pool.query(query);

    // Extended coordinate mapping for diverse regions
    const regionCoordinates = {
      // Oceans and Seas
      'Antarctic & Southern Ocean': { lat: -60.5, lng: -45.0 },
      'Arctic Ocean': { lat: 80.0, lng: 0.0 },
      'Caribbean': { lat: 18.0, lng: -75.0 },
      'Mediterranean': { lat: 38.0, lng: 15.0 },
      'Indo-Pacific': { lat: -5.0, lng: 120.0 },
      'North Atlantic': { lat: 50.0, lng: -30.0 },
      'South Atlantic': { lat: -30.0, lng: -20.0 },
      'North Pacific': { lat: 40.0, lng: 170.0 },
      'Indian Ocean': { lat: -10.0, lng: 75.0 },
      'Great Barrier Reef': { lat: -18.3, lng: 147.7 },
      'Eastern Pacific': { lat: 10.0, lng: -95.0 },

      // Countries
      'Global': { lat: 20, lng: 0 },
      'India': { lat: 20.5937, lng: 78.9629 },
      'Nigeria': { lat: 9.082, lng: 8.6753 },
      'Indonesia': { lat: -0.7893, lng: 113.9213 },
      'Costa Rica': { lat: 9.7489, lng: -83.7534 },
      'Italy': { lat: 41.8719, lng: 12.5674 },
      'Germany': { lat: 51.1657, lng: 10.4515 },
      'China': { lat: 35.8617, lng: 104.1954 },
      'Australia': { lat: -25.2744, lng: 133.7751 },
      'Brazil': { lat: -14.2350, lng: -51.9253 },
      'United States': { lat: 37.0902, lng: -95.7129 },
      'Canada': { lat: 56.1304, lng: -106.3468 },
      'Japan': { lat: 36.2048, lng: 138.2529 },
      'United Kingdom': { lat: 55.3781, lng: -3.4360 },
      'France': { lat: 46.2276, lng: 2.2137 },
      'Spain': { lat: 40.4637, lng: -3.7492 },
      'Mexico': { lat: 23.6345, lng: -102.5528 },
      'South Africa': { lat: -30.5595, lng: 22.9375 },

      // Regions
      'Southeast Asia': { lat: 5.0, lng: 110.0 },
      'Chinese Coastline': { lat: 30.0, lng: 120.0 },
      'European Coastal Waters': { lat: 53.0, lng: 5.0 },
      'European North-West Shelf Seas': { lat: 56.0, lng: 2.0 },
      'Continental Scale': { lat: 40.0, lng: 0.0 },
      'Europe': { lat: 50.0, lng: 10.0 },
      'Asia': { lat: 30.0, lng: 100.0 },
    };

    // Function to extract main region from multi-region strings
    const getMainRegion = (regionStr) => {
      if (!regionStr) return null;
      // If multiple regions, take the first one
      const regions = regionStr.split(',').map(r => r.trim());
      return regions[0];
    };

    // Function to get coordinates for a region (with fuzzy matching)
    const getCoordinates = (regionStr) => {
      const mainRegion = getMainRegion(regionStr);

      // Try exact match first
      if (regionCoordinates[regionStr]) {
        return regionCoordinates[regionStr];
      }

      // Try main region
      if (mainRegion && regionCoordinates[mainRegion]) {
        return regionCoordinates[mainRegion];
      }

      // Try partial match
      for (const [key, coords] of Object.entries(regionCoordinates)) {
        if (regionStr.toLowerCase().includes(key.toLowerCase()) ||
            key.toLowerCase().includes(regionStr.toLowerCase())) {
          return coords;
        }
      }

      // Default to center of map if no match
      return { lat: 0, lng: 0 };
    };

    // Use AI geocoding for precise coordinates (with parallel processing)
    const mapData = await Promise.all(result.rows.map(async (row) => {
      // Try AI geocoding first, fallback to static coordinates
      let coords = await geocodeRegionWithAI(row.region);

      if (!coords) {
        // Fallback to static coordinates if AI fails
        coords = getCoordinates(row.region);
      }

      const paperCount = parseInt(row.paper_count);

      // Generate a topic focus from sample titles or metadata
      const topicFocus = row.dominant_framework || row.dominant_taxa ||
                        (row.sample_titles ? row.sample_titles.split(' | ')[0].substring(0, 100) + '...' : 'Research focus');

      // Flatten methods array
      let methods = [];
      if (row.all_methods) {
        try {
          const methodsData = row.all_methods;
          if (Array.isArray(methodsData)) {
            methods = methodsData.flatMap(m => Array.isArray(m) ? m : []);
          }
        } catch (e) {
          methods = [];
        }
      }

      return {
        region: row.region,
        lat: coords.lat,
        lng: coords.lng,
        activity: paperCount,
        stats: {
          studies: paperCount,
          datasets: 0,
          researchers: 0,
        },
        topicFocus,
        trend: paperCount >= 3 ? 'increasing' : paperCount >= 2 ? 'stable' : 'increasing',
        taxa: row.dominant_taxa,
        framework: row.dominant_framework,
        ecosystem: row.dominant_ecosystem,
        methods,
      };
    }));

    res.json({
      success: true,
      count: mapData.length,
      locations: mapData,
    });
  } catch (error) {
    console.error('Get map data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch map data',
    });
  }
}

/**
 * Get database overview statistics
 * @route GET /api/analytics/database-stats
 * @query {string} time_range - Optional: 7d, 30d, 90d (default: all time)
 */
export async function getDatabaseStats(req, res) {
  try {
    const { time_range = 'all' } = req.query;

    // Calculate date filter based on time range
    let dateFilter = '';
    let dateFilterPrevious = ''; // For comparison

    if (time_range === '7d') {
      dateFilter = "AND r.created_at >= NOW() - INTERVAL '7 days'";
      dateFilterPrevious = "AND r.created_at >= NOW() - INTERVAL '14 days' AND r.created_at < NOW() - INTERVAL '7 days'";
    } else if (time_range === '30d') {
      dateFilter = "AND r.created_at >= NOW() - INTERVAL '30 days'";
      dateFilterPrevious = "AND r.created_at >= NOW() - INTERVAL '60 days' AND r.created_at < NOW() - INTERVAL '30 days'";
    } else if (time_range === '90d') {
      dateFilter = "AND r.created_at >= NOW() - INTERVAL '90 days'";
      dateFilterPrevious = "AND r.created_at >= NOW() - INTERVAL '180 days' AND r.created_at < NOW() - INTERVAL '90 days'";
    }

    // Get total papers (only conservation-relevant)
    const totalQuery = `
      SELECT COUNT(*) as total
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE (
        c.geo_scope_geom IS NOT NULL
        OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
        OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
      ) ${dateFilter}
    `;
    const totalResult = await pool.query(totalQuery);
    const total = parseInt(totalResult.rows[0].total);

    // Get total from previous period for comparison (only conservation-relevant)
    const totalPreviousQuery = time_range !== 'all' ? `
      SELECT COUNT(*) as total
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE (
        c.geo_scope_geom IS NOT NULL
        OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
        OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
      ) ${dateFilterPrevious}
    ` : null;
    const totalPrevious = totalPreviousQuery ? parseInt((await pool.query(totalPreviousQuery)).rows[0].total) : 0;

    // Get papers with GPS coordinates
    const gpsQuery = `
      SELECT COUNT(*) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE c.geo_scope_geom IS NOT NULL ${dateFilter}
    `;
    const gpsResult = await pool.query(gpsQuery);
    const withGPS = parseInt(gpsResult.rows[0].count);

    // Get papers with AI metadata
    const metadataQuery = `
      SELECT COUNT(*) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE c.methods IS NOT NULL ${dateFilter}
    `;
    const metadataResult = await pool.query(metadataQuery);
    const withMetadata = parseInt(metadataResult.rows[0].count);

    // Get unique countries (from geo_scope_text)
    const countriesQuery = `
      SELECT COUNT(DISTINCT c.geo_scope_text) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE c.geo_scope_text IS NOT NULL
        AND c.geo_scope_text != '' ${dateFilter}
    `;
    const countriesResult = await pool.query(countriesQuery);
    const countries = parseInt(countriesResult.rows[0].count);

    // Calculate time-specific stats (only conservation-relevant)
    const last7DaysQuery = `
      SELECT COUNT(*) as count
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.created_at >= NOW() - INTERVAL '7 days'
        AND (
          c.geo_scope_geom IS NOT NULL
          OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
          OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
        )
    `;
    const last7DaysResult = await pool.query(last7DaysQuery);
    const last7Days = parseInt(last7DaysResult.rows[0].count);

    const last30DaysQuery = `
      SELECT COUNT(*) as count
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.created_at >= NOW() - INTERVAL '30 days'
        AND (
          c.geo_scope_geom IS NOT NULL
          OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
          OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
        )
    `;
    const last30DaysResult = await pool.query(last30DaysQuery);
    const last30Days = parseInt(last30DaysResult.rows[0].count);

    // Get total citations across all papers (only conservation-relevant)
    const citationsQuery = `
      SELECT COALESCE(SUM(COALESCE(r.citations, 0)), 0) as total_citations
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE (
        c.geo_scope_geom IS NOT NULL
        OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
        OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
      ) ${dateFilter}
    `;
    const citationsResult = await pool.query(citationsQuery);
    const totalCitations = parseInt(citationsResult.rows[0].total_citations);

    // Get unique frameworks count
    const frameworksQuery = `
      SELECT COUNT(DISTINCT framework) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      CROSS JOIN LATERAL (
        SELECT jsonb_array_elements_text(c.framework_alignment) as framework
      ) frameworks
      WHERE c.framework_alignment IS NOT NULL ${dateFilter}
    `;
    const frameworksResult = await pool.query(frameworksQuery);
    const uniqueFrameworks = parseInt(frameworksResult.rows[0].count);

    // Get unique locations count (excluding meaningless values)
    const locationsQuery = `
      SELECT COUNT(DISTINCT c.geo_scope_text) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE c.geo_scope_text IS NOT NULL
        AND c.geo_scope_text != ''
        AND c.geo_scope_text NOT ILIKE '%not specified%'
        AND c.geo_scope_text NOT ILIKE '%not applicable%'
        AND c.geo_scope_text NOT ILIKE '%unknown%'
        AND c.geo_scope_text NOT ILIKE 'n/a%'
        AND c.geo_scope_text NOT ILIKE '%laboratory%'
        AND c.geo_scope_text NOT ILIKE '%in vitro%'
        AND c.geo_scope_text NOT ILIKE 'global%'
        ${dateFilter}
    `;
    const locationsResult = await pool.query(locationsQuery);
    const uniqueLocations = parseInt(locationsResult.rows[0].count);

    res.json({
      success: true,
      stats: {
        total,
        totalPapers: total, // For landing page compatibility
        totalPrevious,
        withGPS,
        papersWithGPS: withGPS, // For landing page compatibility
        gpsPercentage: total > 0 ? Math.round((withGPS / total) * 100) : 0,
        withMetadata,
        papersWithMetadata: withMetadata, // For landing page compatibility
        metadataPercentage: total > 0 ? Math.round((withMetadata / total) * 100) : 0,
        countries,
        uniqueRegions: countries, // For landing page compatibility (old)
        uniqueLocations, // For landing page (new, filtered)
        totalCitations,
        uniqueFrameworks,
        last7Days,
        last30Days,
        growth: totalPrevious > 0 ? Math.round(((total - totalPrevious) / totalPrevious) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Get database stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch database stats',
    });
  }
}

/**
 * Get latest papers added to database
 * @route GET /api/analytics/latest-papers
 * @query {number} limit - Optional: Number of papers to return (default: 20)
 * @query {string} time_range - Optional: 7d, 30d, 90d (default: 30d)
 */
export async function getLatestPapers(req, res) {
  try {
    const { limit = 20, time_range = '30d' } = req.query;

    // Calculate date filter based on time range
    let dateFilter = "AND r.created_at >= NOW() - INTERVAL '30 days'";

    if (time_range === '7d') {
      dateFilter = "AND r.created_at >= NOW() - INTERVAL '7 days'";
    } else if (time_range === '90d') {
      dateFilter = "AND r.created_at >= NOW() - INTERVAL '90 days'";
    }

    const query = `
      SELECT
        r.id,
        r.title,
        r.abstract,
        r.authors,
        r.publication_year,
        r.journal,
        r.doi,
        r.citations,
        r.created_at as added_date,
        c.ecosystem_type,
        c.geo_scope_text,
        c.taxon_scope,
        c.methods,
        c.framework_alignment
      FROM research_items r
      INNER JOIN compass_metadata c ON r.id = c.research_id
      WHERE (
        c.geo_scope_geom IS NOT NULL
        OR (c.framework_alignment IS NOT NULL AND c.framework_alignment != '[]'::jsonb)
        OR (c.methods IS NOT NULL AND c.methods != '[]'::jsonb)
      ) ${dateFilter}
      ORDER BY r.created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [parseInt(limit)]);

    const papers = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      abstract: row.abstract,
      authors: row.authors,
      publication_year: row.publication_year,
      journal: row.journal,
      doi: row.doi,
      citations: row.citations || 0,
      addedDate: row.added_date,
      ecosystem: row.ecosystem_type,
      location: row.geo_scope_text,
      species: row.taxon_scope ? (Array.isArray(row.taxon_scope) ? row.taxon_scope : []) : [],
      methods: Array.isArray(row.methods) ? row.methods : [],
      frameworks: row.framework_alignment || [],
    }));

    res.json({
      success: true,
      count: papers.length,
      papers,
      timeRange: time_range,
    });
  } catch (error) {
    console.error('Get latest papers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest papers',
    });
  }
}

/**
 * Get temporal trends data for charts
 * @route GET /api/analytics/temporal-trends
 * @query {string} metric - Required: 'papers_per_week' | 'ecosystems' | 'methods' | 'frameworks'
 * @query {string} time_range - Optional: 7d, 30d, 90d (default: 90d)
 * @query {number} limit - Optional: Limit for top N (default: 5)
 */
export async function getTemporalTrends(req, res) {
  try {
    const { metric, time_range = '90d', limit = 5 } = req.query;

    if (!metric) {
      return res.status(400).json({
        success: false,
        error: 'metric parameter is required',
      });
    }

    // Calculate date filter based on time range
    let interval = '90 days';
    let weekInterval = '12 weeks';

    if (time_range === '7d') {
      interval = '7 days';
      weekInterval = '1 week';
    } else if (time_range === '30d') {
      interval = '30 days';
      weekInterval = '4 weeks';
    }

    let query;
    let queryParams = [];

    switch (metric) {
      case 'papers_per_week':
        query = `
          SELECT
            DATE_TRUNC('week', r.created_at) as week,
            COUNT(*) as count
          FROM research_items r
          WHERE r.created_at >= NOW() - INTERVAL '${interval}'
          GROUP BY DATE_TRUNC('week', r.created_at)
          ORDER BY week ASC
        `;
        break;

      case 'ecosystems':
        query = `
          SELECT
            c.ecosystem_type as name,
            COUNT(*) as count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE r.created_at >= NOW() - INTERVAL '${interval}'
            AND c.ecosystem_type IS NOT NULL
            AND c.ecosystem_type != ''
          GROUP BY c.ecosystem_type
          ORDER BY count DESC
          LIMIT $1
        `;
        queryParams = [parseInt(limit)];
        break;

      case 'methods':
        query = `
          SELECT
            method as name,
            COUNT(*) as count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id,
          LATERAL jsonb_array_elements_text(c.methods->'research_methods') as method
          WHERE r.created_at >= NOW() - INTERVAL '${interval}'
            AND c.methods IS NOT NULL
          GROUP BY method
          ORDER BY count DESC
          LIMIT $1
        `;
        queryParams = [parseInt(limit)];
        break;

      case 'frameworks':
        query = `
          SELECT
            framework as name,
            COUNT(*) as count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id,
          LATERAL jsonb_array_elements_text(c.framework_alignment) as framework
          WHERE r.created_at >= NOW() - INTERVAL '${interval}'
            AND c.framework_alignment IS NOT NULL
            AND c.framework_alignment != '[]'::jsonb
          GROUP BY framework
          ORDER BY count DESC
          LIMIT $1
        `;
        queryParams = [parseInt(limit)];
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid metric. Must be one of: papers_per_week, ecosystems, methods, frameworks',
        });
    }

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      metric,
      timeRange: time_range,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get temporal trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch temporal trends',
    });
  }
}

/**
 * Get research gaps - identify underresearched areas
 * GET /api/analytics/research-gaps
 */
export async function getResearchGaps(req, res) {
  try {
    const { min_papers = 5 } = req.query;
    const minPapers = parseInt(min_papers);

    // Run all gap queries in parallel
    const [taxaResult, regionsResult, frameworksResult, ecosystemsResult, methodsResult] = await Promise.all([
      // Underresearched taxa
      pool.query(`
        WITH taxa_counts AS (
          SELECT
            (jsonb_array_elements(c.taxon_scope)->>'common_name') as taxon,
            COUNT(DISTINCT r.id) as paper_count,
            ARRAY_AGG(DISTINCT c.geo_scope_text) FILTER (WHERE c.geo_scope_text IS NOT NULL) as regions
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE c.taxon_scope IS NOT NULL
            AND c.taxon_scope != '[]'::jsonb
          GROUP BY taxon
        )
        SELECT
          taxon as name,
          paper_count,
          array_length(regions, 1) as region_count,
          'Needs more research - only ' || paper_count || ' papers found' as gap_description
        FROM taxa_counts
        WHERE paper_count < $1 AND taxon IS NOT NULL
        ORDER BY paper_count ASC
        LIMIT 20
      `, [minPapers]),

      // Geographic gaps
      pool.query(`
        WITH region_counts AS (
          SELECT
            c.geo_scope_text as region,
            COUNT(DISTINCT r.id) as paper_count,
            COUNT(DISTINCT c.ecosystem_type) as ecosystem_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE c.geo_scope_text IS NOT NULL
            AND c.geo_scope_text != ''
          GROUP BY c.geo_scope_text
        )
        SELECT
          region as name,
          paper_count,
          ecosystem_count,
          'Geographic gap - only ' || paper_count || ' papers across ' || ecosystem_count || ' ecosystems' as gap_description
        FROM region_counts
        WHERE paper_count < $1
        ORDER BY paper_count ASC
        LIMIT 20
      `, [minPapers]),

      // Framework gaps
      pool.query(`
        WITH framework_counts AS (
          SELECT
            jsonb_array_elements_text(c.framework_alignment) as framework,
            COUNT(DISTINCT r.id) as paper_count,
            COUNT(DISTINCT c.geo_scope_text) as region_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE c.framework_alignment IS NOT NULL
            AND c.framework_alignment != '[]'::jsonb
          GROUP BY framework
        )
        SELECT
          framework as name,
          paper_count,
          region_count,
          'Framework gap - only ' || paper_count || ' papers in ' || region_count || ' regions' as gap_description
        FROM framework_counts
        WHERE paper_count < $1
        ORDER BY paper_count ASC
        LIMIT 20
      `, [minPapers]),

      // Ecosystem gaps
      pool.query(`
        WITH ecosystem_counts AS (
          SELECT
            c.ecosystem_type as ecosystem,
            COUNT(DISTINCT r.id) as paper_count,
            COUNT(DISTINCT c.geo_scope_text) as region_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE c.ecosystem_type IS NOT NULL
            AND c.ecosystem_type != ''
          GROUP BY c.ecosystem_type
        )
        SELECT
          ecosystem as name,
          paper_count,
          region_count,
          'Ecosystem gap - only ' || paper_count || ' papers across ' || region_count || ' regions' as gap_description
        FROM ecosystem_counts
        WHERE paper_count < $1
        ORDER BY paper_count ASC
        LIMIT 20
      `, [minPapers]),

      // Research method gaps
      pool.query(`
        WITH method_counts AS (
          SELECT
            jsonb_array_elements_text(c.methods->'research_methods') as method,
            COUNT(DISTINCT r.id) as paper_count,
            COUNT(DISTINCT c.ecosystem_type) as ecosystem_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE c.methods->'research_methods' IS NOT NULL
          GROUP BY method
        )
        SELECT
          method as name,
          paper_count,
          ecosystem_count,
          'Method gap - only ' || paper_count || ' papers using this method across ' || ecosystem_count || ' ecosystems' as gap_description
        FROM method_counts
        WHERE paper_count < $1 AND method IS NOT NULL
        ORDER BY paper_count ASC
        LIMIT 20
      `, [minPapers])
    ]);

    res.json({
      success: true,
      threshold: minPapers,
      gaps: {
        taxa: taxaResult.rows,
        regions: regionsResult.rows,
        frameworks: frameworksResult.rows,
        ecosystems: ecosystemsResult.rows,
        methods: methodsResult.rows
      },
      summary: {
        total_gaps: taxaResult.rows.length + regionsResult.rows.length +
                     frameworksResult.rows.length + ecosystemsResult.rows.length +
                     methodsResult.rows.length,
        taxa_gaps: taxaResult.rows.length,
        region_gaps: regionsResult.rows.length,
        framework_gaps: frameworksResult.rows.length,
        ecosystem_gaps: ecosystemsResult.rows.length,
        method_gaps: methodsResult.rows.length
      }
    });
  } catch (error) {
    console.error('Get research gaps error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch research gaps',
    });
  }
}

/**
 * Get predictive analytics - identify emerging trends and forecast future research
 * GET /api/analytics/predictions
 */
export async function getPredictiveAnalytics(req, res) {
  try {
    const { time_range = '12m' } = req.query;

    // Calculate time periods
    const months = time_range === '6m' ? 6 : time_range === '12m' ? 12 : 24;
    const currentDate = new Date();

    // Run all predictions in parallel
    const [emergingTopics, decliningTopics, growthTrends, forecastData] = await Promise.all([
      // Emerging topics - topics with accelerating publication rates
      pool.query(`
        WITH topic_monthly AS (
          SELECT
            jsonb_array_elements_text(c.framework_alignment) as topic,
            DATE_TRUNC('month', r.publication_date) as month,
            COUNT(*) as paper_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${months} months'
            AND r.publication_date IS NOT NULL
            AND c.framework_alignment IS NOT NULL
            AND c.framework_alignment != '[]'::jsonb
          GROUP BY topic, month
        ),
        topic_growth AS (
          SELECT
            topic,
            SUM(CASE WHEN month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' THEN paper_count ELSE 0 END) as recent_count,
            SUM(CASE WHEN month < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' THEN paper_count ELSE 0 END) as earlier_count,
            SUM(paper_count) as total_count
          FROM topic_monthly
          GROUP BY topic
        )
        SELECT
          topic as name,
          recent_count,
          earlier_count,
          total_count,
          CASE
            WHEN earlier_count > 0 THEN ROUND(((recent_count::float / earlier_count) - 1) * 100)
            ELSE 999
          END as growth_rate,
          'Emerging trend - ' || recent_count || ' recent papers vs ' || earlier_count || ' earlier' as description
        FROM topic_growth
        WHERE recent_count > earlier_count AND total_count >= 5
        ORDER BY growth_rate DESC
        LIMIT 15
      `),

      // Declining topics - topics with decreasing publication rates
      pool.query(`
        WITH topic_monthly AS (
          SELECT
            c.ecosystem_type as topic,
            DATE_TRUNC('month', r.publication_date) as month,
            COUNT(*) as paper_count
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${months} months'
            AND r.publication_date IS NOT NULL
            AND c.ecosystem_type IS NOT NULL
            AND c.ecosystem_type != ''
          GROUP BY topic, month
        ),
        topic_decline AS (
          SELECT
            topic,
            SUM(CASE WHEN month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' THEN paper_count ELSE 0 END) as recent_count,
            SUM(CASE WHEN month < DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months' THEN paper_count ELSE 0 END) as earlier_count,
            SUM(paper_count) as total_count
          FROM topic_monthly
          GROUP BY topic
        )
        SELECT
          topic as name,
          recent_count,
          earlier_count,
          total_count,
          CASE
            WHEN earlier_count > 0 THEN ROUND(((recent_count::float / earlier_count) - 1) * 100)
            ELSE -999
          END as growth_rate,
          'Declining attention - ' || recent_count || ' recent papers vs ' || earlier_count || ' earlier' as description
        FROM topic_decline
        WHERE recent_count < earlier_count AND total_count >= 10
        ORDER BY growth_rate ASC
        LIMIT 10
      `),

      // Growth trends by category
      pool.query(`
        SELECT
          CASE
            WHEN months_ago = 0 THEN 'Current'
            WHEN months_ago = 1 THEN '1 month ago'
            ELSE months_ago || ' months ago'
          END as period,
          COUNT(*) as paper_count,
          COUNT(DISTINCT c.geo_scope_text) as region_count,
          COUNT(DISTINCT c.ecosystem_type) as ecosystem_count
        FROM (
          SELECT
            r.id,
            EXTRACT(MONTH FROM AGE(CURRENT_DATE, r.publication_date))::int as months_ago
          FROM research_items r
          WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${months} months'
            AND r.publication_date IS NOT NULL
        ) r
        JOIN compass_metadata c ON r.id = c.research_id
        GROUP BY months_ago
        ORDER BY months_ago DESC
        LIMIT 12
      `),

      // Forecast - simple linear projection
      pool.query(`
        WITH monthly_counts AS (
          SELECT
            DATE_TRUNC('month', r.publication_date) as month,
            COUNT(*) as paper_count
          FROM research_items r
          WHERE r.publication_date >= CURRENT_DATE - INTERVAL '6 months'
            AND r.publication_date IS NOT NULL
          GROUP BY month
          ORDER BY month
        )
        SELECT
          month,
          paper_count,
          AVG(paper_count) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) as moving_avg
        FROM monthly_counts
      `)
    ]);

    // Calculate forecast
    const recentAvg = forecastData.rows.length > 0
      ? forecastData.rows[forecastData.rows.length - 1].moving_avg
      : 0;
    const forecast = {
      next_month: Math.round(recentAvg * 1.1),
      next_quarter: Math.round(recentAvg * 3.2),
      next_year: Math.round(recentAvg * 12.5),
      confidence: forecastData.rows.length >= 3 ? 'Medium' : 'Low'
    };

    res.json({
      success: true,
      timeRange: time_range,
      predictions: {
        emerging: emergingTopics.rows,
        declining: decliningTopics.rows,
        growth_trends: growthTrends.rows,
        forecast: forecast
      },
      summary: {
        emerging_count: emergingTopics.rows.length,
        declining_count: decliningTopics.rows.length,
        avg_growth: emergingTopics.rows.length > 0
          ? Math.round(emergingTopics.rows.reduce((sum, t) => sum + parseFloat(t.growth_rate), 0) / emergingTopics.rows.length)
          : 0
      }
    });
  } catch (error) {
    console.error('Get predictive analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch predictive analytics',
    });
  }
}

// Get collaboration networks and co-authorship patterns
export async function getCollaborationNetworks(req, res) {
  try {
    const { min_papers = 3, time_range = '24m' } = req.query;
    const minPapers = parseInt(min_papers);
    const months = time_range === '6m' ? 6 : time_range === '12m' ? 12 : time_range === '24m' ? 24 : 60;

    // Run all network queries in parallel
    const [prolificAuthors, collaborativeAuthors, frequentPairs, recentCollaborations] = await Promise.all([
      // 1. Most prolific authors (authors with most papers)
      pool.query(`
        WITH author_papers AS (
          SELECT
            jsonb_array_elements(r.authors)::jsonb->>'name' as author_name,
            r.id as paper_id,
            r.publication_date,
            c.geo_scope_text,
            jsonb_array_elements_text(c.framework_alignment) as framework
          FROM research_items r
          JOIN compass_metadata c ON r.id = c.research_id
          WHERE r.authors IS NOT NULL
            AND r.authors != '[]'::jsonb
            AND (r.publication_date IS NULL OR r.publication_date >= CURRENT_DATE - INTERVAL '${months} months')
        )
        SELECT
          author_name as name,
          COUNT(DISTINCT paper_id) as paper_count,
          COUNT(DISTINCT geo_scope_text) as region_count,
          COUNT(DISTINCT framework) as framework_count,
          MIN(publication_date) as first_publication,
          MAX(publication_date) as latest_publication,
          'Prolific researcher with ' || COUNT(DISTINCT paper_id) || ' papers across ' ||
          COUNT(DISTINCT geo_scope_text) || ' regions' as description
        FROM author_papers
        WHERE author_name IS NOT NULL AND author_name != 'Unknown' AND author_name != ''
        GROUP BY author_name
        HAVING COUNT(DISTINCT paper_id) >= $1
        ORDER BY paper_count DESC
        LIMIT 20
      `, [minPapers]),

      // 2. Most collaborative authors (authors who co-author with many different people)
      pool.query(`
        WITH paper_authors AS (
          SELECT
            r.id as paper_id,
            jsonb_array_elements(r.authors)::jsonb->>'name' as author_name
          FROM research_items r
          WHERE r.authors IS NOT NULL
            AND r.authors != '[]'::jsonb
            AND jsonb_array_length(r.authors) > 1
            AND (r.publication_date IS NULL OR r.publication_date >= CURRENT_DATE - INTERVAL '${months} months')
        ),
        author_coauthors AS (
          SELECT
            pa1.author_name,
            COUNT(DISTINCT pa2.author_name) as coauthor_count,
            COUNT(DISTINCT pa1.paper_id) as paper_count,
            ARRAY_AGG(DISTINCT pa2.author_name) FILTER (WHERE pa2.author_name != pa1.author_name) as coauthors
          FROM paper_authors pa1
          JOIN paper_authors pa2 ON pa1.paper_id = pa2.paper_id
          WHERE pa1.author_name IS NOT NULL
            AND pa1.author_name != 'Unknown'
            AND pa1.author_name != ''
          GROUP BY pa1.author_name
        )
        SELECT
          author_name as name,
          coauthor_count - 1 as unique_collaborators,
          paper_count,
          'Collaborates with ' || (coauthor_count - 1) || ' unique researchers across ' ||
          paper_count || ' papers' as description
        FROM author_coauthors
        WHERE coauthor_count > 2 AND paper_count >= $1
        ORDER BY (coauthor_count - 1) DESC, paper_count DESC
        LIMIT 20
      `, [minPapers]),

      // 3. Most frequent co-authorship pairs
      pool.query(`
        WITH paper_authors AS (
          SELECT
            r.id as paper_id,
            r.title,
            jsonb_array_elements(r.authors)::jsonb->>'name' as author_name
          FROM research_items r
          WHERE r.authors IS NOT NULL
            AND r.authors != '[]'::jsonb
            AND jsonb_array_length(r.authors) > 1
            AND (r.publication_date IS NULL OR r.publication_date >= CURRENT_DATE - INTERVAL '${months} months')
        ),
        author_pairs AS (
          SELECT
            LEAST(pa1.author_name, pa2.author_name) as author_1,
            GREATEST(pa1.author_name, pa2.author_name) as author_2,
            COUNT(DISTINCT pa1.paper_id) as collaboration_count,
            ARRAY_AGG(DISTINCT LEFT(pa1.title, 60)) as sample_papers
          FROM paper_authors pa1
          JOIN paper_authors pa2 ON pa1.paper_id = pa2.paper_id
          WHERE pa1.author_name < pa2.author_name
            AND pa1.author_name IS NOT NULL
            AND pa2.author_name IS NOT NULL
            AND pa1.author_name != 'Unknown'
            AND pa2.author_name != 'Unknown'
            AND pa1.author_name != ''
            AND pa2.author_name != ''
          GROUP BY author_1, author_2
        )
        SELECT
          author_1,
          author_2,
          collaboration_count,
          sample_papers[1:3] as recent_papers,
          'Co-authored ' || collaboration_count || ' papers together' as description
        FROM author_pairs
        WHERE collaboration_count >= $1
        ORDER BY collaboration_count DESC
        LIMIT 15
      `, [minPapers]),

      // 4. Recent emerging collaborations (new co-authorship pairs in last 6 months)
      pool.query(`
        WITH recent_papers AS (
          SELECT
            r.id as paper_id,
            r.title,
            r.publication_date,
            jsonb_array_elements(r.authors)::jsonb->>'name' as author_name
          FROM research_items r
          WHERE r.authors IS NOT NULL
            AND r.authors != '[]'::jsonb
            AND jsonb_array_length(r.authors) > 1
            AND r.publication_date >= CURRENT_DATE - INTERVAL '6 months'
        ),
        recent_pairs AS (
          SELECT
            LEAST(rp1.author_name, rp2.author_name) as author_1,
            GREATEST(rp1.author_name, rp2.author_name) as author_2,
            COUNT(DISTINCT rp1.paper_id) as recent_count,
            MAX(rp1.publication_date) as latest_date,
            LEFT(MAX(rp1.title), 80) as latest_paper
          FROM recent_papers rp1
          JOIN recent_papers rp2 ON rp1.paper_id = rp2.paper_id
          WHERE rp1.author_name < rp2.author_name
            AND rp1.author_name IS NOT NULL
            AND rp2.author_name IS NOT NULL
            AND rp1.author_name != 'Unknown'
            AND rp2.author_name != 'Unknown'
            AND rp1.author_name != ''
            AND rp2.author_name != ''
          GROUP BY author_1, author_2
        )
        SELECT
          author_1,
          author_2,
          recent_count as collaboration_count,
          TO_CHAR(latest_date, 'YYYY-MM-DD') as latest_date,
          latest_paper,
          'New collaboration - ' || recent_count || ' papers in last 6 months' as description
        FROM recent_pairs
        WHERE recent_count >= 2
        ORDER BY recent_count DESC, latest_date DESC
        LIMIT 15
      `)
    ]);

    // Calculate summary statistics
    const totalAuthors = prolificAuthors.rows.length;
    const totalPairs = frequentPairs.rows.length;
    const avgPapersPerAuthor = prolificAuthors.rows.length > 0
      ? Math.round(prolificAuthors.rows.reduce((sum, a) => sum + parseInt(a.paper_count), 0) / prolificAuthors.rows.length)
      : 0;
    const avgCollaborators = collaborativeAuthors.rows.length > 0
      ? Math.round(collaborativeAuthors.rows.reduce((sum, a) => sum + parseInt(a.unique_collaborators), 0) / collaborativeAuthors.rows.length)
      : 0;

    res.json({
      success: true,
      time_range: time_range,
      networks: {
        prolific_authors: prolificAuthors.rows,
        collaborative_authors: collaborativeAuthors.rows,
        frequent_pairs: frequentPairs.rows,
        recent_collaborations: recentCollaborations.rows
      },
      summary: {
        total_prolific_authors: totalAuthors,
        total_collaboration_pairs: totalPairs,
        avg_papers_per_author: avgPapersPerAuthor,
        avg_collaborators_per_author: avgCollaborators,
        recent_emerging_count: recentCollaborations.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching collaboration networks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch collaboration networks',
    });
  }
}

/**
 * Get weekly highlights - compelling papers from the last 7 days
 * Scores papers based on multiple factors to surface the most interesting research
 * @route GET /api/analytics/weekly-highlights
 * @query {number} days - Optional: Days to look back (default: 7)
 * @query {number} limit - Optional: Number of highlights to return (default: 8)
 */
export async function getWeeklyHighlights(req, res) {
  try {
    const { days = 7, limit = 8 } = req.query;

    // Tier-1 journals (highest impact)
    const tier1Journals = [
      'Nature', 'Science', 'PNAS', 'Proceedings of the National Academy of Sciences',
      'Conservation Biology', 'Biological Conservation', 'Ecology Letters',
      'Global Change Biology', 'Nature Climate Change', 'Nature Ecology & Evolution'
    ];

    // Tier-2 journals (high impact)
    const tier2Journals = [
      'Ecology', 'Ecological Applications', 'Journal of Applied Ecology',
      'Diversity and Distributions', 'Ecological Monographs', 'Conservation Letters',
      'Frontiers in Ecology and the Environment', 'Ecography'
    ];

    // Interesting regions that are likely to attract user interest
    const interestingRegions = [
      'Amazon', 'Arctic', 'Antarctica', 'Madagascar', 'Galápagos', 'Great Barrier Reef',
      'Coral Triangle', 'Borneo', 'Sumatra', 'Congo', 'Serengeti', 'Yellowstone'
    ];

    // Novel methods that signal cutting-edge research
    const novelMethods = [
      'Machine Learning', 'DNA Barcoding', 'eDNA', 'Satellite Imagery',
      'Species Distribution Modeling', 'GPS Telemetry', 'Acoustic Monitoring',
      'Remote Sensing'
    ];

    // Helper function to strip HTML/XML tags and decode entities
    const stripHtmlTags = (text) => {
      if (!text) return text;
      return text
        .replace(/<jats:[^>]*>/g, '')  // Remove JATS XML opening tags
        .replace(/<\/jats:[^>]*>/g, '') // Remove JATS XML closing tags
        .replace(/<[^>]*>/g, '')        // Remove any other HTML/XML tags
        .replace(/&amp;/g, '&')         // Decode &amp;
        .replace(/&lt;/g, '<')          // Decode &lt;
        .replace(/&gt;/g, '>')          // Decode &gt;
        .replace(/&quot;/g, '"')        // Decode &quot;
        .replace(/&apos;/g, "'")        // Decode &apos;
        .replace(/&#39;/g, "'")         // Decode &#39;
        .replace(/&nbsp;/g, ' ')        // Decode &nbsp;
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .trim();
    };

    // Fetch papers from last N days with rich metadata
    // CRITICAL: Filter by publication_date (when published), NOT created_at (when added to DB)
    const daysNum = parseInt(days);
    const query = `
      SELECT
        r.id,
        r.title,
        r.abstract,
        r.authors,
        r.publication_year,
        r.publication_date,
        r.journal,
        r.doi,
        r.citations,
        r.created_at,
        c.ecosystem_type,
        c.geo_scope_text,
        c.geo_scope_geom,
        CASE
          WHEN c.geo_scope_geom IS NOT NULL
          THEN CAST((c.geo_scope_geom::jsonb->'coordinates'->1)::text AS FLOAT)
          ELSE NULL
        END as latitude,
        CASE
          WHEN c.geo_scope_geom IS NOT NULL
          THEN CAST((c.geo_scope_geom::jsonb->'coordinates'->0)::text AS FLOAT)
          ELSE NULL
        END as longitude,
        c.taxon_scope::text as taxon_scope,
        c.methods::text as methods,
        c.framework_alignment::text as framework_alignment
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.publication_date >= CURRENT_DATE - INTERVAL '${daysNum} days'
        AND r.publication_date IS NOT NULL
        AND r.abstract IS NOT NULL
        AND r.title IS NOT NULL
        AND LENGTH(r.title) > 20
        AND c.ecosystem_type IS NOT NULL
        AND c.ecosystem_type != 'Urban & Built'
      ORDER BY r.publication_date DESC
    `;

    const result = await pool.query(query);

    // Score each paper
    const scoredPapers = result.rows.map(paper => {
      // Parse JSONB text fields (returned as text to avoid PostgreSQL parse errors)
      try {
        paper.taxon_scope = typeof paper.taxon_scope === 'string' && paper.taxon_scope
          ? JSON.parse(paper.taxon_scope)
          : paper.taxon_scope;
      } catch (e) {
        paper.taxon_scope = [];  // Default to empty array if parsing fails
      }

      try {
        paper.methods = typeof paper.methods === 'string' && paper.methods
          ? JSON.parse(paper.methods)
          : paper.methods;
      } catch (e) {
        paper.methods = [];
      }

      try {
        paper.framework_alignment = typeof paper.framework_alignment === 'string' && paper.framework_alignment
          ? JSON.parse(paper.framework_alignment)
          : paper.framework_alignment;
      } catch (e) {
        paper.framework_alignment = [];
      }

      let score = 0;
      const scoreBreakdown = {
        journal: 0,
        geography: 0,
        metadata: 0,
        title: 0,
        methods: 0
      };

      // 1. Journal Tier Score (max 30 points)
      if (paper.journal) {
        const journal = paper.journal.trim();
        if (tier1Journals.some(t1 => journal.toLowerCase().includes(t1.toLowerCase()))) {
          scoreBreakdown.journal = 30;
        } else if (tier2Journals.some(t2 => journal.toLowerCase().includes(t2.toLowerCase()))) {
          scoreBreakdown.journal = 20;
        } else {
          scoreBreakdown.journal = 10; // Base score for any journal
        }
      }

      // 2. Geographic Interest Score (max 20 points)
      if (paper.geo_scope_geom) {
        scoreBreakdown.geography += 10; // Has GPS coordinates
      }
      if (paper.geo_scope_text) {
        // Check if location mentions interesting regions
        const locationText = paper.geo_scope_text.toLowerCase();
        if (interestingRegions.some(region => locationText.includes(region.toLowerCase()))) {
          scoreBreakdown.geography += 10;
        } else {
          scoreBreakdown.geography += 5; // Any location is better than none
        }
      }

      // 3. Metadata Richness Score (max 20 points)
      let metadataScore = 0;
      if (paper.ecosystem_type) metadataScore += 5;
      if (paper.taxon_scope && Array.isArray(paper.taxon_scope) && paper.taxon_scope.length > 0) metadataScore += 5;
      if (paper.framework_alignment && Array.isArray(paper.framework_alignment) && paper.framework_alignment.length > 0) metadataScore += 5;

      // Handle both methods formats: object with research_methods OR simple array
      const methodsArray = Array.isArray(paper.methods)
        ? paper.methods
        : (paper.methods?.research_methods || []);
      if (methodsArray.length > 0) metadataScore += 5;

      scoreBreakdown.metadata = metadataScore;

      // 4. Title Appeal Score (max 15 points)
      if (paper.title) {
        const titleLength = paper.title.length;
        const wordCount = paper.title.split(/\s+/).length;

        // Sweet spot: 50-150 characters, 8-20 words
        if (titleLength >= 50 && titleLength <= 150) {
          scoreBreakdown.title += 8;
        } else if (titleLength < 50 || titleLength > 200) {
          scoreBreakdown.title += 2; // Too short or too long
        } else {
          scoreBreakdown.title += 5;
        }

        // Check for compelling words
        const compellingWords = ['novel', 'unprecedented', 'global', 'crisis', 'breakthrough', 'critical', 'urgent', 'first', 'rare'];
        if (compellingWords.some(word => paper.title.toLowerCase().includes(word))) {
          scoreBreakdown.title += 7;
        }
      }

      // 5. Method Novelty Score (max 15 points)
      // Use methodsArray defined earlier (handles both object and array formats)
      if (methodsArray.length > 0) {
        // Check for novel/cutting-edge methods
        if (novelMethods.some(novel => methodsArray.includes(novel))) {
          scoreBreakdown.methods = 15;
        } else {
          scoreBreakdown.methods = 8; // Has methods, but not novel
        }
      }

      // Calculate total score
      score = Object.values(scoreBreakdown).reduce((sum, val) => sum + val, 0);

      return {
        ...paper,
        score,
        scoreBreakdown
      };
    });

    // Categorize papers first, then select for diversity
    const categorizedPapers = scoredPapers.map(paper => {
      // Handle both methods formats: object with research_methods OR simple array
      const methodsArray = Array.isArray(paper.methods)
        ? paper.methods
        : (paper.methods?.research_methods || []);

      // Determine MAIN category based on what the paper is PRIMARILY about
      let mainCategory = 'Research';

      // Parse taxon_scope if it's a string
      const taxonScope = typeof paper.taxon_scope === 'string'
        ? JSON.parse(paper.taxon_scope)
        : (paper.taxon_scope || []);

      // Check if this has SPECIFIC species (not generic tags)
      const hasSpecificSpecies = taxonScope.length > 0 &&
        !taxonScope.every(t =>
          t.toLowerCase().includes('multiple taxa') ||
          t.toLowerCase().includes('ecosystem-level') ||
          t.toLowerCase().includes('community-level')
        );

      // Prioritize categories based on what paper is PRIMARILY about
      if (paper.framework_alignment && paper.framework_alignment.length > 0) {
        mainCategory = 'Conservation Policy';
      } else if (methodsArray.length > 2) {
        // Multiple methods suggests methods-focused paper
        mainCategory = 'Methods';
      } else if (hasSpecificSpecies) {
        mainCategory = 'Species';
      } else if (paper.ecosystem_type) {
        mainCategory = 'Ecosystem';
      } else if (methodsArray.length > 0) {
        mainCategory = 'Methods';
      } else if (paper.geo_scope_text) {
        mainCategory = 'Geographic';
      }

      // Determine quality descriptor for subtitle
      let descriptor = '';
      const breakdown = paper.scoreBreakdown;
      if (breakdown.journal >= 20) descriptor = 'High Impact';
      else if (breakdown.methods === 15) descriptor = 'Novel Methods';
      else if (breakdown.geography >= 15) descriptor = 'Field Study';
      else if (breakdown.metadata >= 15) descriptor = 'Comprehensive';

      // Create snippet from abstract (first 150 chars)
      const snippet = paper.abstract
        ? stripHtmlTags(paper.abstract).substring(0, 150).trim() + '...'
        : '';

      // Handle species: extract common_name from taxon_scope array
      const speciesArray = Array.isArray(paper.taxon_scope)
        ? paper.taxon_scope.map(t => typeof t === 'object' ? t.common_name : t).filter(Boolean)
        : [];

      return {
        id: paper.id,
        mainCategory,          // Species, Framework, Ecosystem, etc.
        descriptor,            // High Impact, Novel Methods, etc.
        title: stripHtmlTags(paper.title),
        snippet,
        location: paper.geo_scope_text,
        latitude: paper.latitude,
        longitude: paper.longitude,
        ecosystem: paper.ecosystem_type,
        journal: stripHtmlTags(paper.journal),
        authors: paper.authors,
        year: paper.publication_year,
        publicationDate: paper.publication_date,
        doi: paper.doi,
        citations: paper.citations,
        methods: methodsArray,
        frameworks: paper.framework_alignment || [],
        species: speciesArray,
        score: paper.score,
        addedDate: paper.created_at
      };
    });

    // Group papers by category
    const papersByCategory = {};
    categorizedPapers.forEach(paper => {
      if (!papersByCategory[paper.mainCategory]) {
        papersByCategory[paper.mainCategory] = [];
      }
      papersByCategory[paper.mainCategory].push(paper);
    });

    // Sort each category by score
    Object.keys(papersByCategory).forEach(category => {
      papersByCategory[category].sort((a, b) => b.score - a.score);
    });

    // Select top papers with category diversity (try to get one from each category)
    const highlights = [];
    const categories = Object.keys(papersByCategory);
    const limitNum = parseInt(limit);

    // Round-robin selection to ensure diversity
    let roundIdx = 0;
    while (highlights.length < limitNum && categories.length > 0) {
      const category = categories[roundIdx % categories.length];
      const categoryPapers = papersByCategory[category];

      if (categoryPapers && categoryPapers.length > 0) {
        highlights.push(categoryPapers.shift()); // Take and remove the top paper
      }

      // Remove empty categories
      if (!papersByCategory[category] || papersByCategory[category].length === 0) {
        categories.splice(roundIdx % categories.length, 1);
      } else {
        roundIdx++;
      }
    }

    res.json({
      success: true,
      count: highlights.length,
      timeRange: `Last ${days} days`,
      highlights
    });

  } catch (error) {
    console.error('Get weekly highlights error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly highlights',
    });
  }
}

