# CrossRef + OpenAlex Integration Guide

## Overview

This document describes the implementation for integrating CrossRef and OpenAlex APIs into COMPASSID for automated paper ingestion and enrichment.

## Architecture

### Current Status

✅ **Frontend Services Implemented**:
- `compassid-frontend/src/services/external/crossrefService.js` - CrossRef API integration
- `compassid-frontend/src/services/external/openAlexService.js` - OpenAlex API integration
- `compassid-frontend/src/services/ingestion/paperIngestion.js` - Paper ingestion orchestration

✅ **Database Migration Created**:
- `src/migrations/022_external_api_metadata.sql` - Adds columns for external API data

⚠️ **Pending Implementation**:
- Backend API endpoint for paper ingestion
- Database operations (upsertPaper, findPaperByDOI, etc.)
- Integration with existing AI tagging and geocoding

## Database Schema Changes

### Migration 022: External API Metadata

The migration adds the following columns to `research_items`:

```sql
- external_source VARCHAR(50)        -- 'crossref', 'openalex', 'pubmed', 'manual'
- openalex_id VARCHAR(100)            -- OpenAlex Work ID (e.g., W2741809807)
- pmid VARCHAR(50)                    -- PubMed ID
- citation_count INTEGER DEFAULT 0    -- Number of citations
- open_access BOOLEAN DEFAULT false   -- Open access status
- external_metadata JSONB DEFAULT '{}' -- Raw API response
- last_synced_at TIMESTAMP            -- Last sync with external API
```

### To Run the Migration

```bash
# Find your database credentials in .env
# Then run:
psql -h localhost -U YOUR_DB_USER -d compassid_db -f src/migrations/022_external_api_metadata.sql
```

## How It Works

### 1. Paper Ingestion Flow

```
Frontend -> CrossRef/OpenAlex APIs -> Backend API -> Database
                                                 \-> AI Tagging Service
                                                 \-> Geocoding Service
```

### 2. Data Sources

**CrossRef** (Primary for DOI lookup):
- Journal articles with DOIs
- Citation counts
- Publisher metadata
- Basic author information

**OpenAlex** (Enhanced metadata):
- All papers + preprints
- Rich author affiliations (ROR IDs, institutions)
- Concept/topic tagging
- SDG alignments
- Better open access tracking
- Already includes CrossRef data

### 3. Deduplication Strategy

Papers are deduplicated by DOI:
- Check if DOI exists in database
- If exists: Update citation count and external metadata only
- If new: Insert full paper with metadata
- **Preserve**: User-created COMPASS metadata (frameworks, geographic tags, etc.)

## Integration with Existing Features

### AI Tagging (PRESERVED)

The integration **does not interfere** with AI tagging:

**User-submitted papers**:
- AI tagging runs when users add papers manually
- Stores results in `compass_metadata` table

**External API papers**:
- OpenAlex provides `concepts` (similar to AI tags)
- Can be used to pre-populate COMPASS metadata suggestions
- Still requires human review/approval

### Geocoding (PRESERVED)

Geographic information handling:

**Current**:
- Manual entry via `geo_scope_text` and `geo_scope_geom`
- PostGIS disabled, using TEXT fields

**With OpenAlex**:
- OpenAlex doesn't provide coordinates
- Geographic information remains manual or AI-extracted
- No changes to existing geocoding workflow

### Framework Alignment (PRESERVED)

Policy framework tagging remains unchanged:
- Still stored in `compass_metadata.framework_alignment`
- External APIs don't provide framework data
- User/expert tagging workflow continues as-is

## Frontend Services Already Implemented

### CrossRef Service

```javascript
// compassid-frontend/src/services/external/crossrefService.js

// Search papers
await searchPapers(query, { fromDate, toDate, limit, filters })

// Get paper by DOI
await getPaperByDOI('10.1234/example')

// Get recent conservation papers
await searchConservationPapers({ limit: 100 })

// Batch fetch
await batchGetPapersByDOI(['10.1234/a', '10.1234/b'])
```

### OpenAlex Service

```javascript
// compassid-frontend/src/services/external/openAlexService.js

// Search papers
await searchPapers(query, { fromDate, toDate, limit, page })

// Get paper by DOI
await getPaperByDOI('10.1234/example')

// Get paper by OpenAlex ID
await getPaperById('W2741809807')

// Search by author ORCID
await searchPapersByAuthor('0000-0001-2345-6789')

// Get trending papers
await getTrendingPapers(30, 100)
```

### Paper Ingestion Service

```javascript
// compassid-frontend/src/services/ingestion/paperIngestion.js

// Daily ingestion from all sources (CrossRef + OpenAlex + PubMed)
await runDailyIngestion(1) // days back

// Weekly sync (update citation counts)
await runWeeklySync(1000) // batch size

// Ingest papers for specific author
await ingestPapersByAuthor('0000-0001-2345-6789')
```

## Next Steps for Implementation

### 1. Run the Database Migration

```bash
psql -h localhost -U YOUR_DB_USER -d compassid_db -f src/migrations/022_external_api_metadata.sql
```

### 2. Create Backend Ingestion Service

Create `src/services/paperIngestionService.js`:

```javascript
const pool = require('../config/database.cjs');

/**
 * Upsert (insert or update) paper from external API
 * Preserves user-created COMPASS metadata
 */
async function upsertPaper(paperData, userId) {
  // Check if paper exists by DOI
  const existing = await pool.query(
    'SELECT id FROM research_items WHERE doi = $1',
    [paperData.doi]
  );

  if (existing.rows.length > 0) {
    // Update citation count and sync time only
    await pool.query(
      `UPDATE research_items SET
        citation_count = $1,
        open_access = $2,
        external_metadata = $3,
        last_synced_at = NOW()
      WHERE doi = $4`,
      [paperData.citationCount, paperData.openAccess, paperData.sourceData, paperData.doi]
    );
    return existing.rows[0].id;
  } else {
    // Insert new paper
    const result = await pool.query(
      `INSERT INTO research_items (
        user_id, doi, title, abstract, publication_year, journal, authors,
        external_source, openalex_id, pmid, citation_count, open_access,
        external_metadata, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING id`,
      [
        userId, paperData.doi, paperData.title, paperData.abstract,
        paperData.publicationYear, paperData.journal,
        JSON.stringify(paperData.authors),
        paperData.source, paperData.openAlexId, paperData.pmid,
        paperData.citationCount, paperData.openAccess,
        JSON.stringify(paperData.sourceData || {})
      ]
    );

    // Create empty COMPASS metadata (to be filled by AI or users)
    await pool.query(
      `INSERT INTO compass_metadata (research_id, framework_alignment)
       VALUES ($1, '[]')`,
      [result.rows[0].id]
    );

    return result.rows[0].id;
  }
}

module.exports = { upsertPaper };
```

### 3. Create API Endpoint

Add to `src/routes/research.js`:

```javascript
const paperIngestionService = require('../services/paperIngestionService');

// POST /api/research/ingest
router.post('/ingest', authenticateToken, async (req, res, next) => {
  try {
    const { papers, source } = req.body; // papers from CrossRef/OpenAlex
    const userId = req.user.userId;

    const results = {
      inserted: 0,
      updated: 0,
      errors: []
    };

    for (const paper of papers) {
      try {
        await paperIngestionService.upsertPaper(paper, userId);
        results.inserted++;
      } catch (error) {
        results.errors.push({ doi: paper.doi, error: error.message });
      }
    }

    res.json({
      success: true,
      results
    });
  } catch (error) {
    next(error);
  }
});
```

### 4. Update Frontend to Use Backend

Modify `compassid-frontend/src/services/ingestion/paperIngestion.js`:

```javascript
// Replace placeholder functions with actual API calls
async function upsertPaper(paper) {
  const response = await fetch('/api/research/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAuthToken()}`
    },
    body: JSON.stringify({ papers: [paper], source: paper.source })
  });

  return await response.json();
}
```

## Testing the Integration

### Manual Test

```javascript
// In browser console or test file:

import * as OpenAlexService from './services/external/openAlexService.js';

// 1. Search for conservation papers
const results = await OpenAlexService.searchConservationPapers({ limit: 10 });

// 2. Send to backend for ingestion
await fetch('/api/research/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${yourToken}`
  },
  body: JSON.stringify({
    papers: results.papers,
    source: 'openalex'
  })
});
```

### Automated Daily Ingestion (Future)

Create a cron job or scheduled task:

```javascript
// scripts/daily-ingestion.js
const { runDailyIngestion } = require('./src/services/ingestion/paperIngestion');

// Run daily at 2 AM
runDailyIngestion(1).then(stats => {
  console.log('Daily ingestion complete:', stats);
}).catch(error => {
  console.error('Daily ingestion failed:', error);
});
```

## Benefits of This Approach

✅ **No Duplication**: DOI-based deduplication prevents duplicate papers
✅ **Preserves User Data**: COMPASS metadata remains untouched during updates
✅ **Enrichment**: OpenAlex adds concepts/SDGs that can seed AI suggestions
✅ **Citation Tracking**: Automatic updates of citation counts
✅ **Complementary Coverage**: CrossRef + OpenAlex = maximum paper discovery
✅ **AI/Geocoding Compatible**: Existing workflows continue unchanged

## Monitoring and Maintenance

### Weekly Sync

Update citation counts for existing papers:

```bash
# Run weekly to refresh metadata
node scripts/weekly-sync.js
```

### Check Sync Status

```sql
-- Papers needing sync (>7 days old)
SELECT COUNT(*) FROM research_items
WHERE last_synced_at < NOW() - INTERVAL '7 days'
  AND external_source IS NOT NULL;

-- Most cited papers
SELECT title, citation_count, last_synced_at
FROM research_items
WHERE external_source IS NOT NULL
ORDER BY citation_count DESC
LIMIT 10;
```

## Questions?

- Frontend services: Already implemented in `compassid-frontend/src/services/external/`
- Database changes: Run `src/migrations/022_external_api_metadata.sql`
- Backend implementation: Follow steps in "Next Steps for Implementation"
- AI tagging: Continues to work as-is, no changes needed
- Geocoding: Continues to work as-is, no changes needed
