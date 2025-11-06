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
    console.log('🚀 Running new migrations...\n');

    const migrations = [
      '010_saved_papers_and_folders.sql',
      '011_user_following_system.sql',
      '012_messaging_system.sql',
      '013_notifications_system.sql',
      '014_extended_user_profile.sql'
    ];

    for (const migration of migrations) {
      console.log(`📄 Running ${migration}...`);
      const sql = fs.readFileSync(path.join(__dirname, migration), 'utf8');
      await client.query(sql);
      console.log(`✅ ${migration} completed\n`);
    }

    console.log('🎉 All migrations completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
