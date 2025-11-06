import dotenv from 'dotenv';
dotenv.config();
import pool from '../config/database.js';

async function fixDatabase() {
  console.log('🔧 FIXING DATABASE - Complete reset...\n');

  try {
    // Delete ALL data from both tables
    await pool.query('DELETE FROM compass_metadata');
    await pool.query('DELETE FROM research_items');

    console.log('✅ Database completely cleared\n');

    // Verify
    const check1 = await pool.query('SELECT COUNT(*) FROM research_items');
    const check2 = await pool.query('SELECT COUNT(*) FROM compass_metadata');

    console.log(`research_items: ${check1.rows[0].count}`);
    console.log(`compass_metadata: ${check2.rows[0].count}\n`);

    console.log('✅ Ready for fresh import!\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

fixDatabase();
