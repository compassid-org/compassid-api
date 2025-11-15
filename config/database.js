// Centralized Database Pool Configuration
// USE THIS INSTEAD OF CREATING SEPARATE POOLS!
const pg = require('pg');
const { Pool } = pg;
require('dotenv').config();

let pool;

// Option 1: Use DATABASE_URL if available (Railway/Heroku standard)
if (process.env.DATABASE_URL) {
  console.log('Using DATABASE_URL for database connection');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
} else {
  // Option 2: Use individual environment variables (local development)
  const dbUser = process.env.DB_USER || process.env.PGUSER;
  const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const dbHost = process.env.DB_HOST || process.env.PGHOST || 'localhost';
  const dbPort = process.env.DB_PORT || process.env.PGPORT || 5432;
  const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'compassid';

  // Validate required environment variables
  if (!dbUser || !dbPassword) {
    console.error('ERROR: Database credentials not found in environment variables.');
    console.error('Please set DATABASE_URL or DB_USER/PGUSER and DB_PASSWORD/PGPASSWORD');
    process.exit(1);
  }

  console.log(`Using individual env vars for database connection (host: ${dbHost})`);
  pool = new Pool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPassword,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

// Log connection events
pool.on('connect', () => {
  console.log('✅ Database pool connected');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
  process.exit(-1);
});

module.exports = pool;
