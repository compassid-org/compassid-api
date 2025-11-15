const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const importDatabase = async () => {
  // Connect to Railway PostgreSQL using environment variable
  const railwayConnectionString = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

  if (!railwayConnectionString) {
    console.error('❌ Error: RAILWAY_DATABASE_URL or DATABASE_URL environment variable not set');
    console.error('Please set it to your Railway PostgreSQL connection string');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: railwayConnectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to Railway PostgreSQL...');
    const client = await pool.connect();

    console.log('✅ Connected successfully!');
    console.log('📖 Reading SQL dump file...');

    const dumpFilePath = path.join(__dirname, '../compassid_dump.sql');
    const sqlContent = fs.readFileSync(dumpFilePath, 'utf8');

    console.log(`✅ Read ${(sqlContent.length / 1024 / 1024).toFixed(2)} MB of SQL data`);
    console.log('⚙️  Executing SQL import...');
    console.log('   This may take a few minutes for large databases...');

    const startTime = Date.now();

    // Execute the SQL dump
    await client.query(sqlContent);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ Import completed successfully in ${duration} seconds!`);
    console.log('🔍 Verifying database...');

    // Verify by checking some key tables
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    const paperCount = await client.query('SELECT COUNT(*) FROM research_items');

    console.log(`✅ Database verification:`);
    console.log(`   - Users: ${userCount.rows[0].count}`);
    console.log(`   - Research papers: ${paperCount.rows[0].count}`);

    client.release();
    await pool.end();

    console.log('\n🎉 Database import to Railway completed successfully!');
    console.log('🚀 Your Railway API should now have all the data from your local database.');

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error('Error details:', error);
    await pool.end();
    process.exit(1);
  }
};

importDatabase();
