const pool = require('../config/database.cjs');

/**
 * Get all events for a user (for public profile viewing)
 * @route GET /api/events/user/:userId
 */
const getUserEvents = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { includePrivate } = req.query;

    // Only include private events if requested by the owner
    let query = `
      SELECT
        id, title, description, event_type,
        event_date, end_date, timezone,
        location_type, location_name, location_address,
        event_link, registration_link, presenter_role,
        materials, is_public, created_at, updated_at
      FROM user_events
      WHERE user_id = $1
    `;

    const params = [userId];

    // Filter by visibility
    if (includePrivate !== 'true' || !req.user || req.user.userId !== userId) {
      query += ' AND is_public = true';
    }

    query += ' ORDER BY event_date DESC';

    const result = await pool.query(query, params);

    // Group events into past and upcoming
    const events = result.rows;
    const now = new Date();

    const pastEvents = events.filter(e => new Date(e.event_date) < now);
    const upcomingEvents = events.filter(e => new Date(e.event_date) >= now);

    res.json({
      success: true,
      past: pastEvents,
      upcoming: upcomingEvents,
      total: events.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single event by ID
 * @route GET /api/events/:id
 */
const getEventById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
        e.*,
        u.first_name, u.last_name, u.compass_id
      FROM user_events e
      JOIN users u ON e.user_id = u.id
      WHERE e.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    const event = result.rows[0];

    // Check if user has permission to view private events
    if (!event.is_public && (!req.user || req.user.userId !== event.user_id)) {
      return res.status(403).json({
        success: false,
        error: 'This event is private'
      });
    }

    res.json({
      success: true,
      event
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new event
 * @route POST /api/events
 */
const createEvent = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const {
      title,
      description,
      event_type,
      event_date,
      end_date,
      timezone,
      location_type,
      location_name,
      location_address,
      event_link,
      registration_link,
      presenter_role,
      materials,
      is_public
    } = req.body;

    // Validate required fields
    if (!title || !event_date || !event_type) {
      return res.status(400).json({
        success: false,
        error: 'Title, event date, and event type are required'
      });
    }

    const result = await pool.query(
      `INSERT INTO user_events (
        user_id, title, description, event_type,
        event_date, end_date, timezone,
        location_type, location_name, location_address,
        event_link, registration_link, presenter_role,
        materials, is_public
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        userId, title, description, event_type,
        event_date, end_date, timezone || 'UTC',
        location_type || 'virtual', location_name, location_address,
        event_link, registration_link, presenter_role,
        JSON.stringify(materials || []), is_public !== false
      ]
    );

    res.status(201).json({
      success: true,
      event: result.rows[0],
      message: 'Event created successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update event
 * @route PUT /api/events/:id
 */
const updateEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const {
      title,
      description,
      event_type,
      event_date,
      end_date,
      timezone,
      location_type,
      location_name,
      location_address,
      event_link,
      registration_link,
      presenter_role,
      materials,
      is_public
    } = req.body;

    // Check ownership
    const ownerCheck = await pool.query(
      'SELECT user_id FROM user_events WHERE id = $1',
      [id]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    if (ownerCheck.rows[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only update your own events'
      });
    }

    const result = await pool.query(
      `UPDATE user_events SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        event_type = COALESCE($3, event_type),
        event_date = COALESCE($4, event_date),
        end_date = $5,
        timezone = COALESCE($6, timezone),
        location_type = COALESCE($7, location_type),
        location_name = $8,
        location_address = $9,
        event_link = $10,
        registration_link = $11,
        presenter_role = $12,
        materials = COALESCE($13, materials),
        is_public = COALESCE($14, is_public),
        updated_at = NOW()
      WHERE id = $15
      RETURNING *`,
      [
        title, description, event_type, event_date, end_date, timezone,
        location_type, location_name, location_address,
        event_link, registration_link, presenter_role,
        materials ? JSON.stringify(materials) : null,
        is_public, id
      ]
    );

    res.json({
      success: true,
      event: result.rows[0],
      message: 'Event updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete event
 * @route DELETE /api/events/:id
 */
const deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check ownership
    const ownerCheck = await pool.query(
      'SELECT user_id FROM user_events WHERE id = $1',
      [id]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    if (ownerCheck.rows[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own events'
      });
    }

    await pool.query('DELETE FROM user_events WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent
};
