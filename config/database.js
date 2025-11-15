// Centralized Database Pool Configuration
// USE THIS INSTEAD OF CREATING SEPARATE POOLS!
const pg = require('pg');
const { Pool } = pg;
require('dotenv').config();

// Support both DB_* (custom) and PG* (Railway standard) environment variables
const dbUser = process.env.DB_USER || process.env.PGUSER;
const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
const dbHost = process.env.DB_HOST || process.env.PGHOST || 'localhost';
const dbPort = process.env.DB_PORT || process.env.PGPORT || 5432;
const dbName = process.env.DB_NAME || process.env.PGDATABASE || 'compassid';

// Validate required environment variables
if (!dbUser || !dbPassword) {
  console.error('ERROR: Database credentials not found in environment variables.');
  console.error('Please set DB_USER/PGUSER and DB_PASSWORD/PGPASSWORD in environment');
  process.exit(1);
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPassword,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log connection events
pool.on('connect', () => {
  console.log('✅ Database pool connected');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
  process.exit(-1);
});

module.exports = pool;
