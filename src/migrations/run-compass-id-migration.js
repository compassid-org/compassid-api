const fs = require('fs');
const path = require('path');
const pool = require('../config/database.js');

async function runCompassIdMigration() {
  const client = await pool.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '007_add_compass_id.sql'),
      'utf8'
    );

    console.log('Running COMPASS ID migration...');
    await client.query(sql);
    console.log('✓ COMPASS ID migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runCompassIdMigration();
