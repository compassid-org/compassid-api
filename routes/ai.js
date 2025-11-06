import express from 'express';
import { generateText, generateResearchSuggestions, generateResearchChat, generateFilterSuggestions, extractLocation, generateSearchAssistantResponse } from '../services/claudeService.js';

const router = express.Router();

/**
 * POST /api/ai/generate
 * Generate AI text for grant writing
 */
router.post('/generate', async (req, res) => {
  try {
    const { prompt, context, section, maxTokens } = req.body;

    // Validate required fields
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      });
    }

    // Generate text using Claude
    const result = await generateText({
      prompt,
      context,
      section,
      maxTokens: maxTokens || 1024,
    });

    res.json(result);
  } catch (error) {
    console.error('AI Generate Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate text',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/suggestions
 * Generate framework and tag suggestions for research papers
 */
router.post('/suggestions', async (req, res) => {
  try {
    const { title, abstract, existingTags } = req.body;

    // Validate required fields
    if (!title || !abstract) {
      return res.status(400).json({
        success: false,
        error: 'Title and abstract are required',
      });
    }

    // Generate suggestions using Claude
    const result = await generateResearchSuggestions({
      title,
      abstract,
      existingTags: existingTags || [],
    });

    res.json(result);
  } catch (error) {
    console.error('AI Suggestions Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/chat
 * Generate research chat response with context
 */
router.post('/chat', async (req, res) => {
  try {
    const { question, papers, frameworks, geography, taxonomy, conversationHistory } = req.body;

    // Validate required fields
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Question is required',
      });
    }

    // Generate chat response using Claude
    const result = await generateResearchChat({
      question,
      papers: papers || [],
      frameworks: frameworks || [],
      geography: geography || [],
      taxonomy: taxonomy || [],
      conversationHistory: conversationHistory || [],
    });

    res.json(result);
  } catch (error) {
    console.error('AI Chat Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate chat response',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/filter-suggestions
 * Generate filter suggestions from search query
 */
router.post('/filter-suggestions', async (req, res) => {
  try {
    const { query } = req.body;

    // Validate required fields
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required',
      });
    }

    // Generate filter suggestions using Claude
    const result = await generateFilterSuggestions({ query });

    res.json(result);
  } catch (error) {
    console.error('AI Filter Suggestions Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate filter suggestions',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/extract-location
 * Extract geographic location from paper title and abstract
 */
router.post('/extract-location', async (req, res) => {
  try {
    const { title, abstract } = req.body;

    // Validate required fields
    if (!title || !abstract) {
      return res.status(400).json({
        success: false,
        error: 'Title and abstract are required',
      });
    }

    // Extract location using Claude
    const result = await extractLocation({ title, abstract });

    res.json(result);
  } catch (error) {
    console.error('AI Location Extraction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract location',
      message: error.message,
    });
  }
});

/**
 * POST /api/ai/search-assistant
 * Conversational search assistant for paper discovery and analysis
 */
router.post('/search-assistant', async (req, res) => {
  try {
    const { message, conversationHistory, currentPapers } = req.body;

    // Validate required fields
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    // Generate assistant response using Claude
    const result = await generateSearchAssistantResponse({
      message,
      conversationHistory: conversationHistory || [],
      currentPapers: currentPapers || [],
    });

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Search Assistant Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate assistant response',
      message: error.message,
    });
  }
});

/**
 * GET /api/ai/status
 * Check AI service status
 */
router.get('/status', (req, res) => {
  const isConfigured = !!process.env.ANTHROPIC_API_KEY;

  res.json({
    success: true,
    configured: isConfigured,
    model: 'claude-3-5-haiku-20241022',
    features: {
      grantWriting: isConfigured,
      researchSuggestions: isConfigured,
      researchChat: isConfigured,
      filterSuggestions: isConfigured,
      locationExtraction: isConfigured,
      searchAssistant: isConfigured,
    },
  });
});

export default router;
