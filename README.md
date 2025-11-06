# COMPASS ID Backend API

Complete backend implementation for the human-first expert verification system.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# Create database
createdb compassid

# Run migrations
npm run migrate

# Start development server
npm run dev
```

## Project Structure

```
compassid-api/
├── server.js                 # Main Express server
├── package.json             # Dependencies
├── .env                     # Environment variables
├── config/
│   └── database.js          # PostgreSQL connection
├── models/
│   ├── Paper.js             # Paper model
│   ├── User.js              # User model
│   └── Verification.js      # Verification model
├── routes/
│   ├── papers.js            # Papers endpoints
│   ├── verification.js      # Verification endpoints
│   └── experts.js           # Experts endpoints
├── middleware/
│   ├── auth.js              # JWT authentication
│   └── errorHandler.js      # Error handling
├── services/
│   ├── ingestion/
│   │   ├── crossrefService.js
│   │   ├── openalexService.js
│   │   └── scheduler.js     # Cron jobs
│   └── verification/
│       └── consensus.js     # Verification logic
└── scripts/
    ├── migrate.js           # Database migrations
    ├── seed.js              # Seed data
    └── runIngestion.js      # Manual ingestion
```

## Environment Variables

Create `.env` file:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=compassid
DB_USER=your_username
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_super_secret_key_change_this_in_production
JWT_EXPIRES_IN=7d

# External APIs
PUBMED_API_KEY=your_ncbi_api_key
CROSSREF_EMAIL=contact@compassid.org
OPENALEX_EMAIL=contact@compassid.org

# CORS
CORS_ORIGIN=http://localhost:5173
```

## Database Setup

```bash
# Install PostgreSQL and PostGIS
brew install postgresql@15 postgis

# Start PostgreSQL
brew services start postgresql@15

# Create database
createdb compassid

# Run migration script
psql compassid < ../compassid-frontend/migrations/001_create_schema.sql
```

## API Endpoints

See full API documentation in [API.md](./API.md)

### Papers
- `GET /api/papers/search` - Search papers with filters
- `GET /api/papers/:id` - Get single paper
- `POST /api/papers/:id/claim` - Claim authorship
- `POST /api/papers/:id/frameworks` - Add framework tags
- `POST /api/papers/import/orcid` - Import by ORCID

### Verification
- `GET /api/verification/queue` - Get verification queue
- `POST /api/verification/queue/:id/review` - Submit review
- `GET /api/verification/leaderboard` - Get rankings

### Experts
- `GET /api/experts/me` - Get my profile
- `POST /api/experts/invite` - Send invitations
- `GET /api/experts` - Browse experts

## Background Jobs

Automatic ingestion runs daily at 2 AM UTC:

```javascript
// services/ingestion/scheduler.js
import cron from 'node-cron';

// Run daily at 2 AM UTC
cron.schedule('0 2 * * *', async () => {
  console.log('Running daily paper ingestion...');
  await runDailyIngestion(1); // Last 1 day
});

// Run weekly on Sundays at 3 AM UTC
cron.schedule('0 3 * * 0', async () => {
  console.log('Running weekly sync...');
  await runWeeklySync(1000); // 1000 papers per batch
});
```

## Development

```bash
# Start development server with auto-reload
npm run dev

# Run manual ingestion
npm run ingest

# Seed database with test data
npm run seed
```

## Production

```bash
# Install dependencies (production only)
npm install --production

# Run database migrations
npm run migrate

# Start server
npm start
```

## Testing

The frontend will automatically connect to this backend when it's running on port 3000. If the backend is not available, the frontend gracefully falls back to mock data.

## Next Steps

1. Implement server.js (main Express app)
2. Set up database connection (config/database.js)
3. Create Paper model (models/Paper.js)
4. Implement papers routes (routes/papers.js)
5. Add authentication middleware (middleware/auth.js)
6. Set up background jobs (services/ingestion/scheduler.js)

See implementation examples in the `examples/` directory.
