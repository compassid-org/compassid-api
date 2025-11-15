const pool = require('../../config/database.js');

// Save a paper
const savePaper = async (req, res) => {
  const {
    paper_title,
    paper_doi,
    paper_authors,
    paper_year,
    paper_journal,
    paper_abstract,
    paper_url,
    notes,
    tags,
    folder_id
  } = req.body;
  const user_id = req.user.id;

  try {
    // Insert into saved_papers
    const result = await pool.query(
      `INSERT INTO saved_papers
       (user_id, paper_title, paper_doi, paper_authors, paper_year, paper_journal, paper_abstract, paper_url, notes, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user_id, paper_title, paper_doi, paper_authors, paper_year, paper_journal, paper_abstract, paper_url, notes, tags]
    );

    const savedPaper = result.rows[0];

    // If folder_id provided, add to folder
    if (folder_id) {
      await pool.query(
        `INSERT INTO paper_folder_assignments (paper_id, folder_id)
         VALUES ($1, $2)`,
        [savedPaper.id, folder_id]
      );
    }

    res.status(201).json({
      success: true,
      paper: savedPaper
    });
  } catch (error) {
    console.error('Error saving paper:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save paper'
    });
  }
};

// Unsave a paper
const unsavePaper = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      'DELETE FROM saved_papers WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paper not found'
      });
    }

    res.json({
      success: true,
      message: 'Paper removed'
    });
  } catch (error) {
    console.error('Error removing paper:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove paper'
    });
  }
};

// Get saved papers
const getSavedPapers = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT sp.*,
              array_agg(DISTINCT jsonb_build_object('id', pf.id, 'name', pf.name, 'color', pf.color))
              FILTER (WHERE pf.id IS NOT NULL) as folders
       FROM saved_papers sp
       LEFT JOIN paper_folder_assignments pfa ON sp.id = pfa.paper_id
       LEFT JOIN paper_folders pf ON pfa.folder_id = pf.id
       WHERE sp.user_id = $1
       GROUP BY sp.id
       ORDER BY sp.created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      papers: result.rows
    });
  } catch (error) {
    console.error('Error fetching saved papers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved papers'
    });
  }
};

// Create a folder
const createFolder = async (req, res) => {
  const { name, description, color } = req.body;
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `INSERT INTO paper_folders (user_id, name, description, color)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, name, description, color || '#3B82F6']
    );

    res.status(201).json({
      success: true,
      folder: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({
        success: false,
        message: 'Folder with this name already exists'
      });
    }
    console.error('Error creating folder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create folder'
    });
  }
};

// Get folders
const getFolders = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT pf.*,
              COUNT(pfa.paper_id) as paper_count
       FROM paper_folders pf
       LEFT JOIN paper_folder_assignments pfa ON pf.id = pfa.folder_id
       WHERE pf.user_id = $1
       GROUP BY pf.id
       ORDER BY pf.created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      folders: result.rows
    });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch folders'
    });
  }
};

// Add paper to folder
const addPaperToFolder = async (req, res) => {
  const { id: folder_id } = req.params;
  const { paper_id } = req.body;
  const user_id = req.user.id;

  try {
    // Verify folder belongs to user
    const folderCheck = await pool.query(
      'SELECT id FROM paper_folders WHERE id = $1 AND user_id = $2',
      [folder_id, user_id]
    );

    if (folderCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    // Verify paper belongs to user
    const paperCheck = await pool.query(
      'SELECT id FROM saved_papers WHERE id = $1 AND user_id = $2',
      [paper_id, user_id]
    );

    if (paperCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paper not found'
      });
    }

    // Add to folder
    await pool.query(
      `INSERT INTO paper_folder_assignments (paper_id, folder_id)
       VALUES ($1, $2)
       ON CONFLICT (paper_id, folder_id) DO NOTHING`,
      [paper_id, folder_id]
    );

    res.json({
      success: true,
      message: 'Paper added to folder'
    });
  } catch (error) {
    console.error('Error adding paper to folder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add paper to folder'
    });
  }
};

// Remove paper from folder
const removePaperFromFolder = async (req, res) => {
  const { id: folder_id, paper_id } = req.params;
  const user_id = req.user.id;

  try {
    // Verify folder belongs to user
    const folderCheck = await pool.query(
      'SELECT id FROM paper_folders WHERE id = $1 AND user_id = $2',
      [folder_id, user_id]
    );

    if (folderCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    await pool.query(
      'DELETE FROM paper_folder_assignments WHERE paper_id = $1 AND folder_id = $2',
      [paper_id, folder_id]
    );

    res.json({
      success: true,
      message: 'Paper removed from folder'
    });
  } catch (error) {
    console.error('Error removing paper from folder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove paper from folder'
    });
  }
};

module.exports = {
  savePaper,
  unsavePaper,
  getSavedPapers,
  createFolder,
  getFolders,
  addPaperToFolder,
  removePaperFromFolder
};
