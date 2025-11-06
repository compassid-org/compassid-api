import express from 'express';
import Paper from '../models/Paper.js';
import fetch from 'node-fetch';
import * as papersController from '../src/controllers/papersController.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { authenticateToken } = require('../src/middleware/auth.cjs');
const researchController = require('../src/controllers/researchController.js');

const router = express.Router();

// Folders (must come before /:id routes)
router.post('/folders', authenticateToken, papersController.createFolder);
router.get('/folders', authenticateToken, papersController.getFolders);
router.post('/folders/:id/papers', authenticateToken, papersController.addPaperToFolder);
router.delete('/folders/:id/papers/:paper_id', authenticateToken, papersController.removePaperFromFolder);

// Saved papers (must come before generic /:id route)
router.post('/save', authenticateToken, papersController.savePaper);
router.get('/saved', authenticateToken, papersController.getSavedPapers);

// Search COMPASSID database - use actual database search from researchController
router.get('/search', researchController.searchResearch);

// Unsave paper (must come before generic /:id route)
router.delete('/:id', authenticateToken, papersController.unsavePaper);

// Get single paper by ID
router.get('/:id', async (req, res) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    res.json(paper);
  } catch (error) {
    console.error('Get paper error:', error);
    res.status(500).json({ error: 'Failed to fetch paper' });
  }
});

// Get paper by DOI
router.get('/doi/:doi', async (req, res) => {
  try {
    const paper = await Paper.findByDOI(decodeURIComponent(req.params.doi));
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    res.json(paper);
  } catch (error) {
    console.error('Get paper by DOI error:', error);
    res.status(500).json({ error: 'Failed to fetch paper' });
  }
});

// Search CrossRef for papers
router.get('/crossref/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const rows = parseInt(req.query.limit) || 20;
    const offset = (parseInt(req.query.page) || 1 - 1) * rows;

    const CROSSREF_API_BASE = 'https://api.crossref.org';
    const POLITE_EMAIL = 'contact@compassid.org';

    const searchUrl = `${CROSSREF_API_BASE}/works?query=${encodeURIComponent(query)}&rows=${rows}&offset=${offset}&mailto=${POLITE_EMAIL}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': `COMPASS ID Research Platform (mailto:${POLITE_EMAIL})`
      }
    });

    if (!response.ok) {
      throw new Error(`CrossRef API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Transform to our format
    const papers = (data.message.items || []).map(item => {
      let publicationDate = null;
      if (item.published) {
        const dateParts = item.published['date-parts']?.[0];
        if (dateParts) {
          const [year, month = 1, day = 1] = dateParts;
          publicationDate = new Date(year, month - 1, day).toISOString().split('T')[0];
        }
      }

      const authors = (item.author || []).map(author => ({
        name: `${author.given || ''} ${author.family || ''}`.trim(),
        orcid: author.ORCID ? author.ORCID.replace('http://orcid.org/', '') : null
      }));

      return {
        doi: item.DOI,
        title: Array.isArray(item.title) ? item.title[0] : item.title,
        abstract: item.abstract || null,
        authors: authors,
        publicationDate: publicationDate,
        journal: item['container-title']?.[0] || null,
        citationCount: item['is-referenced-by-count'] || 0,
        type: item.type || 'journal-article',
        source: 'crossref'
      };
    });

    res.json({
      papers,
      total: data.message['total-results'] || 0,
      page: parseInt(req.query.page) || 1,
      limit: rows
    });
  } catch (error) {
    console.error('CrossRef search error:', error);
    res.status(500).json({ error: 'Failed to search CrossRef', message: error.message });
  }
});

// Lookup paper metadata from CrossRef by DOI
router.get('/crossref/:doi', async (req, res) => {
  try {
    const doi = decodeURIComponent(req.params.doi);
    const CROSSREF_API_BASE = 'https://api.crossref.org';
    const POLITE_EMAIL = 'contact@compassid.org';

    const response = await fetch(
      `${CROSSREF_API_BASE}/works/${encodeURIComponent(doi)}?mailto=${POLITE_EMAIL}`,
      {
        headers: {
          'User-Agent': `COMPASS ID Research Platform (mailto:${POLITE_EMAIL})`
        }
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'DOI not found in CrossRef' });
      }
      throw new Error(`CrossRef API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const crossrefPaper = data.message;

    // Transform to our format
    let publicationDate = null;
    if (crossrefPaper.published) {
      const dateParts = crossrefPaper.published['date-parts']?.[0];
      if (dateParts) {
        const [year, month = 1, day = 1] = dateParts;
        publicationDate = new Date(year, month - 1, day).toISOString().split('T')[0];
      }
    }

    const authors = (crossrefPaper.author || []).map(author => ({
      given: author.given || '',
      family: author.family || '',
      name: `${author.given || ''} ${author.family || ''}`.trim(),
      orcid: author.ORCID ? author.ORCID.replace('http://orcid.org/', '') : null,
      affiliation: author.affiliation?.[0]?.name || null
    }));

    const paper = {
      doi: crossrefPaper.DOI,
      title: Array.isArray(crossrefPaper.title)
        ? crossrefPaper.title[0]
        : crossrefPaper.title,
      abstract: crossrefPaper.abstract || null,
      authors: authors,
      publicationDate: publicationDate,
      journal: crossrefPaper['container-title']?.[0] || null,
      volume: crossrefPaper.volume || null,
      issue: crossrefPaper.issue || null,
      pages: crossrefPaper.page || null,
      publisher: crossrefPaper.publisher || null,
      type: crossrefPaper.type || 'journal-article',
      citationCount: crossrefPaper['is-referenced-by-count'] || 0,
      references: crossrefPaper['reference-count'] || 0,
      subjects: crossrefPaper.subject || [],
      source: 'crossref'
    };

    res.json(paper);
  } catch (error) {
    console.error('CrossRef lookup error:', error);
    res.status(500).json({ error: 'Failed to fetch from CrossRef', message: error.message });
  }
});

// Claim paper (simplified - add auth later)
router.post('/:id/claim', async (req, res) => {
  try {
    const { orcid, authorName } = req.body;
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000000'; // TODO: Get from auth
    
    const paper = await Paper.claimPaper(req.params.id, userId, orcid);
    res.json(paper);
  } catch (error) {
    console.error('Claim paper error:', error);
    res.status(500).json({ error: 'Failed to claim paper' });
  }
});

// Add framework tags
router.post('/:id/frameworks', async (req, res) => {
  try {
    const { frameworks } = req.body;
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000000'; // TODO: Get from auth
    
    const results = [];
    for (const framework of frameworks) {
      const tag = await Paper.addFrameworkTag(req.params.id, userId, framework);
      results.push(tag);
    }
    
    // Return updated paper
    const paper = await Paper.findById(req.params.id);
    res.json(paper);
  } catch (error) {
    console.error('Add framework tags error:', error);
    res.status(500).json({ error: 'Failed to add framework tags' });
  }
});

// Add geographic tags
router.post('/:id/geography', async (req, res) => {
  try {
    const { locations } = req.body;
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000000';
    
    // TODO: Implement geographic tags
    res.json({ message: 'Geographic tags endpoint - to be implemented' });
  } catch (error) {
    console.error('Add geographic tags error:', error);
    res.status(500).json({ error: 'Failed to add geographic tags' });
  }
});

// Add taxonomic tags
router.post('/:id/taxonomy', async (req, res) => {
  try {
    const { taxa } = req.body;
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000000';
    
    // TODO: Implement taxonomic tags
    res.json({ message: 'Taxonomic tags endpoint - to be implemented' });
  } catch (error) {
    console.error('Add taxonomic tags error:', error);
    res.status(500).json({ error: 'Failed to add taxonomic tags' });
  }
});

// Add methodology tags
router.post('/:id/methods', async (req, res) => {
  try {
    const { methods } = req.body;
    const userId = req.user?.id || '00000000-0000-0000-0000-000000000000';
    
    // TODO: Implement methodology tags
    res.json({ message: 'Methodology tags endpoint - to be implemented' });
  } catch (error) {
    console.error('Add methodology tags error:', error);
    res.status(500).json({ error: 'Failed to add methodology tags' });
  }
});

// Import papers by ORCID
router.post('/import/orcid', async (req, res) => {
  try {
    const { orcid } = req.body;
    
    // TODO: Implement ORCID import using the ingestion service
    res.json({ message: 'ORCID import endpoint - to be implemented', orcid });
  } catch (error) {
    console.error('ORCID import error:', error);
    res.status(500).json({ error: 'Failed to import papers' });
  }
});

export default router;
