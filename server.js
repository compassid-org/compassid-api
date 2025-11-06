import dotenv from 'dotenv';
// Load environment variables FIRST, before any other imports
dotenv.config();

// Validate environment variables before starting
import { validateEnvironment } from './src/middleware/environmentValidator.js';
validateEnvironment();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import papersRouter from './routes/papers.js';
import aiRouter from './routes/ai.js';
import stripeRouter from './routes/stripe.js';
import followingRouter from './src/routes/following.js';
import messagesRouter from './src/routes/messages.js';
import notificationsRouter from './src/routes/notifications.js';
import interestsRouter from './src/routes/interests.js';
import analyticsRouter from './src/routes/analytics.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticateToken } = require('./src/middleware/auth.cjs');
const { searchUsers } = require('./src/controllers/researchersController.cjs');
const researchRouter = require('./src/routes/research.js');
import { apiLimiter, authLimiter, paymentLimiter } from './src/middleware/rateLimiter.js';
import {
  validateRegistration,
  validateLogin,
  validateGroupCreation,
  validateFeaturedOpportunity
} from './src/middleware/inputValidator.js';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection - supports both local (individual vars) and production (DATABASE_URL)
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
      }
);

// Security middleware - Helmet for HTTP headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now, enable in production
  crossOriginEmbedderPolicy: false
}));

// Middleware - Handle multiple CORS origins
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) in development
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(cookieParser()); // Parse cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    database: 'mock-mode',
    message: 'Using mock data until PostgreSQL is configured',
    timestamp: new Date().toISOString()
  });
});

// Auth Routes
app.post('/api/auth/login', authLimiter, validateLogin, async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check for admin login (development mode)
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_PASSWORD &&
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const adminToken = jwt.sign(
        { userId: 'admin-user-001', email: process.env.ADMIN_EMAIL, role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.cookie('token', adminToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });

      return res.json({
        message: 'Login successful',
        user: {
          id: 'admin-user-001',
          email: process.env.ADMIN_EMAIL,
          first_name: 'Admin',
          last_name: 'User',
          institution: 'COMPASS ID',
          compass_id: 'ADMIN-2024-001',
          orcid_id: '0000-0001-2345-6789',
          role: 'admin',
          subscription: 'premium',
          subscription_status: 'active'
        }
      });
    }

    // Regular user login
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        institution: user.institution,
        compass_id: user.compass_id,
        orcid_id: user.orcid_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, first_name, last_name, institution } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, institution, compass_id)
       VALUES ($1, $2, $3, $4, $5, generate_compass_id())
       RETURNING id, email, first_name, last_name, institution, compass_id, created_at`,
      [email, passwordHash, first_name, last_name, institution]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        institution: user.institution,
        compass_id: user.compass_id
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });

  res.json({ message: 'Logged out successfully' });
});

// Profile endpoint with subscription data
app.get('/api/auth/profile', async (req, res) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let userEmail = decoded.email;
    let userData = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    // Try to get full user data from database
    try {
      const result = await pool.query(
        'SELECT id, email, first_name, last_name, institution, compass_id, orcid_id, stripe_customer_id FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        userData = { ...userData, ...user };
        userEmail = user.email;
      }
    } catch (dbError) {
      console.error('Database query error:', dbError.message);
    }

    // Always check Stripe for subscriptions using email
    let subscriptions = [];
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      // Find customer by email
      const customers = await stripe.customers.list({
        email: userEmail,
        limit: 1
      });

      if (customers.data.length > 0) {
        const customer = customers.data[0];

        // Get active subscriptions for this customer
        const stripeSubs = await stripe.subscriptions.list({
          customer: customer.id,
          status: 'all',
          limit: 10
        });

        subscriptions = stripeSubs.data
          .filter(sub => sub.status === 'active' || sub.status === 'trialing')
          .map(sub => {
            const planType = sub.metadata?.planType || 'premium';

            // Safely parse timestamps
            let periodStart = null;
            let periodEnd = null;
            try {
              if (sub.current_period_start) {
                periodStart = new Date(sub.current_period_start * 1000).toISOString();
              }
              if (sub.current_period_end) {
                periodEnd = new Date(sub.current_period_end * 1000).toISOString();
              }
            } catch (dateError) {
              console.error('Date parsing error:', dateError);
            }

            return {
              id: sub.id,
              type: planType,
              tier: planType,
              status: sub.status,
              price: (sub.items.data[0].price.unit_amount / 100),
              billing_period: sub.items.data[0].price.recurring.interval,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              cancel_at_period_end: sub.cancel_at_period_end || false,
              features: {
                analytics_access: planType !== 'researcher',
                grant_writing_words: planType === 'grant_writing' ? 50000 : 0,
                api_access: planType !== 'researcher',
                priority_support: planType === 'grant_writing'
              }
            };
          });

        // Save customer ID back to database if we have it
        if (userData.id && customers.data[0].id) {
          try {
            await pool.query(
              'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
              [customers.data[0].id, userData.id]
            );
          } catch (updateError) {
            console.log('Could not update stripe_customer_id:', updateError.message);
          }
        }
      }
    } catch (stripeError) {
      console.error('Error fetching Stripe subscriptions:', stripeError.message);
    }

    return res.json({
      user: {
        ...userData,
        subscriptions,
        subscription: subscriptions.length > 0 ? subscriptions[0].type : null,
        subscription_status: subscriptions.length > 0 ? subscriptions[0].status : null,
        stripe_customer_id: undefined // Don't expose to frontend
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Update profile endpoint
app.put('/api/auth/profile', async (req, res) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const {
      first_name,
      last_name,
      institution,
      orcid_id,
      bio,
      position,
      department,
      location,
      website,
      google_scholar_url,
      research_interests,
      avatar_url,
      employment,
      education
    } = req.body;

    // Update user profile
    const result = await pool.query(
      `UPDATE users
       SET first_name = $1,
           last_name = $2,
           institution = $3,
           orcid_id = $4,
           bio = $5,
           position = $6,
           department = $7,
           location = $8,
           website = $9,
           google_scholar_url = $10,
           research_interests = $11,
           avatar_url = $12,
           employment = $13,
           education = $14,
           updated_at = NOW()
       WHERE id = $15
       RETURNING id, email, compass_id, first_name, last_name, institution, orcid_id,
                 bio, position, department, location, website, google_scholar_url,
                 research_interests, avatar_url, employment, education`,
      [
        first_name,
        last_name,
        institution,
        orcid_id,
        bio,
        position,
        department,
        location,
        website,
        google_scholar_url,
        research_interests,
        avatar_url,
        employment,
        education,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];

    return res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Query usage tracking endpoint
app.get('/api/usage/ai-queries', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userEmail = decoded.email;

    // Get user's subscription to determine limit
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let queriesLimit = 0;
    let resetDate = null;

    // Find customer and check subscriptions
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1
    });

    if (customers.data.length > 0) {
      const stripeSubs = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        status: 'active',
        limit: 10
      });

      if (stripeSubs.data.length > 0) {
        const sub = stripeSubs.data[0];
        const planType = sub.metadata?.planType || 'premium';

        // Set limits based on plan
        switch (planType) {
          case 'researcher':
            queriesLimit = 200;
            break;
          case 'premium':
            queriesLimit = 1000; // "Unlimited" with fair use cap
            break;
          case 'grant_writing':
            queriesLimit = 2000; // Higher "unlimited" cap
            break;
          default:
            queriesLimit = 200;
        }

        resetDate = new Date(sub.current_period_end * 1000).toISOString();
      }
    }

    // TODO: Get actual usage from database when ready
    // For now, return 0 as we're not tracking yet
    const queriesUsed = 0;

    res.json({
      queriesUsed,
      queriesLimit,
      resetDate,
      remainingQueries: Math.max(0, queriesLimit - queriesUsed)
    });
  } catch (error) {
    console.error('Usage tracking error:', error);
    res.status(500).json({ error: 'Failed to get usage data' });
  }
});

// API Routes
app.use('/api/papers', papersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/research', researchRouter);
app.use('/api', followingRouter); // includes /api/users/:id/follow
app.use('/api/messages', messagesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/interests', interestsRouter);
app.use('/api/analytics', analyticsRouter);

// Verification routes (stub for now)
app.get('/api/verification/queue', (req, res) => {
  res.json({
    items: [],
    total: 0,
    message: 'Verification endpoints coming soon'
  });
});

// Experts routes (stub for now)
app.get('/api/experts/me', (req, res) => {
  res.json({
    message: 'Expert endpoints coming soon'
  });
});

// Researchers Routes - Public profile lookup by compass_id or user_id
app.get('/api/researchers/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;

    // Determine if identifier is compass_id (format: XXXX-XXXX-...) or UUID
    const isCompassId = identifier.includes('-') && identifier.length < 36;

    // Get researcher basic info
    const userQuery = isCompassId
      ? 'SELECT id, email, first_name, last_name, institution, orcid_id, compass_id, bio, position, department, location, website, google_scholar_url, research_interests, avatar_url, employment, education, created_at FROM users WHERE compass_id = $1'
      : 'SELECT id, email, first_name, last_name, institution, orcid_id, compass_id, bio, position, department, location, website, google_scholar_url, research_interests, avatar_url, employment, education, created_at FROM users WHERE id = $1';

    const userResult = await pool.query(userQuery, [identifier]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Researcher not found' });
    }

    const researcher = userResult.rows[0];
    const userId = researcher.id;

    // Get research publications with metadata
    const researchQuery = await pool.query(`
      SELECT
        r.id, r.title, r.abstract, r.doi, r.publication_year, r.journal, r.created_at,
        c.framework_alignment, c.geo_scope_text as location, c.geo_scope_geom,
        c.taxon_scope, c.methods, c.temporal_start, c.temporal_end
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.user_id = $1
      ORDER BY r.publication_year DESC NULLS LAST, r.created_at DESC
    `, [userId]);

    // Get framework contribution stats (framework_alignment is JSONB array)
    const frameworksQuery = await pool.query(`
      SELECT
        jsonb_array_elements_text(c.framework_alignment) as framework,
        COUNT(*) as count
      FROM research_items r
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.user_id = $1 AND c.framework_alignment IS NOT NULL
      GROUP BY framework
      ORDER BY count DESC
    `, [userId]);

    // Get overall stats
    const statsQuery = await pool.query(`
      SELECT
        COUNT(DISTINCT r.id) as total_research,
        COUNT(DISTINCT CASE WHEN r.created_at > NOW() - INTERVAL '1 year' THEN r.id END) as recent_research
      FROM research_items r
      WHERE r.user_id = $1
    `, [userId]);

    // Process research data to extract coordinates from AI-generated geo_scope_geom
    const processedResearch = researchQuery.rows.map(item => {
      let coordinates = null;

      // Try to parse coordinates from geo_scope_geom (AI may store as "lat,lng" or GeoJSON)
      if (item.geo_scope_geom) {
        try {
          // Check if it's a simple "lat,lng" format
          const parts = item.geo_scope_geom.split(',');
          if (parts.length === 2) {
            const lat = parseFloat(parts[0].trim());
            const lng = parseFloat(parts[1].trim());
            if (!isNaN(lat) && !isNaN(lng)) {
              coordinates = { lat, lng };
            }
          } else {
            // Try parsing as JSON (could be GeoJSON from AI)
            const parsed = JSON.parse(item.geo_scope_geom);
            if (parsed.type === 'Point' && parsed.coordinates) {
              coordinates = { lng: parsed.coordinates[0], lat: parsed.coordinates[1] };
            }
          }
        } catch (e) {
          // Silently fail - coordinates optional
        }
      }

      return {
        ...item,
        coordinates,
        geo_scope_geom: undefined  // Don't send raw geom to frontend
      };
    });

    res.json({
      researcher: {
        ...researcher,
        email: undefined  // Don't expose email publicly
      },
      research: processedResearch,
      frameworks: frameworksQuery.rows,
      stats: statsQuery.rows[0] || { total_research: 0, recent_research: 0 }
    });
  } catch (error) {
    console.error('Error fetching researcher profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Find researchers with filters
app.get('/api/researchers/find', async (req, res) => {
  try {
    const { frameworks, geo_region, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT DISTINCT
        u.id, u.first_name, u.last_name, u.institution, u.orcid_id, u.compass_id,
        COUNT(DISTINCT r.id) as research_count,
        jsonb_agg(DISTINCT c.framework_alignment) as frameworks
      FROM users u
      JOIN research_items r ON u.id = r.user_id
      JOIN compass_metadata c ON r.id = c.research_id
      WHERE c.framework_alignment IS NOT NULL
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
      GROUP BY u.id, u.first_name, u.last_name, u.institution, u.orcid_id, u.compass_id
      ORDER BY research_count DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      researchers: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error finding researchers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User search
app.get('/api/users/search', authenticateToken, searchUsers);

// Groups API
// Get all groups
app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*,
              u.first_name, u.last_name, u.institution,
              COUNT(DISTINCT gm.user_id) as member_count
       FROM research_groups g
       LEFT JOIN users u ON g.creator_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.is_private = false OR g.creator_id = $1
       GROUP BY g.id, u.first_name, u.last_name, u.institution
       ORDER BY g.created_at DESC`,
      [req.cookies?.token ? jwt.verify(req.cookies.token, process.env.JWT_SECRET).userId : null]
    );

    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get single group
app.get('/api/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT g.*,
              u.first_name, u.last_name, u.institution,
              COUNT(DISTINCT gm.user_id) as member_count
       FROM research_groups g
       LEFT JOIN users u ON g.creator_id = u.id
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = $1
       GROUP BY g.id, u.first_name, u.last_name, u.institution`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ group: result.rows[0] });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Create group
app.post('/api/groups', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const { name, description, is_private } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    const result = await pool.query(
      `INSERT INTO research_groups (name, description, creator_id, is_private)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description, userId, is_private || false]
    );

    res.status(201).json({
      message: 'Group created successfully',
      group: result.rows[0]
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Featured Opportunities API
// Get all active featured opportunities
app.get('/api/featured-opportunities', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fo.*, u.first_name, u.last_name, u.institution
       FROM featured_opportunities fo
       LEFT JOIN users u ON fo.user_id = u.id
       WHERE fo.payment_status = 'completed'
         AND fo.start_date <= CURRENT_TIMESTAMP
         AND fo.end_date >= CURRENT_TIMESTAMP
       ORDER BY fo.created_at DESC`
    );

    res.json({ opportunities: result.rows });
  } catch (error) {
    console.error('Get featured opportunities error:', error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// Create featured opportunity with Stripe payment
app.post('/api/featured-opportunities', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const {
      type, title, organization, location, description,
      salary, amount, deadline, duration, cost, date_range,
      frameworks, remote, pricing_tier
    } = req.body;

    if (!type || !title || !organization || !description || !pricing_tier) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate dates based on pricing tier
    const start_date = new Date();
    const end_date = new Date();
    let price = 0;

    switch (pricing_tier) {
      case '30day':
        end_date.setDate(end_date.getDate() + 30);
        price = 9900; // $99 in cents
        break;
      case '60day':
        end_date.setDate(end_date.getDate() + 60);
        price = 14900; // $149 in cents
        break;
      case '90day':
        end_date.setDate(end_date.getDate() + 90);
        price = 19900; // $199 in cents
        break;
      default:
        return res.status(400).json({ error: 'Invalid pricing tier' });
    }

    // Create Stripe checkout session
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Featured ${type.charAt(0).toUpperCase() + type.slice(1)} - ${pricing_tier.replace('day', ' days')}`,
            description: title
          },
          unit_amount: price
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/featured?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/featured/submit?payment=cancelled`,
      metadata: {
        user_id: userId,
        type, title, organization, location, description,
        salary: salary || '',
        amount: amount || '',
        deadline: deadline || '',
        duration: duration || '',
        cost: cost || '',
        date_range: date_range || '',
        frameworks: JSON.stringify(frameworks || []),
        remote: remote ? 'true' : 'false',
        pricing_tier,
        start_date: start_date.toISOString(),
        end_date: end_date.toISOString()
      }
    });

    res.json({ sessionUrl: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Create featured opportunity error:', error);
    res.status(500).json({ error: 'Failed to create opportunity' });
  }
});

// Stripe webhook for featured opportunities
app.post('/api/webhook/featured-payment', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const metadata = session.metadata;

      // Save to database
      await pool.query(
        `INSERT INTO featured_opportunities (
          user_id, type, title, organization, location, description,
          salary, amount, deadline, duration, cost, date_range,
          frameworks, remote, pricing_tier, start_date, end_date,
          payment_status, stripe_payment_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          metadata.user_id, metadata.type, metadata.title, metadata.organization,
          metadata.location, metadata.description, metadata.salary, metadata.amount,
          metadata.deadline, metadata.duration, metadata.cost, metadata.date_range,
          JSON.parse(metadata.frameworks || '[]'), metadata.remote === 'true',
          metadata.pricing_tier, metadata.start_date, metadata.end_date,
          'completed', session.payment_intent
        ]
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   COMPASS ID Backend API                       ║
║   Human-First Expert Verification System       ║
╠════════════════════════════════════════════════╣
║   Status: RUNNING (Mock Mode)                  ║
║   Server: http://localhost:${PORT}               ║
║   Health: http://localhost:${PORT}/health        ║
║   Papers: http://localhost:${PORT}/api/papers    ║
╠════════════════════════════════════════════════╣
║   ⚠️  Using mock data                           ║
║   Configure PostgreSQL to use real database    ║
╚════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
