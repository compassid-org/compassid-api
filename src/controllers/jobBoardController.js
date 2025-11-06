const pool = require('../config/database.cjs');
const logger = require('../config/logger.cjs');

// =============================================================================
// INSTITUTION MANAGEMENT
// =============================================================================

// Get all institutions (public)
const getInstitutions = async (req, res, next) => {
  try {
    const { type, verified, search, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT i.*,
             COUNT(jp.id) as active_jobs_count
      FROM institutions i
      LEFT JOIN job_postings jp ON i.id = jp.institution_id AND jp.status = 'active'
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND i.type = $${paramIndex++}`;
      params.push(type);
    }

    if (verified === 'true') {
      query += ` AND i.verified = true`;
    }

    if (search) {
      query += ` AND (i.name ILIKE $${paramIndex++} OR i.description ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += `
      GROUP BY i.id
      ORDER BY i.verified DESC, i.name ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(DISTINCT i.id) as total FROM institutions i WHERE 1=1';
    const countParams = [];
    let countParamIndex = 1;

    if (type) {
      countQuery += ` AND i.type = $${countParamIndex++}`;
      countParams.push(type);
    }
    if (verified === 'true') {
      countQuery += ` AND i.verified = true`;
    }
    if (search) {
      countQuery += ` AND (i.name ILIKE $${countParamIndex++} OR i.description ILIKE $${countParamIndex++})`;
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      institutions: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create new institution (requires authentication)
const createInstitution = async (req, res, next) => {
  try {
    const { name, type, description, website, location, contact_email, contact_phone, logo_url } = req.body;

    if (!name || !type || !contact_email) {
      return res.status(400).json({ error: 'Name, type, and contact email are required' });
    }

    const result = await pool.query(
      `INSERT INTO institutions (name, type, description, website, location, contact_email, contact_phone, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, type, description, website, location, contact_email, contact_phone, logo_url]
    );

    // Add the creating user as an admin for this institution
    await pool.query(
      'INSERT INTO institution_users (user_id, institution_id, role) VALUES ($1, $2, $3)',
      [req.user.id, result.rows[0].id, 'admin']
    );

    logger.info(`New institution created: ${name} by user ${req.user.id}`);

    res.status(201).json({ institution: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Get institutions where user has management access
const getUserInstitutions = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT i.*, iu.role, iu.status,
              COUNT(jp.id) as total_jobs_count,
              COUNT(CASE WHEN jp.status = 'active' THEN 1 END) as active_jobs_count
       FROM institutions i
       JOIN institution_users iu ON i.id = iu.institution_id
       LEFT JOIN job_postings jp ON i.id = jp.institution_id
       WHERE iu.user_id = $1 AND iu.status = 'active'
       GROUP BY i.id, iu.role, iu.status
       ORDER BY i.name`,
      [req.user.id]
    );

    res.json({ institutions: result.rows });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// JOB POSTINGS MANAGEMENT
// =============================================================================

// Get all job postings (public with filtering)
const getJobPostings = async (req, res, next) => {
  try {
    const {
      search, location, employment_type, experience_level, institution_type,
      framework_id, category_id, remote_work, featured,
      sort_by = 'created_at', sort_order = 'desc',
      limit = 20, offset = 0
    } = req.query;

    let query = `
      SELECT jp.*,
             i.name as institution_name, i.type as institution_type, i.logo_url as institution_logo,
             u.first_name as posted_by_name,
             COALESCE(array_agg(DISTINCT jc.name) FILTER (WHERE jc.name IS NOT NULL), '{}') as categories,
             COALESCE(array_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '{}') as framework_names
      FROM job_postings jp
      JOIN institutions i ON jp.institution_id = i.id
      JOIN users u ON jp.posted_by = u.id
      LEFT JOIN job_posting_categories jpc ON jp.id = jpc.job_posting_id
      LEFT JOIN job_categories jc ON jpc.category_id = jc.id
      LEFT JOIN frameworks f ON f.id = ANY(jp.related_frameworks)
      WHERE jp.status = 'active' AND jp.application_deadline >= CURRENT_DATE
    `;

    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (jp.title ILIKE $${paramIndex++} OR jp.description ILIKE $${paramIndex++} OR i.name ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (location) {
      query += ` AND jp.location ILIKE $${paramIndex++}`;
      params.push(`%${location}%`);
    }

    if (employment_type) {
      query += ` AND jp.employment_type = $${paramIndex++}`;
      params.push(employment_type);
    }

    if (experience_level) {
      query += ` AND jp.experience_level = $${paramIndex++}`;
      params.push(experience_level);
    }

    if (institution_type) {
      query += ` AND i.type = $${paramIndex++}`;
      params.push(institution_type);
    }

    if (framework_id) {
      query += ` AND $${paramIndex++} = ANY(jp.related_frameworks)`;
      params.push(parseInt(framework_id));
    }

    if (category_id) {
      query += ` AND EXISTS (SELECT 1 FROM job_posting_categories jpc WHERE jpc.job_posting_id = jp.id AND jpc.category_id = $${paramIndex++})`;
      params.push(parseInt(category_id));
    }

    if (remote_work === 'true') {
      query += ` AND jp.remote_work_allowed = true`;
    }

    if (featured === 'true') {
      query += ` AND jp.featured = true`;
    }

    query += ` GROUP BY jp.id, i.id, u.first_name`;

    // Add sorting with strict whitelist to prevent SQL injection
    const validSortColumns = {
      'created_at': 'jp.created_at',
      'title': 'jp.title',
      'application_deadline': 'jp.application_deadline',
      'views_count': 'jp.views_count'
    };

    const sortColumn = validSortColumns[sort_by] || validSortColumns['created_at'];
    const sortDirection = sort_order && sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    if (featured === 'true') {
      query += ` ORDER BY jp.featured DESC, ${sortColumn} ${sortDirection}`;
    } else {
      query += ` ORDER BY ${sortColumn} ${sortDirection}`;
    }

    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT jp.id) as total
      FROM job_postings jp
      JOIN institutions i ON jp.institution_id = i.id
      WHERE jp.status = 'active' AND jp.application_deadline >= CURRENT_DATE
    `;
    const countParams = [];
    let countParamIndex = 1;

    // Rebuild filter conditions for count query
    if (search) {
      countQuery += ` AND (jp.title ILIKE $${countParamIndex++} OR jp.description ILIKE $${countParamIndex++} OR i.name ILIKE $${countParamIndex++})`;
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (location) {
      countQuery += ` AND jp.location ILIKE $${countParamIndex++}`;
      countParams.push(`%${location}%`);
    }
    if (employment_type) {
      countQuery += ` AND jp.employment_type = $${countParamIndex++}`;
      countParams.push(employment_type);
    }
    if (experience_level) {
      countQuery += ` AND jp.experience_level = $${countParamIndex++}`;
      countParams.push(experience_level);
    }
    if (institution_type) {
      countQuery += ` AND i.type = $${countParamIndex++}`;
      countParams.push(institution_type);
    }
    if (framework_id) {
      countQuery += ` AND $${countParamIndex++} = ANY(jp.related_frameworks)`;
      countParams.push(parseInt(framework_id));
    }
    if (category_id) {
      countQuery += ` AND EXISTS (SELECT 1 FROM job_posting_categories jpc WHERE jpc.job_posting_id = jp.id AND jpc.category_id = $${countParamIndex++})`;
      countParams.push(parseInt(category_id));
    }
    if (remote_work === 'true') {
      countQuery += ` AND jp.remote_work_allowed = true`;
    }
    if (featured === 'true') {
      countQuery += ` AND jp.featured = true`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      jobs: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get single job posting with full details
const getJobPosting = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT jp.*,
              i.name as institution_name, i.type as institution_type, i.description as institution_description,
              i.website as institution_website, i.location as institution_location, i.logo_url as institution_logo,
              u.first_name as posted_by_name,
              COALESCE(array_agg(DISTINCT jc.name) FILTER (WHERE jc.name IS NOT NULL), '{}') as categories,
              COALESCE(array_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '{}') as framework_names
       FROM job_postings jp
       JOIN institutions i ON jp.institution_id = i.id
       JOIN users u ON jp.posted_by = u.id
       LEFT JOIN job_posting_categories jpc ON jp.id = jpc.job_posting_id
       LEFT JOIN job_categories jc ON jpc.category_id = jc.id
       LEFT JOIN frameworks f ON f.id = ANY(jp.related_frameworks)
       WHERE jp.id = $1
       GROUP BY jp.id, i.id, u.first_name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job posting not found' });
    }

    // Increment view count
    await pool.query(
      'UPDATE job_postings SET views_count = views_count + 1 WHERE id = $1',
      [id]
    );

    res.json({ job: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Create new job posting (requires institution access)
const createJobPosting = async (req, res, next) => {
  try {
    const {
      institution_id, title, description, requirements, responsibilities,
      salary_range, employment_type, location, remote_work_allowed,
      department, experience_level, education_required, related_frameworks,
      research_areas, application_deadline, application_instructions,
      external_application_url, categories
    } = req.body;

    if (!institution_id || !title || !description || !employment_type) {
      return res.status(400).json({
        error: 'Institution ID, title, description, and employment type are required'
      });
    }

    // Check if user has permission to post for this institution
    const institutionCheck = await pool.query(
      'SELECT role FROM institution_users WHERE user_id = $1 AND institution_id = $2 AND status = $3',
      [req.user.id, institution_id, 'active']
    );

    if (institutionCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to post jobs for this institution' });
    }

    const result = await pool.query(
      `INSERT INTO job_postings (
        institution_id, posted_by, title, description, requirements, responsibilities,
        salary_range, employment_type, location, remote_work_allowed, department,
        experience_level, education_required, related_frameworks, research_areas,
        application_deadline, application_instructions, external_application_url,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        institution_id, req.user.id, title, description, requirements, responsibilities,
        salary_range, employment_type, location, remote_work_allowed || false, department,
        experience_level, education_required, related_frameworks || [], research_areas || [],
        application_deadline, application_instructions, external_application_url, 'draft'
      ]
    );

    const jobId = result.rows[0].id;

    // Add categories if provided (using safe parameterized query)
    if (categories && Array.isArray(categories) && categories.length > 0) {
      // Validate that all categories are integers to prevent SQL injection
      const validCategories = categories.filter(cat => Number.isInteger(parseInt(cat)));

      if (validCategories.length > 0) {
        // Build parameterized values for bulk insert: ($1, $2), ($3, $4), etc.
        const values = [];
        const placeholders = validCategories.map((categoryId, index) => {
          const paramIndex = index * 2;
          values.push(jobId, parseInt(categoryId));
          return `($${paramIndex + 1}, $${paramIndex + 2})`;
        }).join(', ');

        await pool.query(
          `INSERT INTO job_posting_categories (job_posting_id, category_id) VALUES ${placeholders}`,
          values
        );
      }
    }

    logger.info(`New job posting created: ${title} for institution ${institution_id} by user ${req.user.id}`);

    res.status(201).json({ job: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Update job posting
const updateJobPosting = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if user has permission to edit this job
    const jobCheck = await pool.query(
      `SELECT jp.*, iu.role
       FROM job_postings jp
       JOIN institution_users iu ON jp.institution_id = iu.institution_id
       WHERE jp.id = $1 AND iu.user_id = $2 AND iu.status = 'active'`,
      [id, req.user.id]
    );

    if (jobCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to edit this job posting' });
    }

    // Build dynamic update query
    const allowedFields = [
      'title', 'description', 'requirements', 'responsibilities', 'salary_range',
      'employment_type', 'location', 'remote_work_allowed', 'department',
      'experience_level', 'education_required', 'related_frameworks', 'research_areas',
      'application_deadline', 'application_instructions', 'external_application_url', 'status'
    ];

    const setClause = [];
    const params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex++}`);
        params.push(value);
      }
    }

    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const query = `UPDATE job_postings SET ${setClause.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, params);

    // Update categories if provided (using safe parameterized query)
    if (updates.categories && Array.isArray(updates.categories)) {
      await pool.query('DELETE FROM job_posting_categories WHERE job_posting_id = $1', [id]);

      if (updates.categories.length > 0) {
        // Validate that all categories are integers to prevent SQL injection
        const validCategories = updates.categories.filter(cat => Number.isInteger(parseInt(cat)));

        if (validCategories.length > 0) {
          // Build parameterized values for bulk insert: ($1, $2), ($3, $4), etc.
          const values = [];
          const placeholders = validCategories.map((categoryId, index) => {
            const paramIndex = index * 2;
            values.push(parseInt(id), parseInt(categoryId));
            return `($${paramIndex + 1}, $${paramIndex + 2})`;
          }).join(', ');

          await pool.query(
            `INSERT INTO job_posting_categories (job_posting_id, category_id) VALUES ${placeholders}`,
            values
          );
        }
      }
    }

    res.json({ job: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// JOB APPLICATIONS
// =============================================================================

// Apply to a job
const applyToJob = async (req, res, next) => {
  try {
    const { job_posting_id } = req.params;
    const { cover_letter, resume_url, portfolio_url, additional_documents, application_responses } = req.body;

    // Check if job exists and is still accepting applications
    const jobCheck = await pool.query(
      'SELECT * FROM job_postings WHERE id = $1 AND status = $2 AND application_deadline >= CURRENT_DATE',
      [job_posting_id, 'active']
    );

    if (jobCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no longer accepting applications' });
    }

    // Check if user already applied
    const existingApplication = await pool.query(
      'SELECT id FROM job_applications WHERE job_posting_id = $1 AND applicant_id = $2',
      [job_posting_id, req.user.id]
    );

    if (existingApplication.rows.length > 0) {
      return res.status(409).json({ error: 'You have already applied to this job' });
    }

    const result = await pool.query(
      `INSERT INTO job_applications (
        job_posting_id, applicant_id, cover_letter, resume_url, portfolio_url,
        additional_documents, application_responses
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [job_posting_id, req.user.id, cover_letter, resume_url, portfolio_url,
       additional_documents || [], application_responses || {}]
    );

    // Increment applications count
    await pool.query(
      'UPDATE job_postings SET applications_count = applications_count + 1 WHERE id = $1',
      [job_posting_id]
    );

    logger.info(`User ${req.user.id} applied to job ${job_posting_id}`);

    res.status(201).json({ application: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

// Get user's job applications
const getUserApplications = async (req, res, next) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT ja.*,
             jp.title as job_title, jp.employment_type, jp.location,
             i.name as institution_name, i.logo_url as institution_logo
      FROM job_applications ja
      JOIN job_postings jp ON ja.job_posting_id = jp.id
      JOIN institutions i ON jp.institution_id = i.id
      WHERE ja.applicant_id = $1
    `;
    const params = [req.user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND ja.status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY ja.submitted_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({ applications: result.rows });
  } catch (error) {
    next(error);
  }
};

// Get job categories
const getJobCategories = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM job_categories WHERE active = true ORDER BY name'
    );

    res.json({ categories: result.rows });
  } catch (error) {
    next(error);
  }
};

// Save/unsave a job
const toggleSavedJob = async (req, res, next) => {
  try {
    const { job_posting_id } = req.params;

    // Check if already saved
    const existingSave = await pool.query(
      'SELECT id FROM saved_jobs WHERE user_id = $1 AND job_posting_id = $2',
      [req.user.id, job_posting_id]
    );

    if (existingSave.rows.length > 0) {
      // Remove save
      await pool.query(
        'DELETE FROM saved_jobs WHERE user_id = $1 AND job_posting_id = $2',
        [req.user.id, job_posting_id]
      );
      res.json({ saved: false });
    } else {
      // Add save
      await pool.query(
        'INSERT INTO saved_jobs (user_id, job_posting_id) VALUES ($1, $2)',
        [req.user.id, job_posting_id]
      );
      res.json({ saved: true });
    }
  } catch (error) {
    next(error);
  }
};

// Get user's saved jobs
const getSavedJobs = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT jp.*, i.name as institution_name, i.logo_url as institution_logo, sj.saved_at
       FROM saved_jobs sj
       JOIN job_postings jp ON sj.job_posting_id = jp.id
       JOIN institutions i ON jp.institution_id = i.id
       WHERE sj.user_id = $1
       ORDER BY sj.saved_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );

    res.json({ saved_jobs: result.rows });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Institutions
  getInstitutions,
  createInstitution,
  getUserInstitutions,

  // Job Postings
  getJobPostings,
  getJobPosting,
  createJobPosting,
  updateJobPosting,

  // Applications
  applyToJob,
  getUserApplications,

  // Utilities
  getJobCategories,
  toggleSavedJob,
  getSavedJobs
};