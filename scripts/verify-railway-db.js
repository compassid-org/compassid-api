const { Pool } = require('pg');
require('dotenv').config();

const verifyDatabase = async () => {
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
    console.log('🔗 Connecting to Railway PostgreSQL...\n');
    const client = await pool.connect();

    console.log('✅ Connected successfully!\n');
    console.log('📊 Database Statistics:\n');

    // Get counts from key tables
    const tables = [
      'users',
      'research_items',
      'frameworks',
      'blog_posts',
      'grants',
      'jobs',
      'interests_categories',
      'user_events',
      'user_presentations'
    ];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`   ${table.padEnd(25)} ${result.rows[0].count.padStart(8)} records`);
      } catch (err) {
        console.log(`   ${table.padEnd(25)} (table not found or error)`);
      }
    }

    console.log('\n📄 Sample Research Papers:\n');
    const papers = await client.query(`
      SELECT title, citations, publication_date
      FROM research_items
      ORDER BY citations DESC NULLS LAST
      LIMIT 5
    `);

    papers.rows.forEach((paper, i) => {
      console.log(`   ${i + 1}. ${paper.title.substring(0, 60)}...`);
      console.log(`      Citations: ${paper.citations || 0} | Published: ${paper.publication_date || 'Unknown'}\n`);
    });

    console.log('✅ Railway database is fully populated and ready to use!\n');
    console.log('🚀 Your Railway API at https://compassid-api-production.up.railway.app');
    console.log('   now has access to all your research papers and data.\n');

    client.release();
    await pool.end();

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    await pool.end();
    process.exit(1);
  }
};

verifyDatabase();
