# COMPASSID Paper Import Scripts

This directory contains two import scripts for populating the COMPASSID database with conservation research papers:

1. **`bulk-import-conservation-papers.js`** - Historical bulk import (150K+ papers from 1990-2025)
2. **`weekly-import-conservation-papers.js`** - Automated weekly import (new papers published recently)

---

## 1. Bulk Import (Historical Papers)

**Purpose:** One-time import of historical conservation papers to build the initial database.

### Features
- Searches CrossRef for 150K+ conservation papers (1990-2025)
- Two-phase workflow: collect → process
- Batch processing with checkpoints
- Crash recovery with disk caching
- Cost control (~$2 per 1000 papers)

### Usage

#### Phase 1: Collection (Fast & Free)
```bash
# Collect 150,000 papers to disk cache (no AI, no cost)
cd compassid-api
node scripts/bulk-import-conservation-papers.js 150000 --collect-only
```

This creates cache files in `cache/collected-papers-*.json`

#### Phase 2: Processing (Slow & Costs Money)

**Small batch testing (recommended first):**
```bash
# Test quality with 100 papers first
node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 100

# Inspect results in database, then continue
node scripts/bulk-import-conservation-papers.js --process-only --start 100 --limit 100
```

**Full processing in 1K batches:**
```bash
# Process papers 0-1000
node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 1000

# Process papers 1000-2000
node scripts/bulk-import-conservation-papers.js --process-only --start 1000 --limit 1000

# Process papers 2000-3000
node scripts/bulk-import-conservation-papers.js --process-only --start 2000 --limit 1000

# Continue until all papers processed...
```

### Cost Estimate
- **Collection:** Free
- **Processing:** ~$2 per 1000 papers (~$300 for 150K papers)
- **AI Model:** Claude 3.5 Haiku (~$0.002 per paper)

### Progress Tracking
- Logs saved to `logs/import-errors-*.json`
- Checkpoint saved every 50 papers in `cache/processing-checkpoint.json`
- Auto-resumes from last checkpoint if script crashes

---

## 2. Weekly Import (New Papers)

**Purpose:** Automated import of newly published conservation papers to keep database current and feed trending topics feature.

### Features
- Searches CrossRef for papers published in last N days
- Single-phase workflow (collection + processing)
- Automatic duplicate detection
- Configurable time window and limits
- Designed for cron scheduling

### Usage

#### Manual Runs

```bash
cd compassid-api

# Import papers from last 7 days (default)
node scripts/weekly-import-conservation-papers.js

# Import papers from last 14 days
node scripts/weekly-import-conservation-papers.js --days 14

# Import papers from last 30 days, up to 1000 papers
node scripts/weekly-import-conservation-papers.js --days 30 --limit 1000

# Dry run (test without importing)
node scripts/weekly-import-conservation-papers.js --dry-run
```

#### Automated Scheduling with Cron

**Recommended schedule:** Every Monday at 2 AM

```bash
# Edit crontab
crontab -e

# Add this line (adjust path to your installation):
0 2 * * 1 cd /Users/desertmountain/Desktop/COMPASSID/compassid-api && node scripts/weekly-import-conservation-papers.js >> logs/weekly-import.log 2>&1
```

**Other useful schedules:**

```bash
# Daily at 3 AM
0 3 * * * cd /path/to/compassid-api && node scripts/weekly-import-conservation-papers.js --days 1 >> logs/daily-import.log 2>&1

# Bi-weekly (every other Monday at 2 AM)
0 2 * * 1 [ $(date +\%W) -eq $(($(date +\%W) / 2 * 2)) ] && cd /path/to/compassid-api && node scripts/weekly-import-conservation-papers.js --days 14 >> logs/biweekly-import.log 2>&1

# Monthly (first Monday at 2 AM)
0 2 1-7 * 1 cd /path/to/compassid-api && node scripts/weekly-import-conservation-papers.js --days 30 >> logs/monthly-import.log 2>&1
```

### Cost Estimate
- **Weekly (7 days):** ~50-200 papers → ~$0.10-$0.40 per week (~$20/year)
- **Monthly (30 days):** ~200-500 papers → ~$0.40-$1.00 per month (~$12/year)

### Benefits for Trending Topics
- Fresh papers feed the trending topics algorithm
- Users see what's being published RIGHT NOW
- Helps identify emerging research themes
- Keeps COMPASSID relevant and up-to-date

---

## Workflow Strategy

### Initial Setup (First Time)
1. **Bulk import historical papers:**
   ```bash
   # Collect 150K papers (1 hour)
   node scripts/bulk-import-conservation-papers.js 150000 --collect-only

   # Process in batches (several days)
   # Test with 100 first, then scale to 1000 per batch
   node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 100
   node scripts/bulk-import-conservation-papers.js --process-only --start 100 --limit 1000
   # ... continue until complete
   ```

2. **Set up weekly automation:**
   ```bash
   # Add to crontab
   crontab -e
   # Add: 0 2 * * 1 cd /path/to/compassid-api && node scripts/weekly-import-conservation-papers.js >> logs/weekly-import.log 2>&1
   ```

### Ongoing Operations
- **Weekly import runs automatically** via cron
- **Monitor logs:** Check `logs/weekly-import.log` for status
- **Trending topics stay fresh** with new research
- **Database grows organically** without manual intervention

---

## Monitoring & Logs

### Bulk Import Logs
- **Error log:** `logs/import-errors-{timestamp}.json`
- **Checkpoint:** `cache/processing-checkpoint.json`
- **Cache:** `cache/collected-papers-*.json`

### Weekly Import Logs
- **Error log:** `logs/weekly-import-errors-{timestamp}.json`
- **Summary:** `logs/weekly-import-summary-{timestamp}.json`
- **Cron output:** `logs/weekly-import.log` (if using cron)

### Monitoring Commands

```bash
# Check database stats
psql -U desertmountain -d compassid -c "
SELECT
  COUNT(*) as total_papers,
  COUNT(CASE WHEN c.geo_scope_geom IS NOT NULL THEN 1 END) as with_gps,
  TO_CHAR(MAX(r.created_at), 'YYYY-MM-DD HH24:MI:SS') as latest_paper_added
FROM research_items r
LEFT JOIN compass_metadata c ON r.id = c.research_id;
"

# Check cron log (last 50 lines)
tail -50 logs/weekly-import.log

# List recent import summaries
ls -lt logs/weekly-import-summary-*.json | head -5
```

---

## Troubleshooting

### Bulk Import Issues

**Problem:** Script crashes during processing
- **Solution:** Just re-run the same command - it auto-resumes from checkpoint

**Problem:** Out of memory
- **Solution:** Use smaller batches (500 instead of 1000)
```bash
node scripts/bulk-import-conservation-papers.js --process-only --start 0 --limit 500
```

**Problem:** Too many AI failures
- **Solution:** Check error log, may need to adjust AI prompts in `services/claudeService.js`

### Weekly Import Issues

**Problem:** Cron job not running
- **Solution:** Check cron logs and ensure path is absolute
```bash
# View cron logs (macOS)
log show --predicate 'eventMessage contains "cron"' --last 1d

# Test cron command manually
cd /path/to/compassid-api && node scripts/weekly-import-conservation-papers.js
```

**Problem:** Too many papers per week
- **Solution:** Reduce limit or adjust days
```bash
node scripts/weekly-import-conservation-papers.js --days 7 --limit 100
```

**Problem:** Missing papers
- **Solution:** Run with longer time window once
```bash
node scripts/weekly-import-conservation-papers.js --days 14  # Catch anything missed
```

---

## Environment Variables Required

Both scripts require these environment variables:

```bash
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/compassid

# AI Service (Claude)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Key Differences

| Feature | Bulk Import | Weekly Import |
|---------|-------------|---------------|
| **Purpose** | Historical database build | Keep database current |
| **Frequency** | One-time | Weekly/automated |
| **Papers** | 150,000+ | 50-500 per week |
| **Cost** | ~$300 total | ~$20/year |
| **Workflow** | Two-phase | Single-phase |
| **Date Range** | 1990-2025 | Last 7-30 days |
| **Automation** | Manual batches | Cron scheduled |
| **Trending Topics** | Historical data | Fresh content |

---

## Questions?

- Check error logs in `logs/` directory
- Review AI prompts in `services/claudeService.js`
- Check conservation queries in `config/conservation-queries.json`
- Monitor database with SQL queries above
