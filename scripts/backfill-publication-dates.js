import axios from 'axios';
import dotenv from 'dotenv';
import pool from '../config/database.js';

dotenv.config();

// Rate limiting: 1 request per second to be polite to CrossRef
const RATE_LIMIT_MS = 1000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract publication date from CrossRef response
 */
function extractPublicationDate(crossrefData) {
  // Try different date fields in order of preference
  const dateFields = [
    'published',
    'published-print',
    'published-online',
    'issued',
    'created'
  ];

  for (const field of dateFields) {
    const dateData = crossrefData[field];
    if (dateData && dateData['date-parts'] && dateData['date-parts'][0]) {
      const parts = dateData['date-parts'][0];
      const year = parts[0];
      const month = parts[1] || 1;  // Default to January if no month
      const day = parts[2] || 1;     // Default to 1st if no day

      // Validate year
      if (year && year >= 1900 && year <= 2100) {
        // PostgreSQL DATE format: YYYY-MM-DD
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }

  return null;
}

/**
 * Fetch publication date from CrossRef for a single DOI
 */
async function fetchPublicationDate(doi) {
  try {
    const response = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: {
        'User-Agent': 'COMPASS ID (mailto:contact@compassid.org)'
      },
      timeout: 10000
    });

    if (response.data && response.data.message) {
      return extractPublicationDate(response.data.message);
    }
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`  ✗ DOI not found: ${doi}`);
    } else {
      console.error(`  ✗ Error fetching DOI ${doi}:`, error.message);
    }
  }

  return null;
}

/**
 * Main backfill function
 */
async function backfillPublicationDates() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   Backfill Publication Dates from CrossRef     ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  try {
    // Get all papers with DOIs but no publication_date
    const result = await pool.query(`
      SELECT id, doi, title, publication_year
      FROM research_items
      WHERE doi IS NOT NULL
        AND publication_date IS NULL
      ORDER BY created_at DESC
    `);

    const papers = result.rows;
    console.log(`Found ${papers.length} papers needing publication dates\n`);

    if (papers.length === 0) {
      console.log('✓ All papers already have publication dates!');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      const progress = `[${i + 1}/${papers.length}]`;

      console.log(`${progress} Processing: ${paper.title.substring(0, 60)}...`);
      console.log(`  DOI: ${paper.doi}`);

      // Fetch publication date from CrossRef
      const publicationDate = await fetchPublicationDate(paper.doi);

      if (publicationDate) {
        // Update database
        await pool.query(
          'UPDATE research_items SET publication_date = $1 WHERE id = $2',
          [publicationDate, paper.id]
        );

        console.log(`  ✓ Updated publication_date: ${publicationDate}`);
        successCount++;
      } else {
        // If CrossRef doesn't have the date, try to use publication_year
        if (paper.publication_year) {
          const fallbackDate = `${paper.publication_year}-01-01`;
          await pool.query(
            'UPDATE research_items SET publication_date = $1 WHERE id = $2',
            [fallbackDate, paper.id]
          );
          console.log(`  ⚠ Used fallback: ${fallbackDate} (from publication_year)`);
          skippedCount++;
        } else {
          console.log(`  ✗ No date available`);
          failCount++;
        }
      }

      // Rate limiting
      if (i < papers.length - 1) {
        await sleep(RATE_LIMIT_MS);
      }

      // Progress summary every 100 papers
      if ((i + 1) % 100 === 0) {
        console.log(`\n--- Progress: ${i + 1}/${papers.length} ---`);
        console.log(`Success: ${successCount} | Fallback: ${skippedCount} | Failed: ${failCount}\n`);
      }
    }

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║              Backfill Complete                  ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    console.log(`Total papers processed: ${papers.length}`);
    console.log(`✓ CrossRef dates:       ${successCount}`);
    console.log(`⚠ Fallback dates:       ${skippedCount}`);
    console.log(`✗ Failed:               ${failCount}\n`);

    // Verify results
    const verifyResult = await pool.query(`
      SELECT
        COUNT(*) as total_papers,
        COUNT(publication_date) as papers_with_date,
        COUNT(*) - COUNT(publication_date) as papers_without_date
      FROM research_items
    `);

    console.log('Database status:');
    console.log(`Total papers:          ${verifyResult.rows[0].total_papers}`);
    console.log(`With publication_date: ${verifyResult.rows[0].papers_with_date}`);
    console.log(`Without date:          ${verifyResult.rows[0].papers_without_date}\n`);

  } catch (error) {
    console.error('Error during backfill:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the backfill
backfillPublicationDates()
  .then(() => {
    console.log('✓ Backfill script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Backfill script failed:', error);
    process.exit(1);
  });
