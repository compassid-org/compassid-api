const pool = require('../../config/database.js');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const migrationFiles = [
      '001_initial_schema.sql',
      '002_frameworks_data.sql'
    ];

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      await client.query(sql);
      console.log(`Completed: ${file}`);
    }

    await client.query('COMMIT');
    console.log('All migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(console.error);