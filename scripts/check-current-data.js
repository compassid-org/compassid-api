import dotenv from 'dotenv';
dotenv.config();
import pool from '../config/database.js';

async function checkData() {
  try {
    // Check counts
    const countResult = await pool.query('SELECT COUNT(*) FROM compass_metadata');
    console.log(`\nTotal compass_metadata records: ${countResult.rows[0].count}`);

    // Check 3 most recent records
    const sampleResult = await pool.query(`
      SELECT
        research_id,
        taxon_scope,
        methods,
        framework_alignment
      FROM compass_metadata
      ORDER BY created_at DESC
      LIMIT 3
    `);

    console.log('\n3 most recent records:\n');
    for (let i = 0; i < sampleResult.rows.length; i++) {
      const row = sampleResult.rows[i];
      console.log(`Record ${i + 1}:`);
      console.log(`  research_id: ${row.research_id}`);
      console.log(`  taxon_scope type: ${typeof row.taxon_scope}`);
      console.log(`  taxon_scope value: ${JSON.stringify(row.taxon_scope).substring(0, 150)}`);
      console.log(`  methods type: ${typeof row.methods}`);
      console.log(`  methods value: ${JSON.stringify(row.methods).substring(0, 150)}`);
      console.log(`  framework type: ${typeof row.framework_alignment}`);
      console.log(`  framework value: ${JSON.stringify(row.framework_alignment).substring(0, 150)}\n`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkData();
