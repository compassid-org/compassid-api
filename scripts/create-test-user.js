import dotenv from 'dotenv';
dotenv.config();
import pool from '../config/database.js';
import bcrypt from 'bcryptjs';

async function createTestUser() {
  console.log('🧪 Creating test user account...\n');

  const testUser = {
    email: 'test@compassid.org',
    password: 'TestUser123!',
    first_name: 'Test',
    last_name: 'User',
    institution: 'COMPASS Research Institute'
  };

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT email FROM users WHERE email = $1',
      [testUser.email]
    );

    if (existingUser.rows.length > 0) {
      console.log('⚠️  Test user already exists. Deleting old user...\n');
      await pool.query('DELETE FROM users WHERE email = $1', [testUser.email]);
    }

    // Hash password (12 rounds like in authController)
    const passwordHash = await bcrypt.hash(testUser.password, 12);

    // Insert user with auto-generated COMPASS ID
    const result = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, institution, compass_id)
      VALUES ($1, $2, $3, $4, $5, generate_compass_id())
      RETURNING id, email, first_name, last_name, institution, compass_id, created_at
    `, [
      testUser.email,
      passwordHash,
      testUser.first_name,
      testUser.last_name,
      testUser.institution
    ]);

    const user = result.rows[0];

    console.log('✅ Test user created successfully!\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📧 Email:        ' + testUser.email);
    console.log('🔑 Password:     ' + testUser.password);
    console.log('🆔 COMPASS ID:   ' + user.compass_id);
    console.log('👤 Name:         ' + user.first_name + ' ' + user.last_name);
    console.log('🏢 Institution:  ' + user.institution);
    console.log('📅 Created:      ' + user.created_at);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n💡 Login at: http://localhost:3000/login\n');

  } catch (error) {
    console.error('❌ Error creating test user:', error);
  } finally {
    await pool.end();
  }
}

createTestUser();
