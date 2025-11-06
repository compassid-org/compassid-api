#!/usr/bin/env node

/**
 * Weekly Import Script for COMPASSID Conservation Papers
 *
 * PURPOSE: Automated import of newly published conservation papers
 * BASED ON: bulk-import-conservation-papers.js (same database schema)
 *
 * This script searches CrossRef for recently published conservation papers
 * and imports them with AI-generated metadata to keep the database current
 * and feed the trending topics feature.
 *
 * USAGE:
 *   node scripts/weekly-import-conservation-papers.js [--days=7] [--limit=500] [--dry-run]
 *
 * OPTIONS:
 *   --days=N       Number of days back to search (default: 7)
 *   --limit=N      Maximum number of papers to import (default: 500)
 *   --dry-run      Test run without actually importing to database
 *
 * EXAMPLES:
 *   node scripts/weekly-import-conservation-papers.js --days=7 --limit=100
 *   node scripts/weekly-import-conservation-papers.js --dry-run
 *
 * COST: ~$0.002 per paper (Claude 3.5 Haiku for AI metadata extraction)
 */

// Load environment variables
require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { extractComprehensiveMetadata } = require('../services/claudeService');

// Import conservation queries
const conservationQueries = require('../config/conservation-queries.json');

// Use centralized database pool
const pool = require('../config/database').default || require('../config/database');

// Configuration
const CROSSREF_API_BASE = 'https://api.crossref.org/works';
const CROSSREF_DELAY_MS = 1000; // 1 request per second (be polite)
const AI_BATCH_SIZE = 2; // Process 2 papers at a time
const AI_BATCH_DELAY_MS = 3000; // 3 seconds between batches

// Parse command line arguments
const args = process.argv.slice(2);
const daysArg = args.find(arg => arg.startsWith('--days='));
const limitArg = args.find(arg => arg.startsWith('--limit='));
const dryRunArg = args.includes('--dry-run');

const DAYS_BACK = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
const IMPORT_LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
const DRY_RUN = dryRunArg;

// Statistics
const stats = {
  // Collection stats
  crossrefSearches: 0,
  papersCollected: 0,
  duplicatesSkipped: 0,
  noAbstractSkipped: 0,
  preAIFilterSkipped: 0,

  // AI processing stats
  aiProcessed: 0,
  aiSuccessful: 0,
  aiFailed: 0,
  totalCost: 0,

  // Database stats
  dbInserted: 0,
  dbFailed: 0,

  // Errors
  errors: []
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate date range for CrossRef query
 */
function getDateRange(daysBack) {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - daysBack);

  const formatDate = (date) => {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  };

  return {
    start: formatDate(startDate),
    end: formatDate(now)
  };
}

/**
 * Query CrossRef for papers matching a conservation query
 */
async function queryCrossRef(query, dateRange) {
  try {
    const params = {
      query: query,
      rows: 100, // Get more results per query
      filter: `from-pub-date:${dateRange.start},until-pub-date:${dateRange.end}`,
      select: 'DOI,title,abstract,author,published,container-title,is-referenced-by-count'
    };

    const response = await axios.get(CROSSREF_API_BASE, {
      params,
      headers: {
        'User-Agent': 'COMPASSID/1.0 (mailto:contact@compassid.org)'
      }
    });

    if (response.status !== 200) {
      throw new Error(`CrossRef API error: ${response.status}`);
    }

    const data = response.data;
    stats.crossrefSearches++;

    return data.message.items || [];
  } catch (error) {
    console.error(`Error querying CrossRef for "${query}":`, error.message);
    return [];
  }
}

/**
 * Transform CrossRef paper to our format
 */
function transformCrossRefPaper(item) {
  // Extract publication date
  let publicationDate = null;
  let year = null;
  if (item.published && item.published['date-parts'] && item.published['date-parts'][0]) {
    const dateParts = item.published['date-parts'][0];
    year = dateParts[0];
    const month = dateParts[1] || 1;
    const day = dateParts[2] || 1;
    publicationDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Extract authors
  let authors = '';
  if (item.author && item.author.length > 0) {
    authors = item.author
      .map(a => `${a.given || ''} ${a.family || ''}`.trim())
      .filter(name => name.length > 0)
      .join(', ');
  }

  return {
    doi: item.DOI,
    title: item.title ? item.title[0] : null,
    abstract: item.abstract || null,
    authors: authors || null,
    year: year,
    publicationDate: publicationDate,
    journal: item['container-title'] ? item['container-title'][0] : null,
    citations: item['is-referenced-by-count'] || 0
  };
}

/**
 * Check if paper already exists in database
 */
async function paperExists(doi) {
  const result = await pool.query(
    'SELECT id FROM research_items WHERE doi = $1',
    [doi]
  );
  return result.rows.length > 0;
}

/**
 * Pre-AI filter to catch obvious false positives
 * (Same logic as bulk import)
 */
function isObviousFalsePositive(paper) {
  if (!paper.title && !paper.abstract) return true;

  const text = `${paper.title || ''} ${paper.abstract || ''}`.toLowerCase();

  // Medical/clinical false positives
  const medicalKeywords = [
    'patient', 'clinical trial', 'hospital', 'treatment', 'disease',
    'therapy', 'medicine', 'diagnosis', 'pharmaceutical'
  ];

  // Business/economic false positives
  const businessKeywords = [
    'marketing', 'financial performance', 'stock market', 'investment strategy',
    'business model', 'corporate', 'revenue', 'profit margin'
  ];

  // Engineering/tech false positives
  const engineeringKeywords = [
    'algorithm optimization', 'software development', 'machine learning model',
    'computer vision', 'data structure', 'neural network training'
  ];

  const allKeywords = [...medicalKeywords, ...businessKeywords, ...engineeringKeywords];

  // Count how many false positive keywords appear
  const falsePositiveCount = allKeywords.filter(keyword => text.includes(keyword)).length;

  // If 3+ false positive keywords, likely not conservation research
  return falsePositiveCount >= 3;
}

/**
 * Save paper to database (EXACT MATCH to bulk import schema)
 */
async function savePaper(paper, metadata) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // System user ID for automated imports (same as bulk import)
    const SYSTEM_USER_ID = '7535aea0-5501-4da4-80ac-d0a4d1f88b24';

    // Convert authors string to JSONB array format (same as bulk import)
    const authorsJsonb = paper.authors
      ? JSON.stringify(paper.authors.split(', ').map(name => name.trim()))
      : JSON.stringify([]);

    // Insert into research_items (EXACT SAME schema as bulk import)
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

    // Insert into compass_metadata (EXACT SAME schema as bulk import)
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
 * Process a single paper with AI metadata extraction
 * (Same logic as bulk import)
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

  // Save to database (unless dry run)
  if (DRY_RUN) {
    stats.dbInserted++;
    return { success: true, dryRun: true };
  }

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
 * Main weekly import function
 */
async function weeklyImport() {
  console.log('\n=== COMPASSID Weekly Conservation Paper Import ===\n');
  console.log(`Date range: Last ${DAYS_BACK} days`);
  console.log(`Import limit: ${IMPORT_LIMIT} papers`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'LIVE IMPORT'}\n`);

  const dateRange = getDateRange(DAYS_BACK);
  console.log(`Searching for papers published between ${dateRange.start} and ${dateRange.end}\n`);

  // Load conservation queries
  const categories = [
    'frameworks',
    'conservation_general',
    'climate_biodiversity',
    'ecosystems',
    'species_groups',
    'threats',
    'conservation_actions',
    'methods',
    'policy_governance',
    'indigenous_traditional',
    'restoration_rewilding',
    'urban_agriculture'
  ];

  let allQueries = [];
  for (const category of categories) {
    if (conservationQueries[category]) {
      for (const query of conservationQueries[category]) {
        allQueries.push(query);
      }
    }
  }

  console.log(`Found ${allQueries.length} conservation queries across ${categories.length} categories\n`);

  // Collect papers from CrossRef
  console.log('Phase 1: Collecting papers from CrossRef...\n');

  const collectedPapers = new Map(); // Use Map to deduplicate by DOI

  for (let i = 0; i < allQueries.length; i++) {
    const query = allQueries[i];
    process.stdout.write(`\rQuerying: [${i + 1}/${allQueries.length}] "${query.substring(0, 50)}..."`);

    const papers = await queryCrossRef(query, dateRange);

    for (const item of papers) {
      if (!item.DOI) continue;

      const paper = transformCrossRefPaper(item);
      if (!collectedPapers.has(paper.doi)) {
        collectedPapers.set(paper.doi, paper);
        stats.papersCollected++;

        // Stop if we've reached the limit
        if (collectedPapers.size >= IMPORT_LIMIT) {
          break;
        }
      }
    }

    if (collectedPapers.size >= IMPORT_LIMIT) {
      console.log(`\n\nReached import limit of ${IMPORT_LIMIT} papers`);
      break;
    }

    // Rate limiting for CrossRef
    await sleep(CROSSREF_DELAY_MS);
  }

  console.log(`\n\nCollected ${stats.papersCollected} unique papers from ${stats.crossrefSearches} CrossRef queries\n`);

  // Process papers with AI
  console.log('Phase 2: Processing papers with AI metadata extraction...\n');

  const papersArray = Array.from(collectedPapers.values());
  const results = await processPaperBatch(papersArray);

  // Print summary
  console.log('\n=== Weekly Import Summary ===\n');
  console.log(`Papers collected:          ${stats.papersCollected}`);
  console.log(`Duplicates skipped:        ${stats.duplicatesSkipped}`);
  console.log(`No abstract skipped:       ${stats.noAbstractSkipped}`);
  console.log(`Pre-AI filter skipped:     ${stats.preAIFilterSkipped}`);
  console.log(`AI processed:              ${stats.aiProcessed}`);
  console.log(`AI successful:             ${stats.aiSuccessful}`);
  console.log(`AI failed:                 ${stats.aiFailed}`);
  console.log(`Database inserted:         ${stats.dbInserted}`);
  console.log(`Database failed:           ${stats.dbFailed}`);
  console.log(`Total cost:                $${stats.totalCost.toFixed(4)}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors: ${stats.errors.length}`);
    console.log('Error log saved to logs/weekly-import-errors-*.json');
  }

  // Save error log
  if (stats.errors.length > 0) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const errorLogPath = path.join(__dirname, '..', 'logs', `weekly-import-errors-${timestamp}.json`);
    fs.mkdirSync(path.dirname(errorLogPath), { recursive: true });
    fs.writeFileSync(errorLogPath, JSON.stringify(stats.errors, null, 2));
  }

  // Save summary
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const summaryPath = path.join(__dirname, '..', 'logs', `weekly-import-summary-${timestamp}.json`);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(stats, null, 2));
  console.log(`\nSummary saved to: ${summaryPath}\n`);
}

// Run the import
weeklyImport()
  .then(() => {
    console.log('Weekly import completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Weekly import failed:', error);
    process.exit(1);
  });
