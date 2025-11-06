import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pool = require('../config/database.cjs');

import { createNotification } from './notificationsController.js';

// Send a message
export const sendMessage = async (req, res) => {
  const { recipient_id, subject, body, parent_message_id } = req.body;
  const sender_id = req.user.id;

  if (sender_id === recipient_id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot message yourself'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, subject, body, parent_message_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sender_id, recipient_id, subject, body, parent_message_id]
    );

    // Get sender name for notification
    const senderData = await pool.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [sender_id]
    );

    const senderName = `${senderData.rows[0].first_name} ${senderData.rows[0].last_name}`;

    // Create notification for recipient
    await createNotification(
      recipient_id,
      'message',
      'New Message',
      `${senderName} sent you a message${subject ? `: ${subject}` : ''}`,
      `/messages`,
      { message_id: result.rows[0].id, sender_id }
    );

    res.status(201).json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
};

// Get conversations list (unique users messaged with)
export const getConversations = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `WITH latest_messages AS (
        SELECT DISTINCT ON (
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END
        )
          m.*,
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END as other_user_id
        FROM messages m
        WHERE sender_id = $1 OR recipient_id = $1
        ORDER BY
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END,
          created_at DESC
      )
      SELECT
        lm.*,
        u.first_name,
        u.last_name,
        u.email,
        u.avatar_url,
        u.institution,
        (SELECT COUNT(*) FROM messages
         WHERE sender_id = lm.other_user_id
         AND recipient_id = $1
         AND is_read = false) as unread_count
      FROM latest_messages lm
      JOIN users u ON u.id = lm.other_user_id
      ORDER BY lm.created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      conversations: result.rows
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations'
    });
  }
};

// Get messages in a conversation with a specific user
export const getConversationMessages = async (req, res) => {
  const user_id = req.user.id;
  const other_user_id = req.params.userId;

  try {
    const result = await pool.query(
      `SELECT m.*,
              sender.first_name as sender_first_name,
              sender.last_name as sender_last_name,
              sender.avatar_url as sender_avatar_url,
              recipient.first_name as recipient_first_name,
              recipient.last_name as recipient_last_name,
              recipient.avatar_url as recipient_avatar_url
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       JOIN users recipient ON recipient.id = m.recipient_id
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at ASC`,
      [user_id, other_user_id]
    );

    // Mark messages from the other user as read
    await pool.query(
      `UPDATE messages
       SET is_read = true, read_at = NOW()
       WHERE sender_id = $1 AND recipient_id = $2 AND is_read = false`,
      [other_user_id, user_id]
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
};

// Mark a message as read
export const markAsRead = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `UPDATE messages
       SET is_read = true, read_at = NOW()
       WHERE id = $1 AND recipient_id = $2
       RETURNING *`,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark message as read'
    });
  }
};

// Delete a message
export const deleteMessage = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2) RETURNING *',
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
};

// Get unread message count
export const getUnreadCount = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM messages WHERE recipient_id = $1 AND is_read = false',
      [user_id]
    );

    res.json({
      success: true,
      count: parseInt(result.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
};
