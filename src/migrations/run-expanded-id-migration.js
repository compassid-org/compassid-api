const fs = require('fs');
const path = require('path');
const pool = require('../../config/database.js');

async function runExpandedIdMigration() {
  const client = await pool.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '009_expanded_compass_id_words.sql'),
      'utf8'
    );

    console.log('Running Expanded COMPASS ID migration...');
    console.log('');
    console.log('Word Lists:');
    console.log('  Ecosystems: 60 words');
    console.log('  Species: 100 words');
    console.log('  Elements: 80 words');
    console.log('  Numbers: 10,000 variations');
    console.log('');
    console.log('Total Combinations: 60 × 100 × 80 × 10,000 = 48,000,000,000');
    console.log('That\'s 48 BILLION unique IDs!');
    console.log('');

    await client.query(sql);

    console.log('✓ Expanded COMPASS ID migration completed successfully!');
    console.log('');
    console.log('Example IDs with expanded variety:');
    console.log('  • glacier-penguin-aurora-2847');
    console.log('  • rainforest-jaguar-cascade-6193');
    console.log('  • mangrove-manatee-twilight-4521');
    console.log('  • tundra-caribou-blizzard-8906');
    console.log('  • savanna-elephant-sunset-1274');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runExpandedIdMigration();
