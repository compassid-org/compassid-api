import dotenv from 'dotenv';
dotenv.config();
import pool from '../config/database.js';

async function checkDatabaseCorruption() {
  console.log('Checking database for POINT corruption in JSONB fields...\n');

  try {
    // Check total count
    const countResult = await pool.query('SELECT COUNT(*) FROM compass_metadata');
    console.log(`Total compass_metadata records: ${countResult.rows[0].count}\n`);

    // Sample 10 recent records to check their field types
    const sampleResult = await pool.query(`
      SELECT
        research_id,
        taxon_scope,
        methods,
        framework_alignment,
        geo_scope_geom,
        geo_scope_text
      FROM compass_metadata
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('Sample of 10 most recent records:\n');

    for (let i = 0; i < sampleResult.rows.length; i++) {
      const row = sampleResult.rows[i];
      console.log(`Record ${i + 1}:`);
      console.log(`  research_id: ${row.research_id}`);
      console.log(`  taxon_scope type: ${typeof row.taxon_scope}, value: ${JSON.stringify(row.taxon_scope).substring(0, 100)}`);
      console.log(`  methods type: ${typeof row.methods}, value: ${JSON.stringify(row.methods).substring(0, 100)}`);
      console.log(`  framework_alignment type: ${typeof row.framework_alignment}, value: ${JSON.stringify(row.framework_alignment).substring(0, 100)}`);
      console.log(`  geo_scope_geom type: ${typeof row.geo_scope_geom}, value: ${row.geo_scope_geom ? row.geo_scope_geom.substring(0, 50) : 'null'}`);
      console.log(`  geo_scope_text: ${row.geo_scope_text}\n`);
    }

    // Test the weekly highlights query
    console.log('\n\nTesting weekly highlights query...\n');

    const weeklyQuery = `
      SELECT
        r.id,
        r.title,
        r.abstract,
        r.doi,
        r.publication_date,
        r.publication_year,
        r.journal,
        r.authors,
        r.citations,
        r.created_at,
        c.ecosystem_type,
        c.taxon_scope,
        c.methods,
        c.framework_alignment,
        c.geo_scope_text
      FROM research_items r
      LEFT JOIN compass_metadata c ON r.id = c.research_id
      WHERE r.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY r.created_at DESC
      LIMIT 5
    `;

    const weeklyResult = await pool.query(weeklyQuery);
    console.log(`Found ${weeklyResult.rows.length} papers from the last 7 days\n`);

    if (weeklyResult.rows.length > 0) {
      console.log('First paper details:');
      const paper = weeklyResult.rows[0];
      console.log(`  Title: ${paper.title}`);
      console.log(`  taxon_scope: ${JSON.stringify(paper.taxon_scope)}`);
      console.log(`  methods: ${JSON.stringify(paper.methods)}`);
      console.log(`  framework_alignment: ${JSON.stringify(paper.framework_alignment)}`);
    }

  } catch (error) {
    console.error('Error checking database:', error);
  } finally {
    await pool.end();
  }
}

checkDatabaseCorruption();
