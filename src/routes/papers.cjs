const express = require('express');
const router = express.Router();
const researchController = require('../controllers/researchController');

// Import research intelligence for CrossRef
let fetchFromCrossRef;
try {
  const researchIntelligence = require('../services/researchIntelligence');
  fetchFromCrossRef = researchIntelligence.fetchFromCrossRef;
} catch (err) {
  console.warn('Research intelligence service not found. CrossRef search will be disabled.');
}

/**
 * GET /api/papers/search
 * Search COMPASSID database - alias to /api/research/search
 */
router.get('/search', researchController.searchResearch);

/**
 * GET /api/papers/crossref/search
 * Search CrossRef for new papers with user's query
 */
router.get('/crossref/search', async (req, res) => {
  try {
    const axios = require('axios');
    const { q, query, fromDate, toDate, limit = 50, page = 1 } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || !searchQuery.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required',
        message: 'Please provide a search query'
      });
    }

    // Set default date range (last 15 years to now for broader results)
    const defaultFromDate = new Date();
    defaultFromDate.setFullYear(defaultFromDate.getFullYear() - 15);

    const fromDateStr = fromDate ? new Date(fromDate).toISOString().split('T')[0] : defaultFromDate.toISOString().split('T')[0];
    const toDateStr = toDate ? new Date(toDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Build filter - make it less restrictive for better results
    let filter = `from-pub-date:${fromDateStr},until-pub-date:${toDateStr},type:journal-article`;

    // Detect if this is an author search (2-3 words that look like names)
    // Case-insensitive: "Troy Sternberg" or "troy sternberg" both work
    const words = searchQuery.trim().split(/\s+/);
    const looksLikeAuthorName = words.length >= 2 && words.length <= 3 &&
      words.every(word => /^[a-z]{2,}$/i.test(word) && word.length >= 3);

    // Build search params based on query type
    const searchParams = {
      'filter': filter,
      'rows': 200, // Fetch many results
      'select': 'DOI,title,abstract,author,published,container-title',
      'sort': 'relevance',
    };

    // If it looks like an author name, use author-specific search
    if (looksLikeAuthorName) {
      searchParams['query.author'] = searchQuery;
      console.log(`Detected author search for: "${searchQuery}"`);
    } else {
      searchParams['query.bibliographic'] = searchQuery;
      console.log(`Using bibliographic search for: "${searchQuery}"`);
    }

    // Search CrossRef
    const response = await axios.get('https://api.crossref.org/works', {
      params: searchParams,
      headers: {
        'User-Agent': 'COMPASSID/1.0 (https://compassid.org; mailto:contact@compassid.org)',
      },
    });

    console.log(`CrossRef search for "${searchQuery}" returned ${response.data.message.items?.length || 0} results`);

    const papers = response.data.message.items || [];

    // Transform to match frontend expectations
    const items = papers.map(item => ({
      doi: item.DOI,
      title: item.title ? item.title[0] : '',
      abstract: item.abstract || '',
      authors: item.author ? item.author.map(a => ({
        given: a.given || '',
        family: a.family || '',
        name: `${a.given || ''} ${a.family || ''}`.trim(),
      })) : [],
      publication_year: item.published?.['date-parts']?.[0]?.[0] || null,
      publicationDate: item.published?.['date-parts']?.[0]
        ? item.published['date-parts'][0].join('-')
        : null,
      journal: item['container-title'] ? item['container-title'][0] : null,
      coordinates: null, // Will be filled by AI if available
      source: 'crossref'
    }));

    // POST-SEARCH FILTERING
    // For author searches: only filter by author name (already filtered by CrossRef)
    // For other searches: ensure ALL search terms appear in title/abstract/authors
    const searchTerms = searchQuery.toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 2); // Ignore short words like "and", "in", "of"

    const filteredItems = items.filter(item => {
      // Include authors in the search text
      const authorsText = Array.isArray(item.authors)
        ? item.authors.map(a => a.name).join(' ')
        : '';
      const combinedText = `${item.title} ${item.abstract} ${authorsText}`.toLowerCase();
      const textWords = combinedText.split(/\W+/); // Split into words

      // If this was an author search, CrossRef already filtered by author - skip post-filtering
      if (looksLikeAuthorName) {
        return true; // Keep all results from author search
      }

      // For non-author searches: check if ALL search terms appear in the combined text
      // Use flexible matching for stemming (elephant/elephants, drone/drones)
      const allTermsPresent = searchTerms.every(searchTerm => {
        // Direct substring match (fastest, catches most cases)
        if (combinedText.includes(searchTerm)) return true;

        // Stemming logic: match if word and search term share a common stem
        // Only match if either:
        // 1. Word starts with search term (elephant starts with elepha)
        // 2. Search term starts with word (elephants starts with elephant)
        // This handles plural/singular without matching random substrings like "ant"
        return textWords.some(word => {
          const minLen = Math.min(word.length, searchTerm.length);
          // Only consider stemming if both are reasonably long (>= 4 chars)
          if (minLen < 4) return false;

          // Check if they share a common prefix of at least 4 characters
          // This matches: elephant/elephants, drone/drones, forest/forests
          // But NOT: ant/elephants, ele/elephants, plant/elephants
          return word.startsWith(searchTerm.slice(0, -1)) ||
                 searchTerm.startsWith(word.slice(0, -1));
        });
      });

      return allTermsPresent;
    });

    console.log(`After filtering for all terms: ${filteredItems.length} of ${items.length} results remain`);

    // APPLY PAGINATION: Return only the requested page of results
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedItems = filteredItems.slice(startIndex, endIndex);

    console.log(`Returning page ${page}: ${paginatedItems.length} items (index ${startIndex}-${endIndex} of ${filteredItems.length} total)`);

    res.json({
      data: {
        items: paginatedItems,  // Return ONLY current page
        total: filteredItems.length,  // Total count for pagination UI
        query: searchQuery,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('CrossRef Search Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search CrossRef',
      message: error.message
    });
  }
});

module.exports = router;
