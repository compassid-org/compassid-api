import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pool = require('../../config/database.js');

import { createNotification } from './notificationsController.js';

// Follow a user
export const followUser = async (req, res) => {
  const follower_id = req.user.id;
  const following_id = req.params.id;

  if (follower_id === following_id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot follow yourself'
    });
  }

  try {
    // Check if already following
    const existingFollow = await pool.query(
      'SELECT id FROM user_follows WHERE follower_id = $1 AND following_id = $2',
      [follower_id, following_id]
    );

    if (existingFollow.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Already following this user'
      });
    }

    // Create follow relationship
    await pool.query(
      'INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)',
      [follower_id, following_id]
    );

    // Get follower name for notification
    const followerData = await pool.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [follower_id]
    );

    const followerName = `${followerData.rows[0].first_name} ${followerData.rows[0].last_name}`;

    // Create notification for the followed user
    await createNotification(
      following_id,
      'follow',
      'New Follower',
      `${followerName} started following you`,
      `/profile/${follower_id}`,
      { follower_id }
    );

    res.json({
      success: true,
      message: 'Successfully followed user'
    });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to follow user'
    });
  }
};

// Unfollow a user
export const unfollowUser = async (req, res) => {
  const follower_id = req.user.id;
  const following_id = req.params.id;

  try {
    const result = await pool.query(
      'DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2 RETURNING *',
      [follower_id, following_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Follow relationship not found'
      });
    }

    res.json({
      success: true,
      message: 'Successfully unfollowed user'
    });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unfollow user'
    });
  }
};

// Get followers of a user
export const getFollowers = async (req, res) => {
  const user_id = req.params.id;

  try {
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.institution, u.compass_id, u.avatar_url,
              uf.created_at as followed_at
       FROM users u
       JOIN user_follows uf ON u.id = uf.follower_id
       WHERE uf.following_id = $1
       ORDER BY uf.created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      followers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching followers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch followers'
    });
  }
};

// Get users that a user is following
export const getFollowing = async (req, res) => {
  const user_id = req.params.id;

  try {
    const result = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.institution, u.compass_id, u.avatar_url,
              uf.created_at as followed_at
       FROM users u
       JOIN user_follows uf ON u.id = uf.following_id
       WHERE uf.follower_id = $1
       ORDER BY uf.created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      following: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching following:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch following'
    });
  }
};

// Check if current user is following another user
export const checkFollowStatus = async (req, res) => {
  const follower_id = req.user.id;
  const following_id = req.params.id;

  try {
    const result = await pool.query(
      'SELECT id FROM user_follows WHERE follower_id = $1 AND following_id = $2',
      [follower_id, following_id]
    );

    res.json({
      success: true,
      is_following: result.rows.length > 0
    });
  } catch (error) {
    console.error('Error checking follow status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check follow status'
    });
  }
};
