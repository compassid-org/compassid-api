/**
 * Bulk Import Conservation Papers from CrossRef with AI Metadata
 *
 * This script searches CrossRef for conservation-related papers using keywords
 * from config/conservation-queries.json, extracts AI metadata for each paper,
 * and saves them to the COMPASSID database.
 *
 * Features:
 * - Searches CrossRef using conservation keywords and author names (Troy Sternberg)
 * - Filters papers (1990-2025, must have abstract and DOI)
 * - Removes duplicates by DOI
 * - Calls AI service for comprehensive metadata extraction
 * - Saves to research_items and compass_metadata tables
 * - Rate limiting: 2 papers every 3 seconds
 * - Progress logging every 50 papers
 * - CRASH RECOVERY: Caches collected papers to disk before AI processing
 * - CHECKPOINT RESUME: Saves progress every 50 papers, resumes automatically
 *
 * Crash Recovery:
 *   If the script crashes during AI processing, papers are cached to disk.
 *   Simply re-run the script and it will automatically resume from the last checkpoint.
 *   Cache location: cache/collected-papers.json
 *   Checkpoint location: cache/processing-checkpoint.json
 *
 * Usage:
 *   node scripts/bulk-import-conservation-papers.js [limit] [--collect-only|--process-only]
 *
 * Examples (All-in-one mode):
 *   node scripts/bulk-import-conservation-papers.js        # Collect + process 1000 papers
 *   node scripts/bulk-import-conservation-papers.js 100    # Collect + process 100 papers
 *
 * Examples (Two-phase mode - RECOMMENDED for large imports):
 *   Phase 1 - Collection (fast, free):
 *   node scripts/bulk-import-conservation-papers.js 150000 --collect-only
 *
 *   Phase 2 - AI Processing (slow, costs $):
 *   a) Process all papers at once:
 *   node scripts/bulk-import-conservation-papers.js --process-only
 *
 *   b) Process in batches (RECOMMENDED - better control):
 *   Quality Testing (start with small batches):
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 500
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 500 --limit 500
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 1000 --limit 1000
 *
 *   Full Processing (after quality validation):
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 1000
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 1000 --limit 1000
 *   node scripts/bulk-import-conservation-papers.js --process-only --start 2000 --limit 1000
 *   ... continue as needed
 *
 * Why two-phase?
 *   - Separate fast (collection) from slow (AI processing)
 *   - Inspect collected papers before spending on AI
 *   - Process in controlled batches (~$0.65 per 500, ~$1.30 per 1K batch)
 *   - Start small (500) to test quality, then scale up (1K+)
 *   - Stop and inspect quality between batches
 *   - No AI cost wasted on duplicates found later
 */

const pool = require('../src/config/database.cjs');
const { extractComprehensiveMetadata } = require('../services/claudeService');
const conservationQueries = require('../config/conservation-queries.json');
const fs = require('fs');
const path = require('path');

// Configuration
const CROSSREF_API_BASE = 'https://api.crossref.org/works';
const CROSSREF_RATE_LIMIT_MS = 1000; // 1 request per second (being polite)
const AI_BATCH_SIZE = 2; // Process 2 papers at a time
const AI_BATCH_DELAY_MS = 3000; // 3 seconds between batches
const PROGRESS_INTERVAL = 50; // Log progress every 50 papers
const DEFAULT_LIMIT = 1000; // Default number of papers to import
const CHECKPOINT_INTERVAL = 50; // Save checkpoint every 50 papers

// Directories for persistence
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const PAPERS_CACHE_PREFIX = 'collected-papers';
const CHECKPOINT_FILE = path.join(CACHE_DIR, 'processing-checkpoint.json');
const CHUNK_SIZE = 10000; // Save 10K papers per file to avoid "Invalid string length" error

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Parse command line arguments
const args = process.argv.slice(2);
let TARGET_PAPERS = DEFAULT_LIMIT;
let COLLECT_ONLY = false;
let PROCESS_ONLY = false;
let BATCH_START = 0;
let BATCH_LIMIT = null; // null means process all remaining papers

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--collect-only') {
    COLLECT_ONLY = true;
  } else if (arg === '--process-only') {
    PROCESS_ONLY = true;
  } else if (arg === '--start' && i + 1 < args.length) {
    BATCH_START = parseInt(args[i + 1]);
    i++; // Skip next arg since we consumed it
  } else if (arg === '--limit' && i + 1 < args.length) {
    BATCH_LIMIT = parseInt(args[i + 1]);
    i++; // Skip next arg since we consumed it
  } else if (!isNaN(parseInt(arg))) {
    TARGET_PAPERS = parseInt(arg);
  }
}

// Stats tracking
const stats = {
  startTime: Date.now(),
  crossrefSearches: 0,
  crossrefPapers: 0,
  duplicatesSkipped: 0,
  noAbstractSkipped: 0,
  preAIFilterSkipped: 0,
  aiProcessed: 0,
  aiSuccessful: 0,
  aiFailed: 0,
  falsePositivesSkipped: 0,
  dbInserted: 0,
  dbFailed: 0,
  totalCost: 0, // Estimated cost in dollars
  errors: []
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search CrossRef for papers matching a query
 */
async function searchCrossRef(query, rows = 50, offset = 0) {
  const params = new URLSearchParams({
    query: query,
    rows: rows,
    offset: offset,
    filter: 'from-pub-date:1990-01-01,until-pub-date:2025-12-31,has-abstract:true,type:journal-article',
    mailto: 'contact@compassid.org' // Polite pool for higher rate limits
  });

  const url = `${CROSSREF_API_BASE}?${params.toString()}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CrossRef API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    stats.crossrefSearches++;

    return {
      items: data.message.items || [],
      totalResults: data.message['total-results'] || 0
    };
  } catch (error) {
    console.error(`Error searching CrossRef for "${query}":`, error.message);
    stats.errors.push({ type: 'crossref_search', query, error: error.message });
    return { items: [], totalResults: 0 };
  }
}

/**
 * Search CrossRef by author name
 */
async function searchCrossRefByAuthor(authorName, rows = 50, offset = 0) {
  const params = new URLSearchParams({
    'query.author': authorName,
    rows: rows,
    offset: offset,
    filter: 'from-pub-date:1990-01-01,until-pub-date:2025-12-31,has-abstract:true,type:journal-article',
    mailto: 'contact@compassid.org'
  });

  const url = `${CROSSREF_API_BASE}?${params.toString()}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CrossRef API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    stats.crossrefSearches++;

    return {
      items: data.message.items || [],
      totalResults: data.message['total-results'] || 0
    };
  } catch (error) {
    console.error(`Error searching CrossRef for author "${authorName}":`, error.message);
    stats.errors.push({ type: 'crossref_author_search', author: authorName, error: error.message });
    return { items: [], totalResults: 0 };
  }
}

/**
 * Normalize CrossRef paper to our format
 */
function normalizeCrossRefPaper(item) {
  // Extract abstract (CrossRef stores it in different places)
  let abstract = null;
  if (item.abstract) {
    abstract = item.abstract;
  } else if (item['short-container-title']?.length > 0) {
    // Some papers have abstract in other fields, but usually it's missing if not in 'abstract'
    abstract = null;
  }

  // Parse title (CrossRef returns arrays)
  const title = Array.isArray(item.title) ? item.title[0] : item.title;

  // Parse authors
  let authors = 'Unknown';
  if (item.author && item.author.length > 0) {
    authors = item.author.map(a => {
      const given = a.given || '';
      const family = a.family || '';
      return `${given} ${family}`.trim();
    }).filter(Boolean).join(', ');
  }

  // Parse year and publication date
  let year = null;
  let publicationDate = null;

  // Try different date fields in order of preference
  const dateFields = ['published', 'published-print', 'published-online', 'issued', 'created'];
  for (const field of dateFields) {
    if (item[field] && item[field]['date-parts'] && item[field]['date-parts'][0]) {
      const parts = item[field]['date-parts'][0];
      const rawYear = parts[0];

      // Validate year is within a reasonable range for modern publications
      // PostgreSQL DATE type supports: 4713 BC to 294276 AD
      // We use 1500-2100 for conservation science papers (allows historical works)
      if (rawYear && rawYear >= 1500 && rawYear <= 2100) {
        year = rawYear;
        const month = parts[1] || 1;  // Default to January
        const day = parts[2] || 1;     // Default to 1st

        // Additional validation: ensure valid month and day
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          publicationDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        } else {
          // Invalid month/day, just use year with Jan 1st
          publicationDate = `${year}-01-01`;
        }
        break;
      } else if (rawYear && rawYear >= 1900 && rawYear <= 2100) {
        // For papers outside our date range, still record the year (for display) but no publication_date
        year = rawYear;
        publicationDate = null;
        break;
      }
    }
  }

  // Parse journal
  const journal = item['container-title'] && item['container-title'].length > 0
    ? item['container-title'][0]
    : null;

  // Parse DOI
  const doi = item.DOI || null;

  // Parse citations
  const citations = item['is-referenced-by-count'] || 0;

  return {
    title,
    abstract,
    authors,
    year,
    publicationDate,
    journal,
    doi,
    citations,
    source: 'CrossRef',
    url: doi ? `https://doi.org/${doi}` : null,
    rawCrossRef: item // Keep raw data for debugging
  };
}

/**
 * Check if paper already exists in database by DOI
 */
async function paperExists(doi) {
  try {
    const result = await pool.query(
      'SELECT id FROM research_items WHERE doi = $1',
      [doi]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`Error checking if paper exists (DOI: ${doi}):`, error.message);
    return false; // Assume it doesn't exist if query fails
  }
}

/**
 * Save collected papers to disk cache in chunks to avoid "Invalid string length" error
 */
function savePapersCache(papers) {
  try {
    const papersArray = Array.from(papers.values());
    const totalPapers = papersArray.length;
    const numChunks = Math.ceil(totalPapers / CHUNK_SIZE);

    console.log(`\nSaving ${totalPapers} papers in ${numChunks} chunks...`);

    for (let i = 0; i < numChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalPapers);
      const chunk = papersArray.slice(start, end);
      const chunkFile = path.join(CACHE_DIR, `${PAPERS_CACHE_PREFIX}-${i}.json`);

      fs.writeFileSync(chunkFile, JSON.stringify(chunk, null, 2));
      console.log(`  ✓ Chunk ${i + 1}/${numChunks}: Saved ${chunk.length} papers to ${chunkFile}`);
    }

    console.log(`✓ Successfully saved all ${totalPapers} papers in ${numChunks} chunks`);
    return true;
  } catch (error) {
    console.error(`Error saving papers cache:`, error.message);
    return false;
  }
}

/**
 * Count cached papers efficiently without loading all data into memory
 * This is much faster and uses minimal memory compared to loadPapersCache()
 */
function countCachedPapers() {
  try {
    // Find all chunk files
    const files = fs.readdirSync(CACHE_DIR);
    const chunkFiles = files
      .filter(f => f.startsWith(PAPERS_CACHE_PREFIX) && f.endsWith('.json'))
      .sort((a, b) => {
        // Extract chunk number and sort numerically
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

    if (chunkFiles.length === 0) {
      return 0;
    }

    let totalCount = 0;

    for (const file of chunkFiles) {
      const filePath = path.join(CACHE_DIR, file);
      const data = fs.readFileSync(filePath, 'utf8');
      const chunk = JSON.parse(data);
      totalCount += chunk.length;
    }

    return totalCount;
  } catch (error) {
    console.error(`Error counting cached papers:`, error.message);
    return 0;
  }
}

/**
 * Load collected papers from disk cache (from all chunk files)
 */
function loadPapersCache() {
  try {
    // Find all chunk files
    const files = fs.readdirSync(CACHE_DIR);
    const chunkFiles = files
      .filter(f => f.startsWith(PAPERS_CACHE_PREFIX) && f.endsWith('.json'))
      .sort((a, b) => {
        // Extract chunk number and sort numerically
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

    if (chunkFiles.length === 0) {
      return null;
    }

    console.log(`\nLoading papers from ${chunkFiles.length} cache chunks...`);
    let allPapers = [];

    for (const file of chunkFiles) {
      const filePath = path.join(CACHE_DIR, file);
      const data = fs.readFileSync(filePath, 'utf8');
      const chunk = JSON.parse(data);
      allPapers = allPapers.concat(chunk);
      console.log(`  ✓ Loaded ${chunk.length} papers from ${file}`);
    }

    console.log(`✓ Successfully loaded ${allPapers.length} total papers from cache`);
    return allPapers;
  } catch (error) {
    console.error(`Error loading papers cache:`, error.message);
    return null;
  }
}

/**
 * Save checkpoint during AI processing
 */
function saveCheckpoint(processedCount, totalCount) {
  try {
    const checkpoint = {
      processedCount,
      totalCount,
      timestamp: new Date().toISOString(),
      stats: { ...stats }
    };
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
    return true;
  } catch (error) {
    console.error(`Error saving checkpoint:`, error.message);
    return false;
  }
}

/**
 * Load checkpoint to resume processing
 */
function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
      const checkpoint = JSON.parse(data);
      console.log(`✓ Loaded checkpoint: ${checkpoint.processedCount}/${checkpoint.totalCount} papers processed`);
      return checkpoint;
    }
    return null;
  } catch (error) {
    console.error(`Error loading checkpoint:`, error.message);
    return null;
  }
}

/**
 * Clear cache and checkpoint files
 */
function clearCache() {
  try {
    // Clear all chunk files
    const files = fs.readdirSync(CACHE_DIR);
    const chunkFiles = files.filter(f => f.startsWith(PAPERS_CACHE_PREFIX) && f.endsWith('.json'));

    for (const file of chunkFiles) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }

    if (chunkFiles.length > 0) {
      console.log(`✓ Cleared ${chunkFiles.length} cache chunk files`);
    }

    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
      console.log('✓ Cleared checkpoint');
    }
  } catch (error) {
    console.error(`Error clearing cache:`, error.message);
  }
}

/**
 * Save paper to database (research_items + compass_metadata)
 */
async function savePaper(paper, metadata) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // System user ID for bulk imports
    const SYSTEM_USER_ID = '7535aea0-5501-4da4-80ac-d0a4d1f88b24';

    // Convert authors string to JSONB array format
    const authorsJsonb = paper.authors
      ? JSON.stringify(paper.authors.split(', ').map(name => name.trim()))
      : JSON.stringify([]);

    // Insert into research_items
    const paperResult = await client.query(
      `INSERT INTO research_items (user_id, title, abstract, authors, publication_year, publication_date, journal, doi, citations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        SYSTEM_USER_ID,
        paper.title,
        paper.abstract,
        authorsJsonb,
        paper.year,
        paper.publicationDate,
        paper.journal,
        paper.doi,
        paper.citations
      ]
    );

    const paperId = paperResult.rows[0].id;

    // Prepare JSONB data - methods field stores simple array of research methods
    const methodsJson = metadata.research_methods && metadata.research_methods.length > 0
      ? JSON.stringify(metadata.research_methods)
      : JSON.stringify([]);
    const taxonJson = metadata.taxonomic_coverage && metadata.taxonomic_coverage.length > 0
      ? JSON.stringify(metadata.taxonomic_coverage)
      : null;
    const frameworksJson = metadata.frameworks && metadata.frameworks.length > 0
      ? JSON.stringify(metadata.frameworks)
      : JSON.stringify([]);

    // Prepare ecosystem type (single value, take first one)
    const ecosystemType = metadata.ecosystem_types && metadata.ecosystem_types.length > 0
      ? metadata.ecosystem_types[0]
      : null;

    // Prepare temporal dates
    const temporalStart = metadata.temporal_range && metadata.temporal_range.start
      ? `${metadata.temporal_range.start}-01-01`
      : null;
    const temporalEnd = metadata.temporal_range && metadata.temporal_range.end
      ? `${metadata.temporal_range.end}-12-31`
      : null;

    // Insert into compass_metadata
    await client.query(
      `INSERT INTO compass_metadata
       (research_id, ecosystem_type, methods, taxon_scope, framework_alignment,
        geo_scope_text, temporal_start, temporal_end, geo_scope_geom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        paperId,
        ecosystemType,
        methodsJson,
        taxonJson,
        frameworksJson,
        metadata.location ? metadata.location.name : metadata.geographic_scope,
        temporalStart,
        temporalEnd,
        metadata.location && metadata.location.latitude && metadata.location.longitude
          ? JSON.stringify({
              type: 'Point',
              coordinates: [metadata.location.longitude, metadata.location.latitude]
            })
          : null
      ]
    );

    await client.query('COMMIT');
    stats.dbInserted++;

    return { success: true, paperId };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error saving paper "${paper.title?.substring(0, 50)}...":`, error.message);
    stats.dbFailed++;
    stats.errors.push({
      type: 'db_insert',
      title: paper.title?.substring(0, 100),
      error: error.message
    });
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Check if paper is an obvious false positive BEFORE calling AI
 * This saves money by filtering out junk papers before AI extraction
 */
function isObviousFalsePositive(paper) {
  const text = ((paper.title || '') + ' ' + (paper.abstract || '')).toLowerCase();

  // CBD false positives (cannabidiol vs. Convention on Biological Diversity)
  if (text.includes('cannabidiol')) return true;
  if (text.includes('cannabis sativa') || text.includes('cannabis indica')) return true;
  if (text.includes('central business district')) return true;
  if (text.includes('cbd oil') || text.includes('cbd extract')) return true;

  // Medical/clinical false positives (human health, not conservation)
  if (text.includes('post-stroke')) return true;
  if (text.includes('post-operative') || text.includes('postoperative')) return true;
  if (text.includes('post-surgical')) return true;
  if (text.includes('clinical trial') && !text.includes('species')) return true;
  if (text.includes('randomized controlled trial')) return true;
  if (text.includes('gastroenteritis')) return true;
  if (text.includes('virus genotype') || text.includes('viral genotype')) return true;
  if (text.includes('acute') && text.includes('disease') && !text.includes('wildlife')) return true;
  if (text.includes('hospitalized') && !text.includes('wildlife')) return true;
  if (text.includes('patients') && !text.includes('wildlife') && !text.includes('conservation')) return true;
  if (text.includes('medical treatment') && !text.includes('wildlife')) return true;
  if (text.includes('therapeutic') && !text.includes('wildlife') && !text.includes('conservation')) return true;
  if (text.includes('pharmacological') && !text.includes('wildlife')) return true;
  if (text.includes('pathogenesis') && !text.includes('wildlife')) return true;
  if (text.includes('diagnosis') && !text.includes('wildlife')) return true;

  // Cardiovascular/treatment medical terms (like ischemia/apheresis example)
  if (text.includes('ischemia') || text.includes('ischaemic') || text.includes('ischemic')) return true;
  if (text.includes('apheresis')) return true;
  if (text.includes('ldl-c') || text.includes('ldl cholesterol') || text.includes('low-density lipoprotein')) return true;
  if (text.includes('fibrinogen') && !text.includes('wildlife')) return true;
  if (text.includes('limb-threatening') || text.includes('limb threatening')) return true;
  if (text.includes('perfusion pressure')) return true;
  if (text.includes('angiography') && !text.includes('wildlife')) return true;
  if (text.includes('chronic limb')) return true;
  if (text.includes('wound healing') && text.includes('ulcer') && !text.includes('wildlife')) return true;

  // Physics/engineering false positives
  if (text.includes('quantum') && !text.includes('ecology')) return true;
  if (text.includes('graphite') || text.includes('graphene')) return true;
  if (text.includes('nano-bridge') || text.includes('nanobridge')) return true;
  if (text.includes('superconducting') || text.includes('superconductor')) return true;

  // Computer science/AI false positives (not ecological modeling)
  if (text.includes('fuzzy system') && !text.includes('species') && !text.includes('ecological')) return true;
  if (text.includes('fuzzy logic') && !text.includes('species') && !text.includes('ecological')) return true;
  if (text.includes('fuzzy clustering') && !text.includes('species')) return true;
  if (text.includes('computational intelligence') && !text.includes('species') && !text.includes('ecological')) return true;

  // Mining/extraction false positives (not environmental impact studies)
  if (text.includes('lignite mine') || text.includes('coal mine')) return true;
  if (text.includes('abandoned mine') && !text.includes('ecological')) return true;
  if (text.includes('cavity-filling') || text.includes('cavity filling')) return true;
  if (text.includes('mine exploration') || text.includes('mining exploration')) return true;
  if (text.includes('underground cavity') || text.includes('underground space')) return true;
  if (text.includes('robotic exploration system') && !text.includes('wildlife')) return true;

  // Disaster response/robotics false positives (not ecological disaster impacts)
  if (text.includes('robot technology') && text.includes('disaster') && !text.includes('ecological')) return true;
  if (text.includes('evacuation support') || text.includes('disaster robot')) return true;
  if (text.includes('rescue robot') && !text.includes('wildlife')) return true;
  if (text.includes('robot') && text.includes('earthquake') && text.includes('flood') && !text.includes('ecological')) return true;

  // Business/economics false positives
  if (text.includes('stock price') || text.includes('stock market')) return true;
  if (text.includes('financial stability') && !text.includes('ecosystem')) return true;
  if (text.includes('trade dispute') && !text.includes('wildlife')) return true;

  // Other obvious false positives
  if (paper.title && paper.title.toLowerCase().trim() === 'poems') return true;
  if (text.includes('post-pandemic') && text.includes('consumer behavior')) return true;
  if (text.includes('post-covid') && !text.includes('wildlife') && !text.includes('conservation')) return true;

  return false;
}

/**
 * Process a single paper: extract AI metadata and save to database
 */
async function processPaper(paper) {
  // Check if paper has abstract
  if (!paper.abstract || paper.abstract.length < 50) {
    stats.noAbstractSkipped++;
    return { success: false, reason: 'no_abstract' };
  }

  // Check if paper already exists
  if (await paperExists(paper.doi)) {
    stats.duplicatesSkipped++;
    return { success: false, reason: 'duplicate' };
  }

  // Pre-AI filter: catch obvious false positives BEFORE calling AI (saves money!)
  if (isObviousFalsePositive(paper)) {
    stats.preAIFilterSkipped++;
    return { success: false, reason: 'pre_ai_filter' };
  }

  // Extract AI metadata
  stats.aiProcessed++;
  const aiResult = await extractComprehensiveMetadata({
    title: paper.title,
    abstract: paper.abstract
  });

  if (!aiResult.success) {
    console.error(`AI extraction failed for "${paper.title?.substring(0, 50)}...": ${aiResult.error}`);
    stats.aiFailed++;
    stats.errors.push({
      type: 'ai_extraction',
      title: paper.title?.substring(0, 100),
      error: aiResult.error
    });
    return { success: false, reason: 'ai_failed' };
  }

  stats.aiSuccessful++;

  // Estimate cost (Haiku: $0.25 per 1M input tokens, $1.25 per 1M output tokens)
  const tokensUsed = aiResult.metadata.tokensUsed || 0;
  const estimatedCost = (tokensUsed / 1000000) * 0.75; // Average of input/output
  stats.totalCost += estimatedCost;

  // Pre-AI filter already caught obvious false positives (medical, business, engineering)
  // Trust the AI extraction for papers that made it through pre-AI filter
  const metadata = aiResult.data;

  // Save to database
  const saveResult = await savePaper(paper, aiResult.data);

  return saveResult;
}

/**
 * Process papers in batches with rate limiting
 */
async function processPaperBatch(papers) {
  const results = [];

  // Process in batches of AI_BATCH_SIZE
  for (let i = 0; i < papers.length; i += AI_BATCH_SIZE) {
    const batch = papers.slice(i, i + AI_BATCH_SIZE);

    // Process batch in parallel
    const batchPromises = batch.map(paper => processPaper(paper));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Rate limiting: wait before next batch
    if (i + AI_BATCH_SIZE < papers.length) {
      await sleep(AI_BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Log progress
 */
function logProgress(current, total) {
  const elapsed = (Date.now() - stats.startTime) / 1000; // seconds
  const rate = current / elapsed; // papers per second
  const remaining = total - current;
  const eta = remaining / rate; // seconds

  console.log('\n' + '='.repeat(80));
  console.log(`Progress: ${current} / ${total} papers (${Math.round((current / total) * 100)}%)`);
  console.log(`Time elapsed: ${Math.round(elapsed)}s | ETA: ${Math.round(eta)}s`);
  console.log(`Rate: ${rate.toFixed(2)} papers/sec`);
  console.log('-'.repeat(80));
  console.log(`CrossRef searches: ${stats.crossrefSearches} | Papers found: ${stats.crossrefPapers}`);
  console.log(`Duplicates skipped: ${stats.duplicatesSkipped} | No abstract: ${stats.noAbstractSkipped}`);
  console.log(`Pre-AI filter skipped: ${stats.preAIFilterSkipped} (saved $${(stats.preAIFilterSkipped * 0.002).toFixed(2)})`);
  console.log(`AI processed: ${stats.aiProcessed} | Success: ${stats.aiSuccessful} | Failed: ${stats.aiFailed}`);
  console.log(`False positives skipped: ${stats.falsePositivesSkipped}`);
  console.log(`DB inserted: ${stats.dbInserted} | Failed: ${stats.dbFailed}`);
  console.log(`Estimated cost: $${stats.totalCost.toFixed(2)}`);
  console.log('='.repeat(80) + '\n');
}

/**
 * Main import function
 */
async function bulkImport() {
  console.log('\n' + '='.repeat(80));
  console.log('COMPASSID Bulk Import - Conservation Papers from CrossRef');
  console.log('='.repeat(80));
  console.log(`Mode: ${COLLECT_ONLY ? 'COLLECT ONLY' : PROCESS_ONLY ? 'PROCESS ONLY' : 'COLLECT + PROCESS'}`);
  if (PROCESS_ONLY && (BATCH_START > 0 || BATCH_LIMIT !== null)) {
    const batchEnd = BATCH_LIMIT ? BATCH_START + BATCH_LIMIT : 'end';
    console.log(`Batch: Papers ${BATCH_START} to ${batchEnd}`);
  }
  console.log(`Target: ${TARGET_PAPERS} papers`);
  console.log(`Date range: 1990-2025 (35 years - includes foundational work)`);
  console.log(`Search queries: 299 conservation queries across 12 categories`);
  if (!COLLECT_ONLY) {
    console.log(`AI rate limit: ${AI_BATCH_SIZE} papers every ${AI_BATCH_DELAY_MS}ms`);
  }
  console.log(`Cache directory: ${CACHE_DIR}`);
  console.log('='.repeat(80) + '\n');

  try {
    let papers = [];
    let startIndex = 0;

    // PROCESS-ONLY MODE: Load from cache and process only
    if (PROCESS_ONLY) {
      console.log('PROCESS-ONLY MODE: Loading papers from cache...\n');

      const cachedPapers = loadPapersCache();
      if (!cachedPapers || cachedPapers.length === 0) {
        console.error('ERROR: No cached papers found. Run with --collect-only first.\n');
        process.exit(1);
      }

      // Count total papers and apply batch parameters
      const totalCachedPapers = cachedPapers.length;
      const batchEnd = BATCH_LIMIT ? BATCH_START + BATCH_LIMIT : totalCachedPapers;
      papers = cachedPapers.slice(BATCH_START, batchEnd);

      // CRITICAL: Clear cachedPapers from memory to prevent heap crash
      // We only need the sliced 'papers' array (500 items), not all 188K papers
      cachedPapers.length = 0; // Clear array contents

      console.log(`✓ Loaded ${totalCachedPapers} total papers from cache`);
      if (BATCH_LIMIT) {
        console.log(`✓ Processing batch: papers ${BATCH_START} to ${batchEnd - 1} (${papers.length} papers)`);
      } else {
        console.log(`✓ Processing from paper ${BATCH_START} to end (${papers.length} papers)`);
      }
      console.log('');

      // For batch processing, always start from index 0 (we already sliced the array)
      startIndex = 0;

      // Skip to AI processing phase
    } else {
      // COLLECT MODE: Check for cached papers or collect fresh
      const cachedPapers = loadPapersCache();

      if (cachedPapers && cachedPapers.length > 0 && !COLLECT_ONLY) {
        console.log('✓ Found cached papers from previous run\n');
        papers = cachedPapers;

        const checkpoint = loadCheckpoint();
        if (checkpoint) {
          startIndex = checkpoint.processedCount;
          console.log(`✓ Resuming from checkpoint: ${startIndex}/${papers.length} papers\n`);
        }
      } else {
        if (COLLECT_ONLY && cachedPapers && cachedPapers.length > 0) {
          console.log('WARNING: Cache exists but will be overwritten with fresh collection.\n');
        }
        console.log('Starting fresh collection from CrossRef...\n');

      // Collect all unique papers
      const allPapers = new Map(); // Use Map to deduplicate by DOI

      // Step 1: Search by conservation keywords
      console.log('Step 1: Searching CrossRef by conservation keywords...\n');

    const searchCategories = [
      { name: 'Frameworks', queries: conservationQueries.frameworks },
      { name: 'Conservation General', queries: conservationQueries.conservation_general },
      { name: 'Climate & Biodiversity', queries: conservationQueries.climate_biodiversity },
      { name: 'Ecosystems', queries: conservationQueries.ecosystems },
      { name: 'Conservation Methods', queries: conservationQueries.conservation_methods },
      { name: 'Sustainability', queries: conservationQueries.sustainability },
      { name: 'Countries & Regions', queries: conservationQueries.countries_regions },
      { name: 'Taxonomic Groups', queries: conservationQueries.taxonomic_groups },
      { name: 'Iconic & Threatened Species', queries: conservationQueries.iconic_threatened_species },
      { name: 'Threats', queries: conservationQueries.threats },
      { name: 'Conservation Interventions', queries: conservationQueries.conservation_interventions },
      { name: 'Traditional Ecological Knowledge', queries: conservationQueries.traditional_ecological_knowledge }
    ];

    for (const category of searchCategories) {
      console.log(`Searching ${category.name} queries...`);

      for (const query of category.queries) {
        // Pagination: Fetch multiple pages for each query
        const PAPERS_PER_PAGE = 100; // CrossRef supports up to 1000, but 100 is safer
        const MAX_PAGES = 10; // Maximum 10 pages per query (1000 papers per query max)
        let totalFetchedForQuery = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
          const offset = page * PAPERS_PER_PAGE;
          const result = await searchCrossRef(query, PAPERS_PER_PAGE, offset);

          // If no results on this page, stop paginating this query
          if (result.items.length === 0) break;

          totalFetchedForQuery += result.items.length;

          for (const item of result.items) {
            const paper = normalizeCrossRefPaper(item);
            if (paper.doi && paper.abstract) {
              allPapers.set(paper.doi, paper);
            }
          }

          stats.crossrefPapers += result.items.length;

          // Rate limiting for CrossRef
          await sleep(CROSSREF_RATE_LIMIT_MS);

          // Check if we have enough papers
          if (allPapers.size >= TARGET_PAPERS) {
            console.log(`\nReached target of ${TARGET_PAPERS} papers. Stopping search.`);
            break;
          }

          // If we got fewer results than requested, no more pages available
          if (result.items.length < PAPERS_PER_PAGE) break;
        }

        console.log(`  - "${query}": ${totalFetchedForQuery} papers (${allPapers.size} unique total)`);

        // Check if we have enough papers
        if (allPapers.size >= TARGET_PAPERS) {
          console.log(`\nReached target of ${TARGET_PAPERS} papers. Stopping search.`);
          break;
        }
      }

      if (allPapers.size >= TARGET_PAPERS) break;

      // INCREMENTAL SAVE: Save progress after each category to prevent data loss on crash
      console.log(`Saving ${allPapers.size} papers to cache...`);
      savePapersCache(allPapers);
      console.log(`✓ Cache saved\n`);
    }

    // Step 2: Search by author (Troy Sternberg)
    if (allPapers.size < TARGET_PAPERS && conservationQueries.authors.length > 0) {
      console.log('\nStep 2: Searching CrossRef by author names...\n');

      for (const author of conservationQueries.authors) {
        // Pagination for author search
        const PAPERS_PER_PAGE = 100;
        const MAX_PAGES = 5; // Maximum 5 pages per author (500 papers per author max)
        let totalFetchedForAuthor = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
          const offset = page * PAPERS_PER_PAGE;
          const result = await searchCrossRefByAuthor(author, PAPERS_PER_PAGE, offset);

          if (result.items.length === 0) break;

          totalFetchedForAuthor += result.items.length;

          for (const item of result.items) {
            const paper = normalizeCrossRefPaper(item);
            if (paper.doi && paper.abstract) {
              allPapers.set(paper.doi, paper);
            }
          }

          stats.crossrefPapers += result.items.length;

          // Rate limiting for CrossRef
          await sleep(CROSSREF_RATE_LIMIT_MS);

          // Check if we have enough papers
          if (allPapers.size >= TARGET_PAPERS) break;

          // If we got fewer results than requested, no more pages available
          if (result.items.length < PAPERS_PER_PAGE) break;
        }

        console.log(`  - Found ${totalFetchedForAuthor} papers by ${author} (${allPapers.size} unique total)`);

        if (allPapers.size >= TARGET_PAPERS) break;
      }

      // INCREMENTAL SAVE: Save progress after author search
      if (conservationQueries.authors.length > 0) {
        console.log(`Saving ${allPapers.size} papers to cache...`);
        savePapersCache(allPapers);
        console.log(`✓ Cache saved\n`);
      }
    }

        console.log(`\nTotal unique papers collected: ${allPapers.size}`);

        // Save papers to disk cache BEFORE AI processing
        papers = Array.from(allPapers.values()).slice(0, TARGET_PAPERS);
        savePapersCache(allPapers);
        console.log('');

        // If COLLECT-ONLY mode, stop here
        if (COLLECT_ONLY) {
          console.log('\n' + '='.repeat(80));
          console.log('COLLECTION COMPLETE (COLLECT-ONLY MODE)');
          console.log('='.repeat(80));
          console.log(`Total unique papers collected: ${allPapers.size}`);
          console.log(`\nTo process these papers with AI, run:`);
          console.log(`  node scripts/bulk-import-conservation-papers.js --process-only`);
          console.log('='.repeat(80) + '\n');
          return;
        }
      }
    }

    // Step 3: Process papers with AI metadata extraction and database insertion
    console.log(`Starting AI metadata extraction and database insertion...\n`);
    console.log(`Total papers to process: ${papers.length}`);
    console.log(`Starting at index: ${startIndex}\n`);

    let processed = startIndex;

    for (let i = startIndex; i < papers.length; i += AI_BATCH_SIZE) {
      const batch = papers.slice(i, Math.min(i + AI_BATCH_SIZE, papers.length));

      await processPaperBatch(batch);
      processed += batch.length;

      // Save checkpoint every CHECKPOINT_INTERVAL papers
      if (processed % CHECKPOINT_INTERVAL === 0 || processed === papers.length) {
        saveCheckpoint(processed, papers.length);
      }

      // Log progress every PROGRESS_INTERVAL papers
      if (processed % PROGRESS_INTERVAL === 0 || processed === papers.length) {
        logProgress(processed, papers.length);
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('IMPORT COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total papers inserted: ${stats.dbInserted}`);
    console.log(`Total duplicates skipped: ${stats.duplicatesSkipped}`);
    console.log(`Total papers without abstract: ${stats.noAbstractSkipped}`);
    console.log(`Total false positives skipped: ${stats.falsePositivesSkipped}`);
    console.log(`Total AI extraction failures: ${stats.aiFailed}`);
    console.log(`Total database insertion failures: ${stats.dbFailed}`);
    console.log(`Total estimated cost: $${stats.totalCost.toFixed(2)}`);
    console.log(`Total time: ${Math.round((Date.now() - stats.startTime) / 1000)}s`);
    console.log('='.repeat(80) + '\n');

    // Clear cache and checkpoint only when ALL papers have been processed
    // Don't clear if we're doing batch processing and there are more batches remaining
    const totalCachedPapers = PROCESS_ONLY ? countCachedPapers() : papers.length;
    const batchEnd = BATCH_LIMIT ? BATCH_START + BATCH_LIMIT : totalCachedPapers;
    const isLastBatch = batchEnd >= totalCachedPapers;

    if (!BATCH_LIMIT || isLastBatch) {
      console.log('All papers processed. Clearing cache and checkpoint...\n');
      clearCache();
    } else {
      console.log('Batch complete. Cache preserved for remaining batches.\n');
      console.log(`To process next batch, run:`);
      console.log(`  node scripts/bulk-import-conservation-papers.js --process-only --start ${batchEnd} --limit ${BATCH_LIMIT}`);
      console.log(`\nTip: Start with small batches (500-1000) for quality testing before scaling up.\n`);
    }
    console.log('');

    // Save error log if there are errors
    if (stats.errors.length > 0) {
      const errorLogPath = path.join(__dirname, '..', 'logs', `import-errors-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(errorLogPath), { recursive: true });
      fs.writeFileSync(errorLogPath, JSON.stringify(stats.errors, null, 2));
      console.log(`Error log saved to: ${errorLogPath}\n`);
    }

  } catch (error) {
    console.error('\n\nFATAL ERROR:', error);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Run the import
bulkImport();
