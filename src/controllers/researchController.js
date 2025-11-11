const pool = require('../config/database.cjs');
const { generateAISuggestions, saveAISuggestions, generatePreviewSuggestions } = require('../services/aiSuggestionService');
const { extractComprehensiveMetadata } = require('../../services/claudeService');
const { cleanAbstract, stripJatsXml } = require('../utils/textCleaning');
const { parseNaturalLanguageQuery } = require('../../services/naturalLanguageSearchService');

const submitResearch = async (req, res, next) => {
  const { doi, title, abstract, publication_year, journal, authors, compass_metadata } = req.body;
  const userId = req.user.userId;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const researchResult = await client.query(
      `INSERT INTO research_items (user_id, doi, title, abstract, publication_year, journal, authors)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, doi, title, abstract, publication_year, journal, JSON.stringify(authors)]
    );

    const researchId = researchResult.rows[0].id;

    // If compass_metadata is provided by user, use it
    // Otherwise, generate it with AI (for DOI-only submissions)
    let metadataToUse = compass_metadata;

    if (!compass_metadata || Object.keys(compass_metadata).length === 0) {
      // Generate AI metadata for DOI-only submissions
      console.log(`Generating AI metadata for paper: ${researchId}`);
      const aiResult = await extractComprehensiveMetadata({
        title: title,
        abstract: abstract || ''
      });

      if (aiResult.success && aiResult.data) {
        const aiData = aiResult.data;

        // Transform AI metadata to compass_metadata format
        metadataToUse = {
          ecosystem_type: aiData.ecosystem_types && aiData.ecosystem_types.length > 0
            ? aiData.ecosystem_types[0]
            : null,
          methods: aiData.research_methods || [],
          taxon_scope: aiData.taxonomic_coverage || [],
          framework_alignment: aiData.frameworks || [],
          geo_scope_text: aiData.location ? aiData.location.name : aiData.geographic_scope,
          temporal_start: aiData.temporal_range ? `${aiData.temporal_range.start}-01-01` : null,
          temporal_end: aiData.temporal_range ? `${aiData.temporal_range.end}-12-31` : null,
          geo_scope: aiData.location && aiData.location.latitude && aiData.location.longitude
            ? {
                type: 'Point',
                coordinates: [aiData.location.longitude, aiData.location.latitude]
              }
            : null
        };

        console.log(`AI metadata generated successfully for paper: ${researchId}`);
      } else {
        console.error(`AI metadata generation failed for paper: ${researchId}`, aiResult.error);
        // Use empty metadata if AI fails
        metadataToUse = {
          framework_alignment: [],
          taxon_scope: [],
          methods: [],
          ecosystem_type: null
        };
      }
    }

    const geoJson = metadataToUse.geo_scope ?
      JSON.stringify(metadataToUse.geo_scope) : null;

    await client.query(
      `INSERT INTO compass_metadata
       (research_id, framework_alignment, geo_scope_geom, geo_scope_text, taxon_scope, temporal_start, temporal_end, methods, ecosystem_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        researchId,
        JSON.stringify(metadataToUse.framework_alignment || []),
        geoJson, // Store as JSON text, not PostGIS geometry
        metadataToUse.geo_scope_text,
        JSON.stringify(metadataToUse.taxon_scope || []),
        metadataToUse.temporal_start,
        metadataToUse.temporal_end,
        JSON.stringify(metadataToUse.methods || []),
        metadataToUse.ecosystem_type || null
      ]
    );

    await client.query('COMMIT');

    // Generate AI suggestions asynchronously (separate from metadata extraction)
    setImmediate(async () => {
      try {
        const aiSuggestions = await generateAISuggestions(researchId, title, abstract);
        if (aiSuggestions.length > 0) {
          await saveAISuggestions(researchId, aiSuggestions);
        }
      } catch (error) {
        console.error('Error generating AI suggestions:', error);
      }
    });

    res.status(201).json({
      message: 'Research submitted successfully',
      research: researchResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const searchResearch = async (req, res, next) => {
  try {
    const {
      frameworks,
      keywords,
      q, // Accept both 'q' and 'keywords' for search query
      author,
      ecosystem,
      methods,
      threatTypes,
      conservationActions,
      studyTypes,
      tekOnly,
      year_from,
      year_to,
      geographic_filter,
      page = 1,
      limit = 20
    } = req.query;

    // Use either 'q' or 'keywords' for the search query
    const searchQuery = q || keywords;

    const offset = (page - 1) * limit;
    let query = `
      SELECT DISTINCT
        r.id, r.slug, r.doi, r.title, r.abstract, r.publication_year, r.publication_date, r.citations, r.journal, r.authors,
        c.framework_alignment, c.geo_scope_text, c.taxon_scope,
        c.temporal_start, c.temporal_end, c.methods, c.ecosystem_type,
        c.geo_scope_geom as geo_scope,
        u.first_name, u.last_name, u.institution,
        r.created_at
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      LEFT JOIN users u ON r.user_id = u.id
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

    if (searchQuery) {
      query += ` AND (r.title ILIKE $${paramCounter} OR r.abstract ILIKE $${paramCounter} OR r.authors::text ILIKE $${paramCounter})`;
      params.push(`%${searchQuery}%`);
      paramCounter++;
    }

    // Dedicated author filter for precise author searches (e.g., "troy sternberg")
    if (author) {
      query += ` AND r.authors::text ILIKE $${paramCounter}`;
      params.push(`%${author}%`);
      paramCounter++;
    }

    // Ecosystem filter
    if (ecosystem) {
      query += ` AND c.ecosystem_type ILIKE $${paramCounter}`;
      params.push(`%${ecosystem}%`);
      paramCounter++;
    }

    // Methods filter - supports comma-separated list
    if (methods) {
      const methodsArray = methods.split(',');
      query += ` AND c.methods ?| $${paramCounter}`;
      params.push(methodsArray);
      paramCounter++;
    }

    if (threatTypes) {
      const threatTypesArray = threatTypes.split(',');
      query += ` AND c.methods->'threat_types' ?| $${paramCounter}`;
      params.push(threatTypesArray);
      paramCounter++;
    }

    if (conservationActions) {
      const conservationActionsArray = conservationActions.split(',');
      query += ` AND c.methods->'conservation_actions' ?| $${paramCounter}`;
      params.push(conservationActionsArray);
      paramCounter++;
    }

    if (studyTypes) {
      const studyTypesArray = studyTypes.split(',');
      const studyTypeConditions = studyTypesArray.map((_, idx) => `c.methods->>'study_type' = $${paramCounter + idx}`).join(' OR ');
      query += ` AND (${studyTypeConditions})`;
      params.push(...studyTypesArray);
      paramCounter += studyTypesArray.length;
    }

    // TEK filter - only show papers with Traditional Ecological Knowledge
    if (tekOnly === 'true') {
      const tekActions = ['Traditional Ecological Knowledge (TEK)', 'Indigenous-Led Conservation'];
      query += ` AND c.methods->'conservation_actions' ?| $${paramCounter}`;
      params.push(tekActions);
      paramCounter++;
    }

    if (year_from) {
      query += ` AND r.publication_year >= $${paramCounter}`;
      params.push(parseInt(year_from));
      paramCounter++;
    }

    if (year_to) {
      query += ` AND r.publication_year <= $${paramCounter}`;
      params.push(parseInt(year_to));
      paramCounter++;
    }

    if (geographic_filter) {
      try {
        const geoFilter = JSON.parse(geographic_filter);
        if (geoFilter.type === 'country' && geoFilter.name) {
          query += ` AND c.geo_scope_text ILIKE $${paramCounter}`;
          params.push(`%${geoFilter.name}%`);
          paramCounter++;
        }
      } catch (e) {
        console.warn('Invalid geographic filter format:', geographic_filter);
      }
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`;
    params.push(parseInt(limit), offset);

    console.log('[SEARCH ENDPOINT] SQL Query:', query);
    console.log('[SEARCH ENDPOINT] Parameters:', params);
    const result = await pool.query(query, params);
    console.log('[SEARCH ENDPOINT] Results count:', result.rows.length);

    // Transform backend fields to match Geographic Explorer frontend expectations
    const processedResults = result.rows.map(row => {
      // Parse geo_scope GeoJSON
      let geoScope = null;
      if (row.geo_scope) {
        try {
          geoScope = JSON.parse(row.geo_scope);
        } catch (e) {
          geoScope = null;
        }
      }

      // Extract location from geo_scope GeoJSON (if it's a Point)
      let location = null;
      if (geoScope && geoScope.type === 'Point' && geoScope.coordinates) {
        location = {
          name: row.geo_scope_text || 'Unknown Location',
          longitude: geoScope.coordinates[0],
          latitude: geoScope.coordinates[1]
        };
      } else if (row.geo_scope_text) {
        // If no coordinates but we have text, still provide location name
        location = {
          name: row.geo_scope_text,
          longitude: null,
          latitude: null
        };
      }

      // Transform field names to match frontend expectations
      return {
        id: row.id,
        slug: row.slug,
        doi: row.doi,
        title: row.title,
        abstract: cleanAbstract(row.abstract),
        publication_year: row.publication_year,
        publication_date: row.publication_date,
        year: row.publication_year, // Alias for compatibility
        citations: row.citations || 0,
        journal: row.journal,
        // Transform authors to array of objects with 'name' field for frontend compatibility
        authors: Array.isArray(row.authors)
          ? row.authors.map(author => ({
              name: typeof author === 'string' ? author : author.name || `${author.given || ''} ${author.family || ''}`.trim()
            }))
          : (typeof row.authors === 'string'
              ? [{ name: row.authors }]
              : [{ name: JSON.stringify(row.authors) }]),

        // COMPASS metadata - transformed to match GeographicExplorer expectations
        ecosystem_types: row.ecosystem_type ? [row.ecosystem_type] : [], // Convert string to array
        // Extract research_methods array from methods object (new format) or use array directly (old format)
        research_methods: row.methods && typeof row.methods === 'object' && row.methods.research_methods
          ? row.methods.research_methods
          : (Array.isArray(row.methods) ? row.methods : []),
        taxonomic_coverage: row.taxon_scope || [], // Rename field
        frameworks: row.framework_alignment || [], // Rename field
        geographic_scope: row.geo_scope_text || null,
        temporal_range: (row.temporal_start && row.temporal_end) ? {
          start: row.temporal_start,
          end: row.temporal_end
        } : null,
        data_availability: null, // Not in current schema

        // Location for map display
        location: location,

        // User info
        first_name: row.first_name,
        last_name: row.last_name,
        institution: row.institution,
        created_at: row.created_at,

        // Keep original geo_scope for compatibility
        geo_scope: geoScope,
        geo_scope_text: row.geo_scope_text
      };
    });

    // Build count query with same filters
    let countQuery = `
      SELECT COUNT(DISTINCT r.id)
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      WHERE 1=1
    `;

    const countParams = [];
    let countParamCounter = 1;

    if (frameworks) {
      const frameworkArray = frameworks.split(',');
      countQuery += ` AND c.framework_alignment ?| $${countParamCounter}`;
      countParams.push(frameworkArray);
      countParamCounter++;
    }

    if (searchQuery) {
      countQuery += ` AND (r.title ILIKE $${countParamCounter} OR r.abstract ILIKE $${countParamCounter} OR r.authors::text ILIKE $${countParamCounter})`;
      countParams.push(`%${searchQuery}%`);
      countParamCounter++;
    }

    if (author) {
      countQuery += ` AND r.authors::text ILIKE $${countParamCounter}`;
      countParams.push(`%${author}%`);
      countParamCounter++;
    }

    if (ecosystem) {
      countQuery += ` AND c.ecosystem_type ILIKE $${countParamCounter}`;
      countParams.push(`%${ecosystem}%`);
      countParamCounter++;
    }

    if (methods) {
      const methodsArray = methods.split(',');
      countQuery += ` AND c.methods ?| $${countParamCounter}`;
      countParams.push(methodsArray);
      countParamCounter++;
    }

    if (threatTypes) {
      const threatTypesArray = threatTypes.split(',');
      countQuery += ` AND c.methods->'threat_types' ?| $${countParamCounter}`;
      countParams.push(threatTypesArray);
      countParamCounter++;
    }

    if (conservationActions) {
      const conservationActionsArray = conservationActions.split(',');
      countQuery += ` AND c.methods->'conservation_actions' ?| $${countParamCounter}`;
      countParams.push(conservationActionsArray);
      countParamCounter++;
    }

    if (studyTypes) {
      const studyTypesArray = studyTypes.split(',');
      const studyTypeConditions = studyTypesArray.map((_, idx) => `c.methods->>'study_type' = $${countParamCounter + idx}`).join(' OR ');
      countQuery += ` AND (${studyTypeConditions})`;
      countParams.push(...studyTypesArray);
      countParamCounter += studyTypesArray.length;
    }

    // TEK filter for count query
    if (tekOnly === 'true') {
      const tekActions = ['Traditional Ecological Knowledge (TEK)', 'Indigenous-Led Conservation'];
      countQuery += ` AND c.methods->'conservation_actions' ?| $${countParamCounter}`;
      countParams.push(tekActions);
      countParamCounter++;
    }

    if (year_from) {
      countQuery += ` AND r.publication_year >= $${countParamCounter}`;
      countParams.push(parseInt(year_from));
      countParamCounter++;
    }

    if (year_to) {
      countQuery += ` AND r.publication_year <= $${countParamCounter}`;
      countParams.push(parseInt(year_to));
      countParamCounter++;
    }

    if (geographic_filter) {
      try {
        const geoFilter = JSON.parse(geographic_filter);
        if (geoFilter.type === 'country' && geoFilter.name) {
          countQuery += ` AND c.geo_scope_text ILIKE $${countParamCounter}`;
          countParams.push(`%${geoFilter.name}%`);
          countParamCounter++;
        }
      } catch (e) {
        console.warn('Invalid geographic filter format:', geographic_filter);
      }
    }

    const countResult = await pool.query(countQuery, countParams);

    // Return in format expected by frontend (papersApi.js expects "papers" key)
    res.json({
      papers: processedResults,  // Changed from "results" to "papers"
      total: parseInt(countResult.rows[0].count),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Map endpoint - Returns ONLY papers with geographic coordinates matching search criteria
 * This endpoint is specifically for the map view and only shows search results, not all papers
 * GET /api/research/map
 */
const getResearchForMap = async (req, res, next) => {
  try {
    const {
      frameworks,
      keywords,
      author,
      ecosystem,
      methods,
      threatTypes,
      conservationActions,
      studyTypes,
      tekOnly,
      year_from,
      year_to,
      geographic_filter
    } = req.query;

    let query = `
      SELECT DISTINCT
        r.id, r.slug, r.title, r.abstract, r.publication_year, r.publication_date, r.citations, r.journal, r.authors, r.doi,
        c.framework_alignment, c.geo_scope_text, c.ecosystem_type,
        c.methods, c.taxon_scope,
        c.geo_scope_geom as geo_scope,
        u.first_name, u.last_name,
        r.created_at
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      JOIN users u ON r.user_id = u.id
      WHERE c.geo_scope_geom IS NOT NULL
    `;

    const params = [];
    let paramCounter = 1;

    if (frameworks) {
      const frameworkArray = frameworks.split(',');
      query += ` AND c.framework_alignment ?| $${paramCounter}`;
      params.push(frameworkArray);
      paramCounter++;
    }

    // Combined keyword and author search with OR logic
    if (keywords && author) {
      query += ` AND (r.title ILIKE $${paramCounter} OR r.abstract ILIKE $${paramCounter} OR r.authors::text ILIKE $${paramCounter})`;
      params.push(`%${keywords}%`);
      paramCounter++;
    } else if (keywords) {
      query += ` AND (r.title ILIKE $${paramCounter} OR r.abstract ILIKE $${paramCounter})`;
      params.push(`%${keywords}%`);
      paramCounter++;
    } else if (author) {
      query += ` AND r.authors::text ILIKE $${paramCounter}`;
      params.push(`%${author}%`);
      paramCounter++;
    }

    if (ecosystem) {
      query += ` AND c.ecosystem_type ILIKE $${paramCounter}`;
      params.push(`%${ecosystem}%`);
      paramCounter++;
    }

    if (methods) {
      const methodsArray = methods.split(',');
      query += ` AND c.methods ?| $${paramCounter}`;
      params.push(methodsArray);
      paramCounter++;
    }

    if (threatTypes) {
      const threatTypesArray = threatTypes.split(',');
      query += ` AND c.methods->'threat_types' ?| $${paramCounter}`;
      params.push(threatTypesArray);
      paramCounter++;
    }

    if (conservationActions) {
      const conservationActionsArray = conservationActions.split(',');
      query += ` AND c.methods->'conservation_actions' ?| $${paramCounter}`;
      params.push(conservationActionsArray);
      paramCounter++;
    }

    if (studyTypes) {
      const studyTypesArray = studyTypes.split(',');
      const studyTypeConditions = studyTypesArray.map((_, idx) => `c.methods->>'study_type' = $${paramCounter + idx}`).join(' OR ');
      query += ` AND (${studyTypeConditions})`;
      params.push(...studyTypesArray);
      paramCounter += studyTypesArray.length;
    }

    // TEK filter - only show papers with Traditional Ecological Knowledge
    if (tekOnly === 'true') {
      const tekActions = ['Traditional Ecological Knowledge (TEK)', 'Indigenous-Led Conservation'];
      query += ` AND c.methods->'conservation_actions' ?| $${paramCounter}`;
      params.push(tekActions);
      paramCounter++;
    }

    if (year_from) {
      query += ` AND r.publication_year >= $${paramCounter}`;
      params.push(parseInt(year_from));
      paramCounter++;
    }

    if (year_to) {
      query += ` AND r.publication_year <= $${paramCounter}`;
      params.push(parseInt(year_to));
      paramCounter++;
    }

    if (geographic_filter) {
      try {
        const geoFilter = JSON.parse(geographic_filter);
        if (geoFilter.type === 'country' && geoFilter.name) {
          query += ` AND c.geo_scope_text ILIKE $${paramCounter}`;
          params.push(`%${geoFilter.name}%`);
          paramCounter++;
        }
      } catch (e) {
        console.warn('Invalid geographic filter format:', geographic_filter);
      }
    }

    query += ` ORDER BY r.created_at DESC`;

    // Debug logging
    console.log('[MAP ENDPOINT] SQL Query:', query);
    console.log('[MAP ENDPOINT] Parameters:', params);

    const result = await pool.query(query, params);
    console.log('[MAP ENDPOINT] Results count:', result.rows.length);

    // Transform results for map display
    const mapPapers = result.rows.map(row => {
      let geoScope = null;
      if (row.geo_scope) {
        try {
          geoScope = JSON.parse(row.geo_scope);
        } catch (e) {
          geoScope = null;
        }
      }

      let location = null;
      if (geoScope && geoScope.type === 'Point' && geoScope.coordinates) {
        location = {
          name: row.geo_scope_text || 'Unknown Location',
          longitude: geoScope.coordinates[0],
          latitude: geoScope.coordinates[1]
        };
      }

      // Normalize methods field - handle both array (old format) and object (new format)
      let methods = [];
      if (row.methods) {
        if (Array.isArray(row.methods)) {
          // Old format: methods is already an array
          methods = row.methods;
        } else if (typeof row.methods === 'object' && row.methods.research_methods) {
          // New format: methods is an object with research_methods array
          methods = row.methods.research_methods || [];
        }
      }

      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        abstract: cleanAbstract(row.abstract),
        publication_year: row.publication_year,
        publication_date: row.publication_date,
        year: row.publication_year,
        citations: row.citations || 0,
        journal: row.journal,
        doi: row.doi || null,
        // Transform authors to array of objects with 'name' field for frontend compatibility
        authors: Array.isArray(row.authors)
          ? row.authors.map(author => ({
              name: typeof author === 'string' ? author : author.name || `${author.given || ''} ${author.family || ''}`.trim()
            }))
          : (typeof row.authors === 'string'
              ? [{ name: row.authors }]
              : [{ name: JSON.stringify(row.authors) }]),
        ecosystem_types: row.ecosystem_type ? [row.ecosystem_type] : [],
        methods: methods,  // Changed from research_methods to methods for frontend compatibility
        research_methods: methods,  // Also provide research_methods for backward compatibility
        taxonomic_coverage: row.taxon_scope || [],
        frameworks: row.framework_alignment || [],
        geographic_scope: row.geo_scope_text,
        location: location,
        first_name: row.first_name,
        last_name: row.last_name
      };
    });

    res.json({
      papers: mapPapers,
      total: mapPapers.length
    });
  } catch (error) {
    next(error);
  }
};

const getResearchById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if ID is a UUID or a slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const query = `
      SELECT
        r.*,
        c.framework_alignment, c.geo_scope_text, c.geo_scope_geom,
        c.taxon_scope, c.temporal_start, c.temporal_end, c.methods, c.ecosystem_type,
        u.first_name, u.last_name, u.institution, u.orcid_id
       FROM research_items r
       JOIN compass_metadata c ON r.id = c.research_id
       JOIN users u ON r.user_id = u.id
       WHERE ${isUUID ? 'r.id = $1' : 'r.slug = $1'}
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Research not found' });
    }

    const research = result.rows[0];
    if (research.geo_scope_geojson) {
      research.geo_scope = JSON.parse(research.geo_scope_geojson);
      delete research.geo_scope_geojson;
    }

    // If accessed by UUID, redirect to slug URL for SEO
    if (isUUID && research.slug) {
      return res.status(301).json({
        redirect: `/research/${research.slug}`,
        message: 'Redirecting to SEO-friendly URL',
        research
      });
    }

    res.json(research);
  } catch (error) {
    next(error);
  }
};

const suggestMetadata = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { suggestion_type, suggestion_data, note } = req.body;
    const userId = req.user.userId;

    const result = await pool.query(
      `INSERT INTO metadata_suggestions
       (research_id, suggested_by, suggestion_type, suggestion_data)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, userId, suggestion_type, JSON.stringify(suggestion_data)]
    );

    res.status(201).json({
      message: 'Suggestion submitted successfully',
      suggestion: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getMyResearch = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT r.*, c.framework_alignment, c.geo_scope_text, c.ecosystem_type
       FROM research_items r
       JOIN compass_metadata c ON r.id = c.research_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM research_items WHERE user_id = $1',
      [userId]
    );

    res.json({
      results: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getSuggestionsForResearch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    let query = `
      SELECT s.*,
             u.first_name, u.last_name, u.email, u.institution
      FROM metadata_suggestions s
      JOIN users u ON s.suggested_by = u.id
      WHERE s.research_id = $1
    `;

    const params = [id];

    if (status) {
      query += ` AND s.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY s.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({ suggestions: result.rows });
  } catch (error) {
    next(error);
  }
};

const getMySuggestions = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT s.*,
              r.title as research_title,
              u.first_name, u.last_name
       FROM metadata_suggestions s
       JOIN research_items r ON s.research_id = r.id
       JOIN users u ON r.user_id = u.id
       WHERE s.suggested_by = $1
       ORDER BY s.created_at DESC`,
      [userId]
    );

    res.json({ suggestions: result.rows });
  } catch (error) {
    next(error);
  }
};

const getPendingSuggestionsForMyResearch = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT s.*,
              r.id as research_id, r.title as research_title,
              u.first_name as suggester_first_name,
              u.last_name as suggester_last_name,
              u.institution as suggester_institution
       FROM metadata_suggestions s
       JOIN research_items r ON s.research_id = r.id
       JOIN users u ON s.suggested_by = u.id
       WHERE r.user_id = $1 AND s.status = 'pending'
       ORDER BY s.created_at DESC`,
      [userId]
    );

    res.json({ suggestions: result.rows });
  } catch (error) {
    next(error);
  }
};

const reviewSuggestion = async (req, res, next) => {
  const { id } = req.params;
  const { action, review_note } = req.body;
  const userId = req.user.userId;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const suggestionResult = await client.query(
      `SELECT s.*, r.user_id as research_owner_id
       FROM metadata_suggestions s
       JOIN research_items r ON s.research_id = r.id
       WHERE s.id = $1`,
      [id]
    );

    if (suggestionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const suggestion = suggestionResult.rows[0];

    if (suggestion.research_owner_id !== userId) {
      return res.status(403).json({ error: 'Only the research author can review suggestions' });
    }

    if (suggestion.status !== 'pending') {
      return res.status(400).json({ error: 'This suggestion has already been reviewed' });
    }

    if (action === 'accept') {
      const suggestionData = suggestion.suggestion_data;

      if (suggestion.suggestion_type === 'framework_alignment') {
        await client.query(
          `UPDATE compass_metadata
           SET framework_alignment = framework_alignment || $1::jsonb
           WHERE research_id = $2`,
          [JSON.stringify(suggestionData.add), suggestion.research_id]
        );
      } else if (suggestion.suggestion_type === 'methods') {
        await client.query(
          `UPDATE compass_metadata
           SET methods = COALESCE(methods, '[]'::jsonb) || $1::jsonb
           WHERE research_id = $2`,
          [JSON.stringify(suggestionData.add), suggestion.research_id]
        );
      } else if (suggestion.suggestion_type === 'taxon_scope') {
        await client.query(
          `UPDATE compass_metadata
           SET taxon_scope = COALESCE(taxon_scope, '[]'::jsonb) || $1::jsonb
           WHERE research_id = $2`,
          [JSON.stringify(suggestionData.add), suggestion.research_id]
        );
      }

      await client.query(
        `UPDATE metadata_suggestions
         SET status = 'accepted', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3`,
        [userId, review_note, id]
      );
    } else if (action === 'reject') {
      await client.query(
        `UPDATE metadata_suggestions
         SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3`,
        [userId, review_note, id]
      );
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be "accept" or "reject"' });
    }

    await client.query('COMMIT');

    res.json({
      message: `Suggestion ${action}ed successfully`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

const previewAISuggestions = async (req, res, next) => {
  try {
    const { title, abstract, currentFrameworks, currentMethods } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const suggestions = await generatePreviewSuggestions(
      title,
      abstract || '',
      currentFrameworks || [],
      currentMethods || []
    );

    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate AI metadata for a specific paper and save to database
 * POST /api/research/:id/generate-metadata
 */
const generateMetadataForPaper = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch the paper
    const paperResult = await pool.query(
      'SELECT id, title, abstract FROM research_items WHERE id = $1',
      [id]
    );

    if (paperResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Paper not found'
      });
    }

    const paper = paperResult.rows[0];

    // Call AI service to generate comprehensive metadata
    const { extractComprehensiveMetadata } = require('../../services/claudeService');
    const result = await extractComprehensiveMetadata({
      title: paper.title,
      abstract: paper.abstract
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate metadata',
        message: result.error
      });
    }

    const metadata = result.data;

    // Update compass_metadata with AI-generated data
    await pool.query(
      `UPDATE compass_metadata SET
        ecosystem_type = COALESCE($1, ecosystem_type),
        methods = COALESCE($2::jsonb, methods),
        taxon_scope = COALESCE($3::jsonb, taxon_scope),
        framework_alignment = COALESCE($4::jsonb, framework_alignment),
        geo_scope_text = COALESCE($5, geo_scope_text),
        temporal_start = COALESCE($6, temporal_start),
        temporal_end = COALESCE($7, temporal_end)
      WHERE research_id = $8`,
      [
        metadata.ecosystem_types && metadata.ecosystem_types.length > 0 ? metadata.ecosystem_types[0] : null,
        metadata.research_methods && metadata.research_methods.length > 0 ? JSON.stringify(metadata.research_methods) : null,
        metadata.taxonomic_coverage && metadata.taxonomic_coverage.length > 0 ? JSON.stringify(metadata.taxonomic_coverage) : null,
        metadata.frameworks && metadata.frameworks.length > 0 ? JSON.stringify(metadata.frameworks) : null,
        metadata.location ? metadata.location.name : null,
        metadata.temporal_range ? metadata.temporal_range.start : null,
        metadata.temporal_range ? metadata.temporal_range.end : null,
        id
      ]
    );

    // If we have location coordinates, update geo_scope_geom as GeoJSON
    if (metadata.location && metadata.location.latitude && metadata.location.longitude) {
      const geoJson = {
        type: 'Point',
        coordinates: [metadata.location.longitude, metadata.location.latitude]
      };

      await pool.query(
        `UPDATE compass_metadata SET geo_scope_geom = $1 WHERE research_id = $2`,
        [JSON.stringify(geoJson), id]
      );
    }

    res.json({
      success: true,
      message: 'Metadata generated and saved successfully',
      metadata: {
        ecosystem_types: metadata.ecosystem_types,
        research_methods: metadata.research_methods,
        taxonomic_coverage: metadata.taxonomic_coverage,
        frameworks: metadata.frameworks,
        location: metadata.location,
        geographic_scope: metadata.geographic_scope,
        temporal_range: metadata.temporal_range,
        confidence: metadata.confidence,
        rationale: metadata.rationale
      }
    });
  } catch (error) {
    console.error('Generate metadata error:', error);
    next(error);
  }
};

/**
 * Natural language search - parses user's natural language query and applies structured filters
 * PREMIUM FEATURE: Requires paid subscription (Pro tier or higher)
 */
const naturalLanguageSearch = async (req, res, next) => {
  try {
    const { query, page = 1, limit = 20 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Natural language query is required'
      });
    }

    // Check if user is authenticated (optional - allow anonymous queries for now)
    // In the future, you can enforce authentication by uncommenting this:
    // if (!req.user) {
    //   return res.status(401).json({
    //     success: false,
    //     error: 'Authentication required for AI-powered search',
    //     requiresAuth: true,
    //     upgradeUrl: '/pricing'
    //   });
    // }

    // Check if user has paid subscription (Pro or higher)
    if (req.user) {
      const userSubscription = req.user.subscription || 'free';
      const subscriptionStatus = req.user.subscription_status;

      // Free tier users cannot use AI search
      if (userSubscription === 'free' || !userSubscription || subscriptionStatus !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'AI-powered natural language search is a premium feature',
          message: 'Upgrade to Pro ($29/month) to use AI-powered search with natural language queries',
          currentPlan: userSubscription || 'free',
          requiredPlan: 'pro',
          upgradeUrl: '/pricing',
          features: [
            'Ask questions in natural language',
            'AI extracts filters automatically',
            'Search by species, locations, methods, threats, and more',
            'Transparent filter explanations',
            'Priority support'
          ]
        });
      }
    }

    // Parse natural language query using Claude Haiku
    const parseResult = await parseNaturalLanguageQuery(query);

    if (!parseResult.success) {
      throw new Error('Failed to parse natural language query');
    }

    const { filters, explanation, cost, usage } = parseResult;

    // Build query parameters from extracted filters
    const queryParams = {
      page,
      limit
    };

    // Map filters to searchResearch parameters
    if (filters.keywords && filters.keywords.length > 0) {
      queryParams.q = filters.keywords.join(' ');
    }

    if (filters.species && filters.species.length > 0) {
      // Species will be searched in taxon_scope JSONB field
      queryParams.species = filters.species.join(',');
    }

    if (filters.locations && filters.locations.length > 0) {
      queryParams.geographic_filter = filters.locations.join(',');
    }

    if (filters.excludedLocations && filters.excludedLocations.length > 0) {
      queryParams.excluded_locations = filters.excludedLocations.join(',');
    }

    if (filters.ecosystems && filters.ecosystems.length > 0) {
      queryParams.ecosystem = filters.ecosystems.join(',');
    }

    if (filters.methods && filters.methods.length > 0) {
      queryParams.methods = filters.methods.join(',');
    }

    if (filters.threatTypes && filters.threatTypes.length > 0) {
      queryParams.threatTypes = filters.threatTypes.join(',');
    }

    if (filters.conservationActions && filters.conservationActions.length > 0) {
      queryParams.conservationActions = filters.conservationActions.join(',');
    }

    if (filters.frameworks && filters.frameworks.length > 0) {
      queryParams.frameworks = filters.frameworks.join(',');
    }

    if (filters.studyTypes && filters.studyTypes.length > 0) {
      queryParams.studyTypes = filters.studyTypes.join(',');
    }

    if (filters.authors && filters.authors.length > 0) {
      queryParams.author = filters.authors.join(' ');
    }

    if (filters.dateRange) {
      if (filters.dateRange.start) {
        queryParams.year_from = filters.dateRange.start;
      }
      if (filters.dateRange.end) {
        queryParams.year_to = filters.dateRange.end;
      }
    }

    // Handle sorting and limit from AI-parsed query
    let sortBy = 'created_at';  // Default sort
    let sortOrder = 'DESC';      // Default order

    if (filters.sortBy) {
      if (filters.sortBy === 'citations') {
        sortBy = 'citations';
        sortOrder = filters.sortOrder?.toUpperCase() || 'DESC';
      } else if (filters.sortBy === 'date') {
        sortBy = 'publication_date';
        sortOrder = filters.sortOrder?.toUpperCase() || 'DESC';
      }
      // relevance uses default (created_at DESC)
    }

    // Override limit if specified in query
    let effectiveLimit = limit;
    if (filters.limit && typeof filters.limit === 'number' && filters.limit > 0) {
      effectiveLimit = Math.min(filters.limit, 100);  // Cap at 100 to prevent abuse
    }

    // Execute search with extracted filters
    const offset = (page - 1) * effectiveLimit;

    // Build WHERE clause that will be reused for both main query and count query
    let whereClause = '';
    const queryValues = [];
    let paramCount = 1;

    // Add filters based on extracted parameters
    if (queryParams.q) {
      queryValues.push(`%${queryParams.q}%`, `%${queryParams.q}%`, `%${queryParams.q}%`);
      whereClause += ` AND (r.title ILIKE $${paramCount} OR r.abstract ILIKE $${paramCount + 1} OR r.authors::text ILIKE $${paramCount + 2})`;
      paramCount += 3;
    }

    if (queryParams.author) {
      queryValues.push(`%${queryParams.author}%`);
      whereClause += ` AND r.authors::text ILIKE $${paramCount}`;
      paramCount++;
    }

    if (queryParams.ecosystem) {
      const ecosystems = queryParams.ecosystem.split(',');
      queryValues.push(ecosystems);
      whereClause += ` AND c.ecosystem_type = ANY($${paramCount})`;
      paramCount++;
    }

    if (queryParams.methods) {
      const methods = queryParams.methods.split(',');
      // Use case-insensitive matching for methods
      const methodConditions = methods.map(() => {
        const condition = `c.methods->>'research_methods' ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      methods.forEach(method => queryValues.push(`%${method}%`));
      whereClause += ` AND (${methodConditions})`;
    }

    if (queryParams.threatTypes) {
      const threatTypes = queryParams.threatTypes.split(',');
      // Use case-insensitive matching for threat types
      const threatConditions = threatTypes.map(() => {
        const condition = `c.methods->>'threat_types' ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      threatTypes.forEach(threat => queryValues.push(`%${threat}%`));
      whereClause += ` AND (${threatConditions})`;
    }

    if (queryParams.conservationActions) {
      const actions = queryParams.conservationActions.split(',');
      // Use case-insensitive matching for conservation actions
      const actionConditions = actions.map(() => {
        const condition = `c.methods->>'conservation_actions' ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      actions.forEach(action => queryValues.push(`%${action}%`));
      whereClause += ` AND (${actionConditions})`;
    }

    if (queryParams.studyTypes) {
      const studyTypes = queryParams.studyTypes.split(',');
      const studyTypeConditions = studyTypes.map(() => {
        const condition = `c.methods->>'study_type' = $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      studyTypes.forEach(st => queryValues.push(st));
      whereClause += ` AND (${studyTypeConditions})`;
    }

    if (queryParams.frameworks) {
      const frameworks = queryParams.frameworks.split(',');
      // Use case-insensitive matching for frameworks
      const frameworkConditions = frameworks.map(() => {
        const condition = `c.framework_alignment::text ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      frameworks.forEach(fw => queryValues.push(`%${fw}%`));
      whereClause += ` AND (${frameworkConditions})`;
    }

    if (queryParams.geographic_filter) {
      const locations = queryParams.geographic_filter.split(',');
      const locationConditions = locations.map(() => {
        const condition = `c.geo_scope_text ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      locations.forEach(loc => queryValues.push(`%${loc}%`));
      whereClause += ` AND (${locationConditions})`;
    }

    // Handle excluded locations (NOT in Mongolia, etc.)
    if (queryParams.excluded_locations) {
      const excludedLocations = queryParams.excluded_locations.split(',');
      const exclusionConditions = excludedLocations.map(() => {
        const condition = `c.geo_scope_text NOT ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' AND ');
      excludedLocations.forEach(loc => queryValues.push(`%${loc}%`));
      whereClause += ` AND (${exclusionConditions})`;
    }

    if (queryParams.species) {
      const species = queryParams.species.split(',');
      const speciesConditions = species.map(() => {
        const condition = `c.taxon_scope::text ILIKE $${paramCount}`;
        paramCount++;
        return condition;
      }).join(' OR ');
      species.forEach(sp => queryValues.push(`%${sp}%`));
      whereClause += ` AND (${speciesConditions})`;
    }

    // Handle date filtering with month-level precision
    // If date contains "-" (YYYY-MM format), filter on publication_date
    // Otherwise, filter on publication_year (YYYY format)
    if (queryParams.year_from) {
      if (queryParams.year_from.includes('-')) {
        // Month-level filtering: YYYY-MM format
        // Filter for dates >= first day of specified month
        queryValues.push(queryParams.year_from + '-01');
        whereClause += ` AND r.publication_date >= $${paramCount}::date`;
        paramCount++;
      } else {
        // Year-level filtering: YYYY format
        queryValues.push(parseInt(queryParams.year_from));
        whereClause += ` AND r.publication_year >= $${paramCount}`;
        paramCount++;
      }
    }

    if (queryParams.year_to) {
      if (queryParams.year_to.includes('-')) {
        // Month-level filtering: YYYY-MM format
        // Filter for dates <= last day of specified month
        // Calculate last day by going to first day of next month and subtracting 1 day
        const [year, month] = queryParams.year_to.split('-');
        const nextMonth = parseInt(month) === 12 ? `${parseInt(year) + 1}-01` : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}`;
        queryValues.push(nextMonth + '-01');
        whereClause += ` AND r.publication_date < $${paramCount}::date`;
        paramCount++;
      } else {
        // Year-level filtering: YYYY format
        queryValues.push(parseInt(queryParams.year_to));
        whereClause += ` AND r.publication_year <= $${paramCount}`;
        paramCount++;
      }
    }

    // Build main query with WHERE clause
    let sqlQuery = `
      SELECT DISTINCT
        r.id, r.slug, r.doi, r.title, r.abstract, r.publication_year, r.publication_date, r.citations, r.journal, r.authors,
        c.framework_alignment, c.geo_scope_text, c.taxon_scope,
        c.temporal_start, c.temporal_end, c.methods, c.ecosystem_type,
        c.geo_scope_geom as geo_scope,
        u.first_name, u.last_name, u.institution,
        r.created_at
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE 1=1
      ${whereClause}
      ORDER BY r.${sortBy} ${sortOrder} LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    queryValues.push(effectiveLimit, offset);

    const result = await pool.query(sqlQuery, queryValues);

    // Get total count for pagination using same WHERE clause
    let countQuery = `
      SELECT COUNT(DISTINCT r.id) as total
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE 1=1
      ${whereClause}
    `;
    const countValues = queryValues.slice(0, -2); // Remove limit and offset

    const countResult = await pool.query(countQuery, countValues);
    const total = parseInt(countResult.rows[0]?.total || 0);

    // Transform authors field from string to array of objects
    const papers = result.rows.map(row => {
      let authors = [];
      try {
        const authorsData = typeof row.authors === 'string' ? JSON.parse(row.authors) : row.authors;
        if (Array.isArray(authorsData)) {
          authors = authorsData.map(author => {
            if (typeof author === 'string') {
              return { name: author };
            } else if (author.given && author.family) {
              return { name: `${author.given} ${author.family}`.trim() };
            } else if (author.name) {
              return { name: author.name };
            }
            return { name: 'Unknown' };
          });
        }
      } catch (e) {
        authors = [{ name: 'Unknown' }];
      }

      // Extract research_methods from methods JSONB object
      let researchMethods = [];
      if (row.methods && typeof row.methods === 'object' && row.methods.research_methods) {
        researchMethods = row.methods.research_methods;
      } else if (Array.isArray(row.methods)) {
        researchMethods = row.methods;
      }

      // Parse geographic coordinates from PostGIS geometry (same as map endpoint)
      let geoScope = null;
      if (row.geo_scope) {
        try {
          geoScope = JSON.parse(row.geo_scope);
        } catch (e) {
          geoScope = null;
        }
      }

      let location = null;
      if (geoScope && geoScope.type === 'Point' && geoScope.coordinates) {
        location = {
          name: row.geo_scope_text || 'Unknown Location',
          longitude: geoScope.coordinates[0],
          latitude: geoScope.coordinates[1]
        };
      }

      return {
        id: row.id,
        slug: row.slug,
        doi: row.doi,
        title: stripJatsXml(row.title),
        abstract: cleanAbstract(row.abstract),
        publicationYear: row.publication_year,
        publication_date: row.publication_date,
        citations: row.citations || 0,
        journal: row.journal,
        authors: authors,
        frameworks: row.framework_alignment,
        location: location,  // Changed from geo_scope_text to parsed location object
        taxonomic_coverage: row.taxon_scope,  // Changed from 'species' to match frontend expectations
        temporalStart: row.temporal_start,
        temporalEnd: row.temporal_end,
        research_methods: researchMethods,
        ecosystem_types: row.ecosystem_type ? [row.ecosystem_type] : [], // Convert string to array to match regular search format
        geoScope: row.geo_scope,
        researcher: {
          firstName: row.first_name,
          lastName: row.last_name,
          institution: row.institution
        },
        createdAt: row.created_at
      };
    });

    res.json({
      success: true,
      query: query,
      filters: filters,
      explanation: explanation,
      papers: papers,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      cost: cost,
      usage: usage
    });

  } catch (error) {
    console.error('Natural language search error:', error);
    next(error);
  }
};

module.exports = {
  submitResearch,
  searchResearch,
  getResearchForMap,
  getResearchById,
  suggestMetadata,
  getMyResearch,
  getSuggestionsForResearch,
  getMySuggestions,
  getPendingSuggestionsForMyResearch,
  reviewSuggestion,
  previewAISuggestions,
  generateMetadataForPaper,
  naturalLanguageSearch
};