const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database.cjs');
const logger = require('../config/logger.cjs');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

const register = async (req, res, next) => {
  const { email, password, first_name, last_name, institution } = req.body;

  try {
    // Use 12 rounds for better security (vs 10)
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate COMPASS ID and insert user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, institution, compass_id)
       VALUES ($1, $2, $3, $4, $5, generate_compass_id())
       RETURNING id, email, first_name, last_name, institution, compass_id, created_at`,
      [email, passwordHash, first_name, last_name, institution]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, COOKIE_OPTIONS);

    logger.info(`User registered successfully: ${user.email} (COMPASS ID: ${user.compass_id})`);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        institution: user.institution,
        compass_id: user.compass_id
      }
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    // Query user from database (works for both regular users and admin)
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT token with admin flag if user is admin
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        is_admin: user.is_admin || false
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, COOKIE_OPTIONS);

    logger.info(`User logged in successfully: ${user.email}${user.is_admin ? ' (admin)' : ''}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        institution: user.institution,
        compass_id: user.compass_id,
        orcid_id: user.orcid_id,
        subscription_tier: user.subscription, // map subscription column to subscription_tier for frontend
        subscription_status: user.subscription_status,
        is_admin: user.is_admin || false
      }
    });
  } catch (error) {
    next(error);
  }
};

const getProfile = async (req, res, next) => {
  try {
    // Query user profile from database (works for both regular users and admin)
    const result = await pool.query(
      `SELECT id, email, compass_id, orcid_id, first_name, last_name, institution,
              subscription, subscription_status, is_admin, created_at,
              bio, position, department, location, website, google_scholar_url, research_interests,
              employment, education
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const submissionsResult = await pool.query(
      'SELECT COUNT(*) as count FROM research_items WHERE user_id = $1',
      [req.user.userId]
    );

    const user = result.rows[0];
    res.json({
      user: {
        ...user,
        subscription_tier: user.subscription, // map subscription column to subscription_tier for frontend
        subscription: undefined // remove the subscription field
      },
      stats: {
        submissions: parseInt(submissionsResult.rows[0].count)
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  const {
    first_name,
    last_name,
    institution,
    orcid_id,
    bio,
    position,
    department,
    location,
    website,
    google_scholar_url,
    research_interests,
    avatar_url,
    employment,
    education
  } = req.body;

  try {
    // Update profile in database (works for both regular users and admin)
    const result = await pool.query(
      `UPDATE users
       SET first_name = $1,
           last_name = $2,
           institution = $3,
           orcid_id = $4,
           bio = $5,
           position = $6,
           department = $7,
           location = $8,
           website = $9,
           google_scholar_url = $10,
           research_interests = $11,
           avatar_url = $12,
           employment = $13,
           education = $14,
           updated_at = NOW()
       WHERE id = $15
       RETURNING id, email, compass_id, first_name, last_name, institution, orcid_id,
                 bio, position, department, location, website, google_scholar_url, research_interests, avatar_url,
                 employment, education, subscription, subscription_status, is_admin`,
      [first_name, last_name, institution, orcid_id, bio, position, department, location, website, google_scholar_url, research_interests, avatar_url, employment, education, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      message: 'Profile updated successfully',
      user: {
        ...user,
        subscription_tier: user.subscription, // map subscription column to subscription_tier for frontend
        subscription: undefined // remove the subscription field
      }
    });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });

  logger.info(`User logged out: ${req.user?.email || 'unknown'}`);

  res.json({ message: 'Logged out successfully' });
};

module.exports = { register, login, logout, getProfile, updateProfile };