import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('🚀 Running user system migrations (paper claiming + metadata history)...\n');

    const migrations = [
      '023_paper_claiming_system.sql',
      '024_metadata_history_and_direct_editing.sql'
    ];

    for (const migration of migrations) {
      console.log(`📄 Running ${migration}...`);
      const sql = fs.readFileSync(path.join(__dirname, migration), 'utf8');
      await client.query(sql);
      console.log(`✅ ${migration} completed\n`);
    }

    console.log('🎉 All user system migrations completed successfully!');
    console.log('\n📊 New features enabled:');
    console.log('  ✓ Paper claiming system - researchers can claim papers as their own');
    console.log('  ✓ Metadata history tracking - full audit trail of changes');
    console.log('  ✓ Direct metadata editing - paper owners can edit without peer review');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
