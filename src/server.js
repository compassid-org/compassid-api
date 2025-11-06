require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const logger = require('./config/logger.cjs');

const authRoutes = require('./routes/auth');
const researchRoutes = require('./routes/research');
const researcherRoutes = require('./routes/researchers');
const statsRoutes = require('./routes/stats');
const frameworksRoutes = require('./routes/frameworks');
const blogRoutes = require('./routes/blog');
const feedRoutes = require('./routes/feed');
const grantsRoutes = require('./routes/grants');
const jobsRoutes = require('./routes/jobs');
const aiRoutes = require('./routes/ai');
const interestsRoutes = require('./routes/interests');
const sitemapRoutes = require('./routes/sitemap');
const papersRoutes = require('./routes/papers.cjs');
const eventsRoutes = require('./routes/events');
const { injectMetaTags } = require('./middleware/seo');
// const aiGrantWritingRoutes = require('./routes/aiGrantWriting');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting with different limits for different endpoints
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit auth attempts per IP
  message: { error: 'Too many authentication attempts, please try again later.' },
  skipSuccessfulRequests: true,
});

// Strict rate limiter for expensive AI operations
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Maximum 20 AI requests per hour per IP
  message: { error: 'Too many AI requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration - restrict to specific origins
const allowedOrigins = process.env.CORS_ORIGINS ?
  process.env.CORS_ORIGINS.split(',') :
  ['http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Reject requests with no origin (null) for security
    // Only allow requests from whitelisted origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(cookieParser());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting
app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/papers', papersRoutes);
app.use('/api/researchers', researcherRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/frameworks', frameworksRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/grants', grantsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/interests', interestsRoutes);
app.use('/api/events', eventsRoutes);
// app.use('/api/ai-writing', aiGrantWritingRoutes);

// SEO routes (no /api prefix for better SEO)
app.use('/', sitemapRoutes);

// Serve static files from frontend build (in production)
const frontendDistPath = path.join(__dirname, '../../compassid-frontend/dist');
app.use(express.static(frontendDistPath));

// SEO middleware: Inject meta tags for research papers and profiles
// This MUST come before the catch-all SPA route
app.get(['/research/:slug', '/profile/:compassId'], injectMetaTags);

// SPA fallback: Serve index.html for all other routes (client-side routing)
// This handles all routes not matched by API endpoints or SEO routes
app.get('*', (req, res) => {
  // Don't serve index.html for API routes (they should 404 if not found)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  const indexPath = path.join(frontendDistPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error('Error serving index.html:', err);
      res.status(500).send('Frontend build not found. Please run build first.');
    }
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Compass ID API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});