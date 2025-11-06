const pool = require('./src/config/database.cjs');
const fs = require('fs');
const path = require('path');

async function backfillCompassIds() {
  try {
    console.log('🔄 Running COMPASS ID backfill migration...');

    const migrationPath = path.join(__dirname, 'src/migrations/015_backfill_compass_ids.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await pool.query(sql);

    console.log('✅ COMPASS ID backfill completed successfully!');

    // Verify the results
    const result = await pool.query('SELECT id, email, compass_id FROM users');
    console.log('\nCurrent users:');
    result.rows.forEach(user => {
      console.log(`  - ${user.email}: ${user.compass_id || 'NULL'}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error running backfill migration:', error);
    process.exit(1);
  }
}

backfillCompassIds();
