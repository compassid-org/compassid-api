const pool = require('../config/database.js');

const getFeed = async (req, res, next) => {
  try {
    const {
      post_type,
      hashtag,
      user_id,
      page = 1,
      limit = 20
    } = req.query;

    const userId = req.user?.userId;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        p.id, p.content, p.media_url, p.post_type, p.reply_to,
        p.like_count, p.reply_count, p.share_count, p.is_pinned,
        p.created_at, p.updated_at,
        u.id as user_id, u.first_name, u.last_name, u.institution, u.role,
        r.id as research_id, r.title as research_title,
        ${userId ? `
          EXISTS(SELECT 1 FROM feed_post_likes l WHERE l.post_id = p.id AND l.user_id = $${userId ? 'next_param' : 'null'}) as user_liked,
          EXISTS(SELECT 1 FROM feed_post_shares s WHERE s.post_id = p.id AND s.user_id = $${userId ? 'next_param' : 'null'}) as user_shared
        ` : 'FALSE as user_liked, FALSE as user_shared'},
        COALESCE(
          JSON_AGG(
            CASE WHEN h.tag IS NOT NULL THEN h.tag END
          ) FILTER (WHERE h.tag IS NOT NULL),
          '[]'
        ) as hashtags
      FROM feed_posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN research_items r ON p.research_id = r.id
      LEFT JOIN feed_post_hashtags ph ON p.id = ph.post_id
      LEFT JOIN hashtags h ON ph.hashtag_id = h.id
      WHERE p.visibility = 'public'
    `;

    const params = [];
    let paramCounter = 1;

    // Add user_id parameters for likes/shares check
    if (userId) {
      params.push(userId, userId);
      paramCounter += 2;
    }

    if (post_type) {
      query += ` AND p.post_type = $${paramCounter}`;
      params.push(post_type);
      paramCounter++;
    }

    if (user_id) {
      query += ` AND p.user_id = $${paramCounter}`;
      params.push(user_id);
      paramCounter++;
    }

    if (hashtag) {
      query += ` AND EXISTS (
        SELECT 1 FROM feed_post_hashtags ph2
        JOIN hashtags h2 ON ph2.hashtag_id = h2.id
        WHERE ph2.post_id = p.id AND h2.tag = $${paramCounter}
      )`;
      params.push(hashtag);
      paramCounter++;
    }

    query += `
      GROUP BY p.id, u.id, u.first_name, u.last_name, u.institution, u.role,
               r.id, r.title
      ORDER BY p.is_pinned DESC, p.created_at DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT p.id)
      FROM feed_posts p
      WHERE p.visibility = 'public'
    `;
    const countParams = [];
    let countParamCounter = 1;

    if (post_type) {
      countQuery += ` AND p.post_type = $${countParamCounter}`;
      countParams.push(post_type);
      countParamCounter++;
    }

    if (user_id) {
      countQuery += ` AND p.user_id = $${countParamCounter}`;
      countParams.push(user_id);
      countParamCounter++;
    }

    if (hashtag) {
      countQuery += ` AND EXISTS (
        SELECT 1 FROM feed_post_hashtags ph
        JOIN hashtags h ON ph.hashtag_id = h.id
        WHERE ph.post_id = p.id AND h.tag = $${countParamCounter}
      )`;
      countParams.push(hashtag);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      posts: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    next(error);
  }
};

const createPost = async (req, res, next) => {
  try {
    const { content, media_url, research_id, post_type = 'general', reply_to } = req.body;
    const userId = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.length > 1000) {
      return res.status(400).json({ error: 'Content must be 1000 characters or less' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Insert post
      const postResult = await client.query(`
        INSERT INTO feed_posts
        (user_id, content, media_url, research_id, post_type, reply_to)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [userId, content.trim(), media_url || null, research_id || null, post_type, reply_to || null]);

      const postId = postResult.rows[0].id;

      // Extract and save hashtags
      const hashtags = content.match(/#\w+/g) || [];
      for (const hashtag of hashtags) {
        // Insert or get hashtag
        const tagResult = await client.query(`
          INSERT INTO hashtags (tag, usage_count)
          VALUES ($1, 1)
          ON CONFLICT (tag) DO UPDATE SET usage_count = hashtags.usage_count + 1
          RETURNING id
        `, [hashtag]);

        const tagId = tagResult.rows[0].id;

        // Link post to hashtag
        await client.query(`
          INSERT INTO feed_post_hashtags (post_id, hashtag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [postId, tagId]);
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Post created successfully',
        post: postResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

const likePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(`
      INSERT INTO feed_post_likes (post_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (post_id, user_id) DO NOTHING
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Post already liked' });
    }

    res.json({ message: 'Post liked successfully' });
  } catch (error) {
    next(error);
  }
};

const unlikePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(`
      DELETE FROM feed_post_likes
      WHERE post_id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Like not found' });
    }

    res.json({ message: 'Post unliked successfully' });
  } catch (error) {
    next(error);
  }
};

const sharePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const userId = req.user.userId;

    const result = await pool.query(`
      INSERT INTO feed_post_shares (post_id, user_id, comment)
      VALUES ($1, $2, $3)
      ON CONFLICT (post_id, user_id) DO NOTHING
      RETURNING *
    `, [id, userId, comment || null]);

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Post already shared' });
    }

    res.json({ message: 'Post shared successfully' });
  } catch (error) {
    next(error);
  }
};

const unsharePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(`
      DELETE FROM feed_post_shares
      WHERE post_id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }

    res.json({ message: 'Post unshared successfully' });
  } catch (error) {
    next(error);
  }
};

const deletePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if user owns the post or is admin
    const postResult = await pool.query(`
      SELECT user_id FROM feed_posts WHERE id = $1
    `, [id]);

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const userResult = await pool.query(`
      SELECT role FROM users WHERE id = $1
    `, [userId]);

    const isOwner = postResult.rows[0].user_id === userId;
    const isAdmin = userResult.rows[0]?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await pool.query(`DELETE FROM feed_posts WHERE id = $1`, [id]);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const getTrendingHashtags = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT tag, usage_count
      FROM hashtags
      WHERE usage_count > 0
      ORDER BY usage_count DESC, tag ASC
      LIMIT $1
    `, [parseInt(limit)]);

    res.json({ hashtags: result.rows });
  } catch (error) {
    next(error);
  }
};

const getPostReplies = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const query = `
      SELECT
        p.id, p.content, p.media_url, p.created_at,
        p.like_count, p.reply_count, p.share_count,
        u.id as user_id, u.first_name, u.last_name, u.institution,
        ${userId ? `
          EXISTS(SELECT 1 FROM feed_post_likes l WHERE l.post_id = p.id AND l.user_id = $2) as user_liked
        ` : 'FALSE as user_liked'}
      FROM feed_posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.reply_to = $1 AND p.visibility = 'public'
      ORDER BY p.created_at ASC
    `;

    const params = [id];
    if (userId) params.push(userId);

    const result = await pool.query(query, params);

    res.json({ replies: result.rows });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFeed,
  createPost,
  likePost,
  unlikePost,
  sharePost,
  unsharePost,
  deletePost,
  getTrendingHashtags,
  getPostReplies
};