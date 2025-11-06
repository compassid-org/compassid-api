const pool = require('../config/database.cjs');

const getAllPosts = async (req, res, next) => {
  try {
    const {
      category,
      tag,
      featured,
      status = 'published',
      page = 1,
      limit = 12
    } = req.query;

    const offset = (page - 1) * limit;
    let query = `
      SELECT
        p.id, p.title, p.slug, p.excerpt, p.featured_image_url,
        p.is_featured, p.view_count, p.published_at, p.created_at,
        u.first_name, u.last_name, u.institution,
        c.name as category_name, c.slug as category_slug, c.color as category_color,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('name', t.name, 'slug', t.slug)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) as tags
      FROM blog_posts p
      JOIN users u ON p.author_id = u.id
      JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_post_tags pt ON p.id = pt.post_id
      LEFT JOIN blog_tags t ON pt.tag_id = t.id
      WHERE p.status = $1
    `;

    const params = [status];
    let paramCounter = 2;

    if (category) {
      query += ` AND c.slug = $${paramCounter}`;
      params.push(category);
      paramCounter++;
    }

    if (featured === 'true') {
      query += ` AND p.is_featured = true`;
    }

    if (tag) {
      query += ` AND EXISTS (
        SELECT 1 FROM blog_post_tags pt2
        JOIN blog_tags t2 ON pt2.tag_id = t2.id
        WHERE pt2.post_id = p.id AND t2.slug = $${paramCounter}
      )`;
      params.push(tag);
      paramCounter++;
    }

    query += `
      GROUP BY p.id, u.first_name, u.last_name, u.institution,
               c.name, c.slug, c.color
      ORDER BY p.is_featured DESC, p.published_at DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT p.id)
      FROM blog_posts p
      JOIN blog_categories c ON p.category_id = c.id
      WHERE p.status = $1
    `;
    const countParams = [status];
    let countParamCounter = 2;

    if (category) {
      countQuery += ` AND c.slug = $${countParamCounter}`;
      countParams.push(category);
      countParamCounter++;
    }

    if (featured === 'true') {
      countQuery += ` AND p.is_featured = true`;
    }

    if (tag) {
      countQuery += ` AND EXISTS (
        SELECT 1 FROM blog_post_tags pt
        JOIN blog_tags t ON pt.tag_id = t.id
        WHERE pt.post_id = p.id AND t.slug = $${countParamCounter}
      )`;
      countParams.push(tag);
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

const getPostBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    // Get the post
    const postResult = await pool.query(`
      SELECT
        p.*,
        u.first_name, u.last_name, u.institution, u.email,
        c.name as category_name, c.slug as category_slug, c.color as category_color,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('name', t.name, 'slug', t.slug)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) as tags
      FROM blog_posts p
      JOIN users u ON p.author_id = u.id
      JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN blog_post_tags pt ON p.id = pt.post_id
      LEFT JOIN blog_tags t ON pt.tag_id = t.id
      WHERE p.slug = $1 AND p.status = 'published'
      GROUP BY p.id, u.first_name, u.last_name, u.institution, u.email,
               c.name, c.slug, c.color
    `, [slug]);

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = postResult.rows[0];

    // Increment view count
    await pool.query(`
      UPDATE blog_posts
      SET view_count = view_count + 1
      WHERE id = $1
    `, [post.id]);

    // Get approved comments
    const commentsResult = await pool.query(`
      SELECT
        c.id, c.content, c.created_at,
        c.author_name,
        u.first_name, u.last_name
      FROM blog_comments c
      LEFT JOIN users u ON c.author_id = u.id
      WHERE c.post_id = $1 AND c.status = 'approved'
      ORDER BY c.created_at ASC
    `, [post.id]);

    res.json({
      post,
      comments: commentsResult.rows
    });
  } catch (error) {
    next(error);
  }
};

const getCategories = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        c.*,
        COUNT(p.id) as post_count
      FROM blog_categories c
      LEFT JOIN blog_posts p ON c.id = p.category_id AND p.status = 'published'
      GROUP BY c.id
      ORDER BY c.name
    `);

    res.json({ categories: result.rows });
  } catch (error) {
    next(error);
  }
};

const getTags = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        t.*,
        COUNT(pt.post_id) as post_count
      FROM blog_tags t
      LEFT JOIN blog_post_tags pt ON t.id = pt.tag_id
      LEFT JOIN blog_posts p ON pt.post_id = p.id AND p.status = 'published'
      GROUP BY t.id
      HAVING COUNT(pt.post_id) > 0
      ORDER BY post_count DESC, t.name
    `);

    res.json({ tags: result.rows });
  } catch (error) {
    next(error);
  }
};

const addComment = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { content, author_name, author_email } = req.body;
    const userId = req.user?.userId;

    // Validate required fields
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    if (!userId && (!author_name || !author_email)) {
      return res.status(400).json({
        error: 'Name and email are required for guest comments'
      });
    }

    // Get post ID from slug
    const postResult = await pool.query(`
      SELECT id FROM blog_posts WHERE slug = $1 AND status = 'published'
    `, [slug]);

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = postResult.rows[0].id;

    // Insert comment
    const result = await pool.query(`
      INSERT INTO blog_comments
      (post_id, author_id, author_name, author_email, content)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [postId, userId || null, author_name || null, author_email || null, content.trim()]);

    res.status(201).json({
      message: 'Comment submitted successfully and is pending approval',
      comment: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

// Admin endpoints
const createPost = async (req, res, next) => {
  try {
    const {
      title,
      slug,
      excerpt,
      content,
      category_id,
      featured_image_url,
      status = 'draft',
      is_featured = false,
      tags = []
    } = req.body;

    const userId = req.user.userId;

    // Check if user is admin or editor
    const userResult = await pool.query(`
      SELECT role FROM users WHERE id = $1
    `, [userId]);

    if (!userResult.rows.length || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Insert post
      const postResult = await client.query(`
        INSERT INTO blog_posts
        (title, slug, excerpt, content, author_id, category_id,
         featured_image_url, status, is_featured, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        title, slug, excerpt, content, userId, category_id,
        featured_image_url, status, is_featured,
        status === 'published' ? new Date() : null
      ]);

      const postId = postResult.rows[0].id;

      // Add tags
      if (tags.length > 0) {
        for (const tagSlug of tags) {
          // Get or create tag
          const tagResult = await client.query(`
            INSERT INTO blog_tags (name, slug)
            VALUES (INITCAP(REPLACE($1, '-', ' ')), $1)
            ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
            RETURNING id
          `, [tagSlug]);

          const tagId = tagResult.rows[0].id;

          // Link post to tag
          await client.query(`
            INSERT INTO blog_post_tags (post_id, tag_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [postId, tagId]);
        }
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

const updatePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      slug,
      excerpt,
      content,
      category_id,
      featured_image_url,
      status,
      is_featured,
      tags = []
    } = req.body;

    const userId = req.user.userId;

    // Check permissions
    const userResult = await pool.query(`
      SELECT role FROM users WHERE id = $1
    `, [userId]);

    if (!userResult.rows.length || !['admin', 'editor'].includes(userResult.rows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update post
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (title !== undefined) {
        updateFields.push(`title = $${paramCounter}`);
        updateValues.push(title);
        paramCounter++;
      }

      if (slug !== undefined) {
        updateFields.push(`slug = $${paramCounter}`);
        updateValues.push(slug);
        paramCounter++;
      }

      if (excerpt !== undefined) {
        updateFields.push(`excerpt = $${paramCounter}`);
        updateValues.push(excerpt);
        paramCounter++;
      }

      if (content !== undefined) {
        updateFields.push(`content = $${paramCounter}`);
        updateValues.push(content);
        paramCounter++;
      }

      if (category_id !== undefined) {
        updateFields.push(`category_id = $${paramCounter}`);
        updateValues.push(category_id);
        paramCounter++;
      }

      if (featured_image_url !== undefined) {
        updateFields.push(`featured_image_url = $${paramCounter}`);
        updateValues.push(featured_image_url);
        paramCounter++;
      }

      if (status !== undefined) {
        updateFields.push(`status = $${paramCounter}`);
        updateValues.push(status);
        paramCounter++;

        // Set published_at if publishing
        if (status === 'published') {
          updateFields.push(`published_at = COALESCE(published_at, $${paramCounter})`);
          updateValues.push(new Date());
          paramCounter++;
        }
      }

      if (is_featured !== undefined) {
        updateFields.push(`is_featured = $${paramCounter}`);
        updateValues.push(is_featured);
        paramCounter++;
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        const updateQuery = `
          UPDATE blog_posts
          SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramCounter}
          RETURNING *
        `;

        const postResult = await client.query(updateQuery, updateValues);

        if (postResult.rows.length === 0) {
          throw new Error('Post not found');
        }
      }

      // Update tags if provided
      if (tags.length >= 0) {
        // Remove existing tags
        await client.query('DELETE FROM blog_post_tags WHERE post_id = $1', [id]);

        // Add new tags
        for (const tagSlug of tags) {
          const tagResult = await client.query(`
            INSERT INTO blog_tags (name, slug)
            VALUES (INITCAP(REPLACE($1, '-', ' ')), $1)
            ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
            RETURNING id
          `, [tagSlug]);

          const tagId = tagResult.rows[0].id;

          await client.query(`
            INSERT INTO blog_post_tags (post_id, tag_id)
            VALUES ($1, $2)
          `, [id, tagId]);
        }
      }

      await client.query('COMMIT');

      res.json({ message: 'Post updated successfully' });
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

const deletePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check permissions
    const userResult = await pool.query(`
      SELECT role FROM users WHERE id = $1
    `, [userId]);

    if (!userResult.rows.length || userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin permissions required' });
    }

    const result = await pool.query(`
      DELETE FROM blog_posts WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPosts,
  getPostBySlug,
  getCategories,
  getTags,
  addComment,
  createPost,
  updatePost,
  deletePost
};