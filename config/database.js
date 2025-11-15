// Centralized Database Pool Configuration
// USE THIS INSTEAD OF CREATING SEPARATE POOLS!
const pg = require('pg');
const { Pool } = pg;
require('dotenv').config();

// Validate required environment variables
if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('ERROR: Database credentials not found in environment variables.');
  console.error('Please set DB_USER and DB_PASSWORD in .env file');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'compassid',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
