const fs = require('fs');
const path = require('path');
const pool = require('../config/database.js');

async function runNatureIdMigration() {
  const client = await pool.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '008_nature_inspired_compass_id.sql'),
      'utf8'
    );

    console.log('Running Nature-Inspired COMPASS ID migration...');
    await client.query(sql);
    console.log('✓ Nature-Inspired COMPASS ID migration completed successfully!');
    console.log('Example IDs: ocean-turtle-wave-1234, forest-eagle-river-5678');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runNatureIdMigration();
