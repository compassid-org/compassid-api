const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

// Import Claude service (check both old and new locations)
let generateResearchSuggestions, extractComprehensiveMetadata;
try {
  // Try new location first
  const claudeService = require('../services/claudeService');
  generateResearchSuggestions = claudeService.generateResearchSuggestions;
  extractComprehensiveMetadata = claudeService.extractComprehensiveMetadata;
} catch (err) {
  // Fall back to old location
  try {
    const claudeService = require('../../services/claudeService');
    generateResearchSuggestions = claudeService.generateResearchSuggestions;
    extractComprehensiveMetadata = claudeService.extractComprehensiveMetadata;
  } catch (err2) {
    console.warn('Claude service not found. AI suggestions will be disabled.');
  }
}

// Import research intelligence for CrossRef
let fetchFromCrossRef;
try {
  const researchIntelligence = require('../services/researchIntelligence');
  fetchFromCrossRef = researchIntelligence.fetchFromCrossRef;
} catch (err) {
  console.warn('Research intelligence service not found. CrossRef search will be disabled.');
}

/**
 * POST /api/ai/suggestions
 * Generate comprehensive metadata for research papers (location + all tags)
 * This endpoint replaces the old simple suggestions with comprehensive extraction
 */
router.post('/suggestions', async (req, res) => {
  try {
    const { title, abstract, existingTags } = req.body;

    // Check if Claude service is available
    if (!extractComprehensiveMetadata) {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable',
        message: 'Claude API key not configured or service not available'
      });
    }

    // Validate required fields
    if (!title || !abstract) {
      return res.status(400).json({
        success: false,
        error: 'Title and abstract are required'
      });
    }

    // Generate comprehensive metadata using Claude
    const result = await extractComprehensiveMetadata({
      title,
      abstract
    });

    res.json(result);
  } catch (error) {
    console.error('AI Comprehensive Metadata Extraction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate comprehensive metadata',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/extract-location
 * Extract geographic location from paper title and abstract using AI
 */
router.post('/extract-location', async (req, res) => {
  try {
    const { title, abstract } = req.body;

    // Check if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'AI service not configured',
        message: 'Anthropic API key not set'
      });
    }

    // Validate required fields
    if (!title || !abstract) {
      return res.status(400).json({
        success: false,
        error: 'Title and abstract are required'
      });
    }

    // Use Claude to extract location
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system: 'You are an expert at extracting geographic locations from scientific research papers. Extract the primary study location and provide coordinates.',
      messages: [
        {
          role: 'user',
          content: `Extract the primary geographic location from this research paper. Return ONLY a JSON object with this exact structure:
{
  "location": "Location name (e.g., 'Great Barrier Reef, Australia')",
  "coordinates": [latitude, longitude],
  "confidence": 0.0-1.0
}

If no specific location is found, return {"location": null, "coordinates": null, "confidence": 0}.

Paper:
Title: ${title}
Abstract: ${abstract}`
        }
      ]
    });

    // Parse response
    let responseText = message.content[0].text.trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const locationData = JSON.parse(responseText);

    res.json({
      success: true,
      ...locationData
    });
  } catch (error) {
    console.error('Location Extraction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract location',
      message: error.message
    });
  }
});

/**
 * GET /api/ai/crossref/search
 * Search for papers from CrossRef database
 */
router.get('/crossref/search', async (req, res) => {
  try {
    // Check if CrossRef service is available
    if (!fetchFromCrossRef) {
      return res.status(503).json({
        success: false,
        error: 'CrossRef service not available',
        message: 'Research intelligence service not loaded'
      });
    }

    const { query, fromDate, toDate, limit = 50 } = req.query;

    // Set default date range (last 5 years to now)
    const defaultFromDate = new Date();
    defaultFromDate.setFullYear(defaultFromDate.getFullYear() - 5);

    const searchParams = {
      fromDate: fromDate ? new Date(fromDate) : defaultFromDate,
      toDate: toDate ? new Date(toDate) : new Date(),
      limit: parseInt(limit) || 50
    };

    // Call CrossRef API
    const papers = await fetchFromCrossRef(searchParams);

    // Filter by query if provided
    let results = papers;
    if (query && query.trim()) {
      const searchTerm = query.toLowerCase();
      results = papers.filter(paper =>
        paper.title.toLowerCase().includes(searchTerm) ||
        paper.abstract.toLowerCase().includes(searchTerm)
      );
    }

    res.json({
      success: true,
      results: results,
      count: results.length,
      query: query || null,
      dateRange: {
        from: searchParams.fromDate.toISOString().split('T')[0],
        to: searchParams.toDate.toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('CrossRef Search Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search CrossRef',
      message: error.message
    });
  }
});

/**
 * POST /api/ai/search-assistant
 * Conversational AI search assistant for natural language queries
 * with dynamic map control capabilities
 */
router.post('/search-assistant', async (req, res) => {
  try {
    const { message, conversationHistory = [], currentPapers = [] } = req.body;

    // Check if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'AI service not configured',
        message: 'Anthropic API key not set'
      });
    }

    // Validate required fields
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // Use Claude to parse the query and generate filters
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Build context about current papers if provided
    let contextInfo = '';
    if (currentPapers && currentPapers.length > 0) {
      contextInfo = `\n\nCURRENT PAPERS DISPLAYED (${currentPapers.length} papers):\n`;
      currentPapers.slice(0, 20).forEach((paper, idx) => {
        contextInfo += `${idx + 1}. "${paper.title}" by ${paper.authors} (${paper.year || 'unknown year'})`;
        if (paper.location) contextInfo += ` - Location: ${paper.location}`;
        if (paper.ecosystems && paper.ecosystems.length > 0) contextInfo += ` - Ecosystems: ${paper.ecosystems.join(', ')}`;
        if (paper.methods && paper.methods.length > 0) contextInfo += ` - Methods: ${paper.methods.slice(0, 3).join(', ')}`;
        if (paper.taxonomic_coverage && paper.taxonomic_coverage.length > 0) contextInfo += ` - Taxa: ${paper.taxonomic_coverage.join(', ')}`;
        contextInfo += '\n';
      });
      if (currentPapers.length > 20) {
        contextInfo += `... and ${currentPapers.length - 20} more papers\n`;
      }
    } else {
      contextInfo = '\n\nNOTE: No papers are currently displayed. User needs to perform a search first.\n';
    }

    const systemPrompt = `You are an AI search assistant for COMPASSID, a conservation research database.

Your role is to help users find research papers by:
1. Parsing their natural language queries
2. Extracting relevant search parameters (locations, species, dates, ecosystems, methods)
3. Controlling what's displayed on an interactive map
4. Providing helpful, conversational responses
5. Answering questions about the currently displayed papers${contextInfo}

Response Format:
Return ONLY a valid JSON object (no markdown, no code blocks) with this structure:
{
  "message": "conversational response to the user",
  "filters": {
    "locations": ["array of location names"],
    "species": ["array of species names"],
    "ecosystems": ["array of ecosystem types"],
    "methods": ["array of research methods"],
    "dateRange": {
      "min": year or null,
      "max": year or null
    },
    "keywords": ["array of keywords to search"]
  },
  "applyToMap": boolean (true if filters should be applied immediately),
  "selectPapers": {
    "action": "select_matching|deselect_all|select_all",
    "criteria": {
      "location": "location name to match",
      "ecosystems": ["array of ecosystem types to match"],
      "species": ["array of species to match"]
    }
  },
  "actions": [
    {
      "label": "Action button label",
      "icon": "map|filter|clock",
      "filters": { /* same structure as above */ }
    }
  ]
}

Examples:

User: "Find elephant papers in Malawi after 2020"
Response:
{
  "message": "I'll search for elephant research in Malawi published after 2020. The map will show papers from this region.",
  "filters": {
    "locations": ["Malawi"],
    "species": ["elephants"],
    "ecosystems": [],
    "methods": [],
    "dateRange": {
      "min": 2020,
      "max": null
    },
    "keywords": ["elephant", "malawi"]
  },
  "applyToMap": true,
  "actions": []
}

User: "show me cambodian and malawian elephant papers after 2020"
Response:
{
  "message": "I'll show elephant research from both Cambodia and Malawi after 2020 on the map.",
  "filters": {
    "locations": ["Cambodia", "Malawi"],
    "species": ["elephants"],
    "ecosystems": [],
    "methods": [],
    "dateRange": {
      "min": 2020,
      "max": null
    },
    "keywords": ["elephant"]
  },
  "applyToMap": true,
  "actions": []
}

User: "help me find marine conservation papers"
Response:
{
  "message": "I can help you find marine conservation research. Would you like to narrow down by location or time period?",
  "filters": {
    "locations": [],
    "species": [],
    "ecosystems": ["marine", "ocean", "coastal"],
    "methods": [],
    "dateRange": {
      "min": null,
      "max": null
    },
    "keywords": ["marine", "conservation"]
  },
  "applyToMap": true,
  "actions": [
    {
      "label": "Recent marine papers (last 5 years)",
      "icon": "clock",
      "filters": {
        "locations": [],
        "species": [],
        "ecosystems": ["marine", "ocean", "coastal"],
        "methods": [],
        "dateRange": {
          "min": 2019,
          "max": null
        },
        "keywords": ["marine", "conservation"]
      }
    }
  ]
}

User: "can you only show the papers in malawi on the map, deselect the others"
Response:
{
  "message": "I'll show only the Malawi papers on the map and deselect the others.",
  "filters": {},
  "applyToMap": false,
  "selectPapers": {
    "action": "select_matching",
    "criteria": {
      "location": "Malawi",
      "ecosystems": [],
      "species": []
    }
  },
  "actions": []
}

User: "clear the map"
Response:
{
  "message": "I've cleared all papers from the map.",
  "filters": {},
  "applyToMap": false,
  "selectPapers": {
    "action": "deselect_all",
    "criteria": {}
  },
  "actions": []
}

Important:
- Always be helpful and conversational
- Extract specific locations, species, and dates when mentioned
- Set applyToMap to true when the user wants to see results immediately
- Use selectPapers when user wants to control which papers are shown on the map (e.g., "show only X", "deselect Y", "clear map")
- Provide action buttons for common follow-up queries
- Return ONLY valid JSON, no markdown formatting`;

    // Build conversation messages
    const messages = conversationHistory
      .slice(-10) // Keep last 10 messages for context
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));

    messages.push({
      role: 'user',
      content: message
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: systemPrompt,
      messages: messages
    });

    // Parse AI response
    let responseText = response.content[0].text.trim();

    // Remove markdown code blocks if present
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (responseText.startsWith('```')) {
      responseText = responseText.replace(/```\n?/g, '');
    }

    const aiResponse = JSON.parse(responseText);

    res.json({
      success: true,
      ...aiResponse
    });
  } catch (error) {
    console.error('AI Search Assistant Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process search query',
      message: error.message
    });
  }
});

/**
 * GET /api/ai/status
 * Check AI service status
 */
router.get('/status', (req, res) => {
  const isConfigured = !!process.env.ANTHROPIC_API_KEY && !!extractComprehensiveMetadata;

  res.json({
    success: true,
    configured: isConfigured,
    models: {
      searchAssistant: 'claude-sonnet-4-5-20250929',
      locationExtraction: 'claude-3-5-haiku-20241022',
      comprehensiveMetadata: 'claude-3-5-haiku-20241022'
    },
    features: {
      comprehensiveMetadata: !!extractComprehensiveMetadata,
      researchSuggestions: !!generateResearchSuggestions,
      locationExtraction: !!process.env.ANTHROPIC_API_KEY,
      crossRefSearch: !!fetchFromCrossRef,
      searchAssistant: !!process.env.ANTHROPIC_API_KEY
    }
  });
});

module.exports = router;
