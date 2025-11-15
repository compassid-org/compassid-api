const pool = require('../config/database.js');

const FRAMEWORK_KEYWORDS = {
  'SDG-14': ['ocean', 'marine', 'sea', 'coastal', 'fish', 'reef', 'aquatic'],
  'SDG-14.2': ['marine ecosystem', 'ocean health', 'marine protected', 'coral reef'],
  'SDG-14.5': ['marine conservation', 'protected area', 'marine reserve', '30x30'],
  'SDG-15': ['forest', 'land', 'terrestrial', 'biodiversity', 'ecosystem', 'wildlife'],
  'SDG-15.1': ['forest conservation', 'terrestrial ecosystem', 'habitat protection'],
  'SDG-15.5': ['biodiversity loss', 'species extinction', 'habitat degradation'],
  'SDG-13': ['climate', 'warming', 'greenhouse', 'carbon', 'emission', 'temperature'],
  'CBD-TARGET-3': ['30x30', '30 by 30', 'protected area', 'conservation area'],
  'CBD-TARGET-2': ['restoration', 'ecosystem restoration', 'habitat restoration'],
  'CCAMLR': ['antarctic', 'southern ocean', 'ccamlr'],
  'RAMSAR': ['wetland', 'ramsar', 'marsh', 'swamp'],
  'UNFCCC': ['paris agreement', 'climate agreement', 'unfccc', 'cop']
};

const METHOD_KEYWORDS = {
  'Remote sensing': ['satellite', 'remote sensing', 'aerial', 'imagery', 'landsat', 'modis'],
  'Population modeling': ['population model', 'demographic', 'population dynamic', 'viability'],
  'GIS analysis': ['gis', 'geographic information', 'spatial analysis', 'arcgis', 'qgis'],
  'Camera trapping': ['camera trap', 'trail camera', 'photo trap'],
  'Biodiversity surveys': ['biodiversity survey', 'species survey', 'transect', 'quadrat'],
  'Climate modeling': ['climate model', 'cmip', 'rcp', 'ssp', 'climate scenario'],
  'Economic analysis': ['cost-benefit', 'economic valuation', 'willingness to pay'],
  'Policy review': ['policy analysis', 'policy review', 'governance', 'regulation'],
  'Satellite tracking': ['satellite tag', 'telemetry', 'gps tracking', 'argos'],
  'Habitat assessment': ['habitat assessment', 'habitat quality', 'habitat suitability']
};

const generateAISuggestions = async (researchId, title, abstract) => {
  try {
    const text = `${title} ${abstract || ''}`.toLowerCase();
    const suggestions = [];

    const existingMetadata = await pool.query(
      `SELECT framework_alignment, methods FROM compass_metadata WHERE research_id = $1`,
      [researchId]
    );

    if (existingMetadata.rows.length === 0) {
      return [];
    }

    const currentFrameworks = existingMetadata.rows[0].framework_alignment || [];
    const currentMethods = existingMetadata.rows[0].methods || [];

    const suggestedFrameworks = [];
    for (const [framework, keywords] of Object.entries(FRAMEWORK_KEYWORDS)) {
      if (currentFrameworks.includes(framework)) continue;

      const matches = keywords.filter(keyword => text.includes(keyword.toLowerCase()));
      if (matches.length > 0) {
        suggestedFrameworks.push({
          framework,
          confidence: Math.min(0.95, matches.length * 0.3),
          reason: `Found relevant keywords: ${matches.join(', ')}`
        });
      }
    }

    if (suggestedFrameworks.length > 0) {
      suggestions.push({
        suggestion_type: 'framework_alignment',
        suggestion_data: {
          add: suggestedFrameworks.slice(0, 5).map(f => f.framework),
          confidence_scores: suggestedFrameworks.slice(0, 5).reduce((acc, f) => {
            acc[f.framework] = f.confidence;
            return acc;
          }, {}),
          reasoning: suggestedFrameworks.slice(0, 5).map(f => f.reason)
        },
        source: 'ai_keyword_analysis'
      });
    }

    const suggestedMethods = [];
    for (const [method, keywords] of Object.entries(METHOD_KEYWORDS)) {
      if (currentMethods.includes(method)) continue;

      const matches = keywords.filter(keyword => text.includes(keyword.toLowerCase()));
      if (matches.length > 0) {
        suggestedMethods.push({
          method,
          confidence: Math.min(0.95, matches.length * 0.4),
          reason: `Found methodology indicators: ${matches.join(', ')}`
        });
      }
    }

    if (suggestedMethods.length > 0) {
      suggestions.push({
        suggestion_type: 'methods',
        suggestion_data: {
          add: suggestedMethods.slice(0, 5).map(m => m.method),
          confidence_scores: suggestedMethods.slice(0, 5).reduce((acc, m) => {
            acc[m.method] = m.confidence;
            return acc;
          }, {}),
          reasoning: suggestedMethods.slice(0, 5).map(m => m.reason)
        },
        source: 'ai_keyword_analysis'
      });
    }

    return suggestions;
  } catch (error) {
    console.error('Error generating AI suggestions:', error);
    return [];
  }
};

const saveAISuggestions = async (researchId, suggestions) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const aiUserId = await getOrCreateAIUser(client);

    for (const suggestion of suggestions) {
      await client.query(
        `INSERT INTO metadata_suggestions
         (research_id, suggested_by, suggestion_type, suggestion_data, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [researchId, aiUserId, suggestion.suggestion_type, JSON.stringify({
          ...suggestion.suggestion_data,
          source: suggestion.source
        })]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving AI suggestions:', error);
    return false;
  } finally {
    client.release();
  }
};

const getOrCreateAIUser = async (client) => {
  const result = await client.query(
    `SELECT id FROM users WHERE email = 'ai-assistant@compassid.system'`
  );

  if (result.rows.length > 0) {
    return result.rows[0].id;
  }

  const createResult = await client.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, institution)
     VALUES ('ai-assistant@compassid.system', 'N/A', 'AI', 'Assistant', 'Compass ID System')
     RETURNING id`
  );

  return createResult.rows[0].id;
};

const generatePreviewSuggestions = async (title, abstract, currentFrameworks = [], currentMethods = []) => {
  try {
    const text = `${title} ${abstract || ''}`.toLowerCase();
    const suggestions = [];

    const suggestedFrameworks = [];
    for (const [framework, keywords] of Object.entries(FRAMEWORK_KEYWORDS)) {
      if (currentFrameworks.includes(framework)) continue;

      const matches = keywords.filter(keyword => text.includes(keyword.toLowerCase()));
      if (matches.length > 0) {
        suggestedFrameworks.push({
          framework,
          confidence: Math.min(0.95, matches.length * 0.3),
          reason: `Found relevant keywords: ${matches.join(', ')}`
        });
      }
    }

    if (suggestedFrameworks.length > 0) {
      suggestions.push({
        suggestion_type: 'framework_alignment',
        suggestion_data: {
          add: suggestedFrameworks.slice(0, 5).map(f => f.framework),
          confidence_scores: suggestedFrameworks.slice(0, 5).reduce((acc, f) => {
            acc[f.framework] = f.confidence;
            return acc;
          }, {}),
          reasoning: suggestedFrameworks.slice(0, 5).map(f => f.reason)
        },
        source: 'ai_keyword_analysis'
      });
    }

    const suggestedMethods = [];
    for (const [method, keywords] of Object.entries(METHOD_KEYWORDS)) {
      if (currentMethods.includes(method)) continue;

      const matches = keywords.filter(keyword => text.includes(keyword.toLowerCase()));
      if (matches.length > 0) {
        suggestedMethods.push({
          method,
          confidence: Math.min(0.95, matches.length * 0.4),
          reason: `Found methodology indicators: ${matches.join(', ')}`
        });
      }
    }

    if (suggestedMethods.length > 0) {
      suggestions.push({
        suggestion_type: 'methods',
        suggestion_data: {
          add: suggestedMethods.slice(0, 5).map(m => m.method),
          confidence_scores: suggestedMethods.slice(0, 5).reduce((acc, m) => {
            acc[m.method] = m.confidence;
            return acc;
          }, {}),
          reasoning: suggestedMethods.slice(0, 5).map(m => m.reason)
        },
        source: 'ai_keyword_analysis'
      });
    }

    return suggestions;
  } catch (error) {
    console.error('Error generating preview suggestions:', error);
    return [];
  }
};

module.exports = {
  generateAISuggestions,
  saveAISuggestions,
  generatePreviewSuggestions
};