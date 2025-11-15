const pool = require('../config/database.js');

// Initialize OpenAI client only if API key is provided
let openai = null;
try {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    const OpenAI = require('openai');
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
} catch (error) {
  console.warn('OpenAI not available:', error.message);
}

// Get grant templates
const getTemplates = async (req, res, next) => {
  try {
    const { funder_type, grant_type } = req.query;

    let query = 'SELECT * FROM grant_templates WHERE 1=1';
    const params = [];

    if (funder_type) {
      query += ' AND funder_type = $' + (params.length + 1);
      params.push(funder_type);
    }

    if (grant_type) {
      query += ' AND grant_type = $' + (params.length + 1);
      params.push(grant_type);
    }

    query += ' ORDER BY name';

    const result = await pool.query(query, params);
    res.json({ templates: result.rows });
  } catch (error) {
    next(error);
  }
};

// Get user's grant applications
const getUserApplications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = `
      SELECT ga.*, gt.name as template_name, g.title as grant_title, g.application_deadline as grant_deadline
      FROM grant_applications ga
      LEFT JOIN grant_templates gt ON ga.template_id = gt.id
      LEFT JOIN grants g ON ga.grant_id = g.id
      WHERE ga.user_id = $1
    `;
    const params = [userId];

    if (status) {
      query += ' AND ga.status = $' + (params.length + 1);
      params.push(status);
    }

    query += ' ORDER BY ga.updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit));
    params.push((parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM grant_applications ga
      WHERE ga.user_id = $1 ${status ? 'AND ga.status = $2' : ''}
    `;
    const countParams = status ? [userId, status] : [userId];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      applications: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create new grant application
const createApplication = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { title, grant_id, template_id, content = {} } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Application title is required' });
    }

    const result = await pool.query(
      `INSERT INTO grant_applications (user_id, title, grant_id, template_id, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, grant_id || null, template_id || null, content]
    );

    res.status(201).json({ application: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Get single application
const getApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT ga.*, gt.name as template_name, gt.sections as template_sections,
              g.title as grant_title, g.application_deadline as grant_deadline
       FROM grant_applications ga
       LEFT JOIN grant_templates gt ON ga.template_id = gt.id
       LEFT JOIN grants g ON ga.grant_id = g.id
       WHERE ga.id = $1 AND ga.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ application: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Update application
const updateApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, content, status, submission_deadline } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(title);
    }

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      params.push(content);
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (submission_deadline !== undefined) {
      updates.push(`submission_deadline = $${paramIndex++}`);
      params.push(submission_deadline);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id, userId);

    const result = await pool.query(
      `UPDATE grant_applications SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ application: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Check user's AI usage and subscription
const checkAIUsage = async (userId) => {
  // Get user's current subscription
  const subResult = await pool.query(
    `SELECT us.*, sp.ai_words_monthly, sp.name as plan_name
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1 AND us.status = 'active'
     AND us.current_period_end >= CURRENT_DATE
     ORDER BY us.created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (subResult.rows.length === 0) {
    return { hasSubscription: false, wordsRemaining: 0 };
  }

  const subscription = subResult.rows[0];
  const wordsRemaining = subscription.ai_words_monthly - subscription.ai_words_used_current_period;

  return {
    hasSubscription: true,
    subscription,
    wordsRemaining,
    wordsUsed: subscription.ai_words_used_current_period,
    totalWords: subscription.ai_words_monthly
  };
};

// Generate content with AI
const generateContent = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { application_id, section, prompt, context = {} } = req.body;

    if (!application_id || !section || !prompt) {
      return res.status(400).json({ error: 'Application ID, section, and prompt are required' });
    }

    // Check AI usage limits
    const usage = await checkAIUsage(userId);
    if (!usage.hasSubscription || usage.wordsRemaining <= 0) {
      return res.status(403).json({
        error: 'AI usage limit exceeded or no active subscription',
        usage
      });
    }

    // Verify user owns the application
    const appResult = await pool.query(
      'SELECT * FROM grant_applications WHERE id = $1 AND user_id = $2',
      [application_id, userId]
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = appResult.rows[0];

    // Get user's research for context
    const researchResult = await pool.query(
      'SELECT title, abstract FROM research WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
      [userId]
    );

    // Build AI prompt with context
    const systemPrompt = `You are an expert grant writer helping researchers write compelling grant proposals.
You have deep knowledge of funding agencies, grant requirements, and successful proposal strategies.
Provide clear, professional, and persuasive content that follows grant writing best practices.
Focus on making the content specific, measurable, and aligned with the funder's priorities.`;

    const contextInfo = {
      application_title: application.title,
      section_name: section,
      user_research: researchResult.rows,
      ...context
    };

    const userPrompt = `Context: ${JSON.stringify(contextInfo, null, 2)}

Section: ${section}
Request: ${prompt}

Please generate content for this grant proposal section. Make it professional, specific, and compelling.`;

    const startTime = Date.now();

    if (!openai) {
      return res.status(503).json({
        error: 'AI writing service is currently unavailable. Please configure OpenAI API key.',
        message: 'Contact administrator to enable AI writing features.'
      });
    }

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.7
    });

    const generatedContent = completion.choices[0].message.content;
    const wordsGenerated = generatedContent.split(/\s+/).length;
    const processingTime = Date.now() - startTime;

    // Check if we're about to exceed word limit
    if (wordsGenerated > usage.wordsRemaining) {
      return res.status(403).json({
        error: 'Generated content would exceed your word limit',
        wordsNeeded: wordsGenerated,
        wordsRemaining: usage.wordsRemaining
      });
    }

    // Log the AI session
    await pool.query(
      `INSERT INTO ai_writing_sessions
       (user_id, application_id, session_type, prompt, response, words_generated, processing_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, application_id, 'generate', prompt, generatedContent, wordsGenerated, processingTime]
    );

    // Update subscription usage
    await pool.query(
      `UPDATE user_subscriptions
       SET ai_words_used_current_period = ai_words_used_current_period + $1
       WHERE user_id = $2 AND status = 'active'`,
      [wordsGenerated, userId]
    );

    // Log usage
    await pool.query(
      `INSERT INTO ai_usage_logs (user_id, words_used, action_type, application_id)
       VALUES ($1, $2, $3, $4)`,
      [userId, wordsGenerated, 'generate', application_id]
    );

    // Mark application as using AI assistance
    await pool.query(
      `UPDATE grant_applications
       SET ai_assistance_used = true, total_ai_words_generated = total_ai_words_generated + $1
       WHERE id = $2`,
      [wordsGenerated, application_id]
    );

    res.json({
      content: generatedContent,
      words_generated: wordsGenerated,
      words_remaining: usage.wordsRemaining - wordsGenerated
    });

  } catch (error) {
    next(error);
  }
};

// Get writing tips
const getWritingTips = async (req, res, next) => {
  try {
    const { category, difficulty_level, funder_type, grant_type } = req.query;

    let query = 'SELECT * FROM writing_tips WHERE active = true';
    const params = [];

    if (category) {
      query += ' AND category = $' + (params.length + 1);
      params.push(category);
    }

    if (difficulty_level) {
      query += ' AND difficulty_level = $' + (params.length + 1);
      params.push(difficulty_level);
    }

    if (funder_type) {
      query += ' AND (funder_types = \'[]\' OR funder_types @> $' + (params.length + 1) + ')';
      params.push(JSON.stringify([funder_type]));
    }

    if (grant_type) {
      query += ' AND (grant_types = \'[]\' OR grant_types @> $' + (params.length + 1) + ')';
      params.push(JSON.stringify([grant_type]));
    }

    query += ' ORDER BY category, title';

    const result = await pool.query(query, params);
    res.json({ tips: result.rows });
  } catch (error) {
    next(error);
  }
};

// Get subscription plans
const getSubscriptionPlans = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE active = true ORDER BY price_monthly_cents'
    );
    res.json({ plans: result.rows });
  } catch (error) {
    next(error);
  }
};

// Get user subscription status
const getSubscriptionStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const usage = await checkAIUsage(userId);
    res.json({ usage });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTemplates,
  getUserApplications,
  createApplication,
  getApplication,
  updateApplication,
  generateContent,
  getWritingTips,
  getSubscriptionPlans,
  getSubscriptionStatus
};