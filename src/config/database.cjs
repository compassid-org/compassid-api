const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'compassid',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  // Log error but don't crash the entire application
  // The pool will attempt to reconnect automatically
  if (err.code === 'ECONNREFUSED') {
    console.error('Database connection refused. Please check that PostgreSQL is running.');
  }
});

module.exports = pool;