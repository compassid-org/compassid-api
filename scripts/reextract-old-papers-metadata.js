/**
 * Re-extract Enhanced Metadata for Old Papers
 *
 * This script re-extracts comprehensive metadata for papers that were imported
 * before the enhanced AI extraction was implemented. Ensures consistency across
 * the entire database with species-level taxonomy, threat types, conservation
 * actions, and data availability tags.
 *
 * Usage: node scripts/reextract-old-papers-metadata.js [limit]
 * Example: node scripts/reextract-old-papers-metadata.js 1000
 */

const pool = require('../src/config/database.cjs');
const { extractComprehensiveMetadata } = require('../services/claudeService');

// Configuration
const BATCH_SIZE = 2; // Process 2 papers at a time
const DELAY_MS = 3000; // 3 second delay between batches
const CUTOFF_DATE = '2025-10-19 18:24:00'; // Before bulk import started

/**
 * Fetch papers that need re-extraction
 */
async function fetchOldPapers(limit = 10000) {
  const query = `
    SELECT
      r.id,
      r.title,
      r.abstract,
      r.doi,
      r.authors,
      r.publication_year,
      r.journal,
      c.id as metadata_id
    FROM research_items r
    JOIN compass_metadata c ON r.id = c.research_id
    WHERE r.created_at < $1
      AND r.abstract IS NOT NULL
      AND r.abstract != ''
      AND LENGTH(r.abstract) > 50
    ORDER BY r.created_at ASC
    LIMIT $2
  `;

  const result = await pool.query(query, [CUTOFF_DATE, limit]);
  return result.rows;
}

/**
 * Update compass_metadata with new enhanced metadata
 */
async function updateMetadata(metadataId, comprehensiveMetadata) {
  const query = `
    UPDATE compass_metadata
    SET
      ecosystem_type = $1,
      methods = $2,
      taxon_scope = $3,
      framework_alignment = $4,
      geo_scope_text = $5,
      geo_scope_geom = $6,
      temporal_start = $7,
      temporal_end = $8,
      updated_at = NOW()
    WHERE id = $9
  `;

  // Extract geography if available
  let geoGeom = null;
  if (comprehensiveMetadata.geography?.coordinates) {
    const coords = comprehensiveMetadata.geography.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const [lon, lat] = coords;
      if (lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
        geoGeom = `POINT(${lon} ${lat})`;
      }
    }
  }

  // Extract temporal range
  let temporalStart = null;
  let temporalEnd = null;
  if (comprehensiveMetadata.temporal_coverage) {
    if (comprehensiveMetadata.temporal_coverage.start) {
      try {
        const startYear = parseInt(comprehensiveMetadata.temporal_coverage.start);
        if (startYear > 0 && startYear <= 2100) {
          temporalStart = `${startYear}-01-01`;
        }
      } catch (e) {
        // Skip invalid dates
      }
    }
    if (comprehensiveMetadata.temporal_coverage.end) {
      try {
        const endYear = parseInt(comprehensiveMetadata.temporal_coverage.end);
        if (endYear > 0 && endYear <= 2100) {
          temporalEnd = `${endYear}-12-31`;
        }
      } catch (e) {
        // Skip invalid dates
      }
    }
  }

  await pool.query(query, [
    comprehensiveMetadata.ecosystem_type || null,
    JSON.stringify(comprehensiveMetadata.methods || {}),
    JSON.stringify(comprehensiveMetadata.taxon_scope || []),
    JSON.stringify(comprehensiveMetadata.framework_alignment || []),
    comprehensiveMetadata.geography?.description || null,
    geoGeom,
    temporalStart,
    temporalEnd,
    metadataId
  ]);
}

/**
 * Clean JATS XML tags from abstract
 */
function cleanAbstract(abstract) {
  if (!abstract) return abstract;

  // Remove JATS XML tags (common in CrossRef abstracts)
  let cleaned = abstract
    .replace(/<\/?jats:[^>]+>/g, '') // Remove <jats:*> tags
    .replace(/<\/?p>/g, '') // Remove <p> tags
    .replace(/<\/?i>/g, '') // Remove <i> tags
    .replace(/<\/?b>/g, '') // Remove <b> tags
    .replace(/<\/?sup>/g, '') // Remove <sup> tags
    .replace(/<\/?sub>/g, '') // Remove <sub> tags
    .replace(/&lt;/g, '<') // Decode HTML entities
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  return cleaned;
}

/**
 * Process a single paper
 */
async function processPaper(paper) {
  try {
    // Clean the abstract of JATS XML tags
    const cleanedAbstract = cleanAbstract(paper.abstract);

    if (!cleanedAbstract || cleanedAbstract.length < 50) {
      console.error(`Skipping paper "${paper.title.substring(0, 50)}...": Abstract too short after cleaning`);
      return { success: false, paper, error: 'Abstract too short after cleaning' };
    }

    // Extract comprehensive metadata using Claude
    const comprehensiveMetadata = await extractComprehensiveMetadata(
      paper.title,
      cleanedAbstract
    );

    // Update the database
    await updateMetadata(paper.metadata_id, comprehensiveMetadata);

    return { success: true, paper };
  } catch (error) {
    console.error(`Error processing paper "${paper.title.substring(0, 50)}...":`, error.message);
    return { success: false, paper, error: error.message };
  }
}

/**
 * Process papers in batches
 */
async function processBatch(papers) {
  const results = await Promise.all(papers.map(processPaper));
  return results;
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main re-extraction function
 */
async function reextractMetadata(limit) {
  const startTime = Date.now();

  console.log('================================================================================');
  console.log('COMPASSID Metadata Re-Extraction - Enhanced AI Format');
  console.log('================================================================================');
  console.log(`Target: Papers created before ${CUTOFF_DATE}`);
  console.log(`AI rate limit: ${BATCH_SIZE} papers every ${DELAY_MS}ms`);
  console.log(`Estimated cost: ~$0.13 per 100 papers`);
  console.log('================================================================================\n');

  // Fetch papers that need re-extraction
  console.log('Fetching papers that need re-extraction...\n');
  const papers = await fetchOldPapers(limit);

  console.log(`Found ${papers.length} papers to re-extract\n`);

  if (papers.length === 0) {
    console.log('No papers need re-extraction. Exiting.\n');
    return;
  }

  // Statistics
  let processed = 0;
  let successful = 0;
  let failed = 0;
  const errors = [];

  // Process in batches
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const batch = papers.slice(i, i + BATCH_SIZE);
    const results = await processBatch(batch);

    // Update statistics
    results.forEach(result => {
      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push({
          title: result.paper.title,
          error: result.error
        });
      }
    });

    processed += batch.length;

    // Progress update every 50 papers
    if (processed % 50 === 0 || processed === papers.length) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const rate = processed / elapsed;
      const remaining = papers.length - processed;
      const eta = remaining / rate;
      const cost = (successful * 0.0013).toFixed(2); // ~$0.0013 per paper with Haiku

      console.log('================================================================================');
      console.log(`Progress: ${processed} / ${papers.length} papers (${Math.round(processed / papers.length * 100)}%)`);
      console.log(`Time elapsed: ${elapsed}s | ETA: ${Math.round(eta)}s`);
      console.log(`Rate: ${rate.toFixed(2)} papers/sec`);
      console.log('--------------------------------------------------------------------------------');
      console.log(`AI processed: ${processed} | Success: ${successful} | Failed: ${failed}`);
      console.log(`Estimated cost: $${cost}`);
      console.log('================================================================================\n');
    }

    // Delay between batches (except for the last one)
    if (i + BATCH_SIZE < papers.length) {
      await delay(DELAY_MS);
    }
  }

  // Final summary
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  const totalCost = (successful * 0.0013).toFixed(2);

  console.log('\n================================================================================');
  console.log('RE-EXTRACTION COMPLETE');
  console.log('================================================================================');
  console.log(`Total papers processed: ${processed}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${(successful / processed * 100).toFixed(1)}%`);
  console.log(`Total estimated cost: $${totalCost}`);
  console.log(`Total time: ${totalTime}s (${Math.round(totalTime / 60)} minutes)`);
  console.log('================================================================================\n');

  // Save error log if there are errors
  if (errors.length > 0) {
    const fs = require('fs');
    const errorLogPath = `logs/reextraction-errors-${Date.now()}.json`;

    // Ensure logs directory exists
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2));
    console.log(`Error log saved to: ${errorLogPath}\n`);
  }

  // Close database connection
  await pool.end();
}

// Parse command line arguments
const limit = parseInt(process.argv[2]) || 10000;

// Run the re-extraction
reextractMetadata(limit).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
