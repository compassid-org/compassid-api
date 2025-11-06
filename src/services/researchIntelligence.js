import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import pkg from 'pg';
const { Pool } = pkg;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'compassid',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Anthropic client
let anthropic = null;
function getAnthropicClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

// Conservation keywords for pre-filtering papers
const CONSERVATION_KEYWORDS = [
  'conservation', 'biodiversity', 'ecosystem', 'marine', 'ocean', 'coral', 'reef',
  'endangered', 'threatened', 'species', 'habitat', 'protection', 'wildlife',
  'fisheries', 'sustainable', 'climate change', 'protected area', 'MPA',
  'environmental', 'ecological', 'restoration', 'management', 'resilience',
  'adaptation', 'mitigation', 'sustainability', 'marine protected', 'coastal',
  'seagrass', 'mangrove', 'kelp', 'phytoplankton', 'zooplankton', 'whales',
  'dolphins', 'sea turtles', 'sharks', 'rays', 'fish', 'invertebrates',
  'policy', 'SDG', 'Paris Agreement', 'CBD', 'Ramsar', 'IUCN'
];

// Exclusion keywords - reject papers containing these (non-conservation topics)
const EXCLUSION_KEYWORDS = [
  'business', 'entrepreneur', 'startup', 'venture', 'market', 'customer',
  'innovation ecosystem', 'digital ecosystem', 'business ecosystem',
  'software ecosystem', 'platform ecosystem', 'knowledge ecosystem',
  'learning ecosystem', 'entrepreneurial ecosystem', 'university ecosystem',
  'education ecosystem', 'social media', 'supply chain', 'circular economy',
  'industrial', 'manufacturing', 'tourism ecosystem', 'urban ecosystem development',
  'smart city', 'blockchain', 'cryptocurrency', 'fintech', 'health ecosystem',
  'healthcare ecosystem', 'patient', 'medical', 'clinical', 'disease'
];

/**
 * Fetch recent conservation papers from CrossRef API
 * @param {Object} options - Query options
 * @param {Date} options.fromDate - Start date for papers
 * @param {Date} options.toDate - End date for papers
 * @param {number} options.limit - Maximum number of papers to fetch
 * @returns {Promise<Array>} Array of paper objects
 */
async function fetchFromCrossRef({ fromDate, toDate = new Date(), limit = 200 }) {
  try {
    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = toDate.toISOString().split('T')[0];

    // Query CrossRef with comprehensive conservation-related filters (marine, terrestrial, freshwater, urban, protected areas, economics)
    const response = await axios.get('https://api.crossref.org/works', {
      params: {
        'filter': `from-pub-date:${fromDateStr},until-pub-date:${toDateStr},type:journal-article,has-abstract:true`,
        'query.title': 'conservation biodiversity ecosystem species habitat wildlife protected areas forest marine ocean terrestrial wetland climate environmental economics',
        'rows': limit,
        'select': 'DOI,title,abstract,author,published,container-title',
      },
      headers: {
        'User-Agent': 'COMPASSID/1.0 (https://compassid.org; mailto:contact@compassid.org)',
      },
    });

    const papers = response.data.message.items.map(item => ({
      doi: item.DOI,
      title: item.title ? item.title[0] : '',
      abstract: item.abstract || '',
      authors: item.author ? item.author.map(a => ({
        given: a.given || '',
        family: a.family || '',
        name: `${a.given || ''} ${a.family || ''}`.trim(),
      })) : [],
      published_date: item.published?.['date-parts']?.[0]
        ? new Date(item.published['date-parts'][0].join('-'))
        : null,
      journal: item['container-title'] ? item['container-title'][0] : null,
    }));

    console.log(`✓ Fetched ${papers.length} papers from CrossRef`);
    return papers;
  } catch (error) {
    console.error('CrossRef API Error:', error.message);
    throw new Error(`Failed to fetch papers from CrossRef: ${error.message}`);
  }
}

/**
 * Filter papers by conservation keywords (pre-filter before AI)
 * @param {Array} papers - Array of papers to filter
 * @param {number} minKeywords - Minimum number of keyword matches required
 * @returns {Array} Filtered papers
 */
function filterRelevantPapers(papers, minKeywords = 2) {
  const filtered = papers.filter(paper => {
    const text = `${paper.title} ${paper.abstract}`.toLowerCase();

    // First check exclusion keywords - reject if any match
    const hasExclusion = EXCLUSION_KEYWORDS.some(keyword =>
      text.includes(keyword.toLowerCase())
    );
    if (hasExclusion) {
      return false;
    }

    // Then check conservation keywords - require minimum matches
    const matches = CONSERVATION_KEYWORDS.filter(keyword =>
      text.includes(keyword.toLowerCase())
    );
    return matches.length >= minKeywords;
  });

  console.log(`✓ Filtered ${papers.length} papers → ${filtered.length} relevant papers (${minKeywords}+ keywords, excluded non-conservation)`);
  return filtered;
}

/**
 * Analyze papers using Claude AI in batches
 * @param {Array} papers - Array of papers to analyze
 * @param {number} batchSize - Number of papers per API call
 * @returns {Promise<Array>} Array of analyzed papers with COMPASS metadata
 */
async function batchAnalyzePapers(papers, batchSize = 5) {
  const client = getAnthropicClient();
  const analyzedPapers = [];
  let totalTokens = 0;

  console.log(`Starting AI analysis of ${papers.length} papers (batches of ${batchSize})...`);

  // Process papers in batches
  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(papers.length / batchSize)}: Analyzing ${batch.length} papers...`);

    try {
      // Build prompt for batch analysis
      const papersText = batch.map((paper, idx) => `
PAPER ${idx + 1}:
DOI: ${paper.doi}
Title: ${paper.title}
Abstract: ${paper.abstract}
Journal: ${paper.journal || 'Unknown'}
Published: ${paper.published_date ? paper.published_date.toISOString().split('T')[0] : 'Unknown'}
`).join('\n---\n');

      const prompt = `Analyze these conservation research papers and extract COMPASS metadata for each one.

${papersText}

For each paper, extract:
1. **framework**: Primary policy framework that the research DIRECTLY ADDRESSES and contributes evidence toward. Only assign if the paper explicitly studies or evaluates the framework. Common frameworks:
   - SDG 14 (Life Below Water - marine/ocean conservation)
   - SDG 15 (Life on Land - terrestrial biodiversity, forests, desertification)
   - SDG 13 (Climate Action - climate change mitigation/adaptation)
   - SDG 11 (Sustainable Cities - urban ecosystems, green infrastructure)
   - SDG 2 (Zero Hunger - sustainable agriculture, food security)
   - Paris Agreement (climate change research)
   - CBD Aichi Targets (specific biodiversity targets)
   - Ramsar Convention (wetlands conservation)
   - IUCN Red List (species threat assessments)
   - CITES (trade in endangered species)
   - Use null if no specific framework is directly addressed

2. **taxa**: Primary taxonomic group studied (e.g., "Marine Mammals", "Corals", "Fish", "Birds", "Mammals", "Plants", "Insects", "Amphibians", "Reptiles", "Multiple Taxa", or null if not species-specific)

3. **ecosystem**: IUCN Global Ecosystem Typology classification:
   - Marine: M1.1 (Epipelagic), M3.1 (Continental Shelf), M4.1 (Deep Sea), etc.
   - Terrestrial: T1.1 (Tropical Rainforest), T2.1 (Boreal Forest), T3.1 (Grasslands), T4.1 (Tundra), etc.
   - Freshwater: F1.1 (Rivers), F2.1 (Lakes), F3.1 (Artificial Wetlands), etc.
   - Urban: M6.1 (Urban Ecosystems)
   - Use specific IUCN codes when clear, or general descriptions like "Temperate Forests", "Coral Reefs", "Wetlands", etc.

4. **region**: Specific geographic region (e.g., "Costa Rica", "Mediterranean", "Amazon Basin", "East Africa", "Southeast Asia", etc.)

5. **methods**: Array of 2-4 research methods (e.g., ["Systematic Review", "Field Surveys", "Remote Sensing", "Genetic Analysis", "Modeling", "Case Study Analysis", "Bibliometric Mapping"])

Return your analysis as a JSON array with this exact structure:
[
  {
    "doi": "paper DOI",
    "framework": "primary framework or null",
    "taxa": "primary taxa or null",
    "ecosystem": "IUCN ecosystem or null",
    "region": "geographic region or null",
    "methods": ["method1", "method2"]
  }
]

CRITICAL GUIDELINES:
- Only assign a framework if the paper DIRECTLY studies or evaluates it (not just mentions it in passing)
- If the paper is a general review or tourism study without explicit conservation policy focus, use null for framework
- Be conservative with framework assignments - accuracy is critical
- Match ecosystem types to what the paper actually studies (forest papers get forest codes, marine papers get marine codes)
- Return ONLY valid JSON, no additional text`;

      // Call Claude API
      const message = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2000,
        system: 'You are an expert in conservation science across marine, terrestrial, freshwater, and urban ecosystems. You have deep knowledge of international policy frameworks (SDGs, Paris Agreement, CBD, Ramsar, IUCN Red List), IUCN Global Ecosystem Typology, and conservation research methods. You are highly conservative and accurate when assigning policy frameworks - only assign if the research DIRECTLY addresses the framework. Analyze research papers and extract structured metadata with precision. Always return valid JSON.',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const responseText = message.content[0].text;
      totalTokens += message.usage.input_tokens + message.usage.output_tokens;

      // Parse JSON response
      try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonText = responseText.trim();
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```\n?/g, '');
        }

        const batchResults = JSON.parse(jsonText);

        // Merge AI results with original paper data
        batch.forEach((paper, idx) => {
          const aiData = batchResults[idx] || {};
          analyzedPapers.push({
            ...paper,
            framework: aiData.framework || null,
            taxa: aiData.taxa || null,
            ecosystem: aiData.ecosystem || null,
            region: aiData.region || null,
            methods: aiData.methods || [],
          });
        });

        console.log(`    ✓ Analyzed ${batch.length} papers (${message.usage.input_tokens + message.usage.output_tokens} tokens)`);
      } catch (parseError) {
        console.error(`    ✗ Failed to parse batch results:`, parseError.message);
        // Add papers without AI metadata
        batch.forEach(paper => {
          analyzedPapers.push({
            ...paper,
            framework: null,
            taxa: null,
            ecosystem: null,
            region: null,
            methods: [],
          });
        });
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`    ✗ Batch analysis error:`, error.message);
      // Add papers without AI metadata
      batch.forEach(paper => {
        analyzedPapers.push({
          ...paper,
          framework: null,
          taxa: null,
          ecosystem: null,
          region: null,
          methods: [],
        });
      });
    }
  }

  console.log(`✓ AI analysis complete: ${analyzedPapers.length} papers analyzed (${totalTokens} total tokens)`);
  const costEstimate = (totalTokens / 1_000_000) * 0.80; // $0.80 per million input tokens for Haiku
  console.log(`  Estimated cost: $${costEstimate.toFixed(4)}`);

  return analyzedPapers;
}

/**
 * Save analyzed papers to database
 * @param {Array} papers - Array of analyzed papers
 * @param {number} weekNumber - ISO week number
 * @returns {Promise<number>} Number of papers saved
 */
async function savePapers(papers, weekNumber) {
  const client = await pool.connect();
  let savedCount = 0;

  try {
    await client.query('BEGIN');

    for (const paper of papers) {
      try {
        await client.query(
          `INSERT INTO analyzed_papers
           (doi, title, abstract, authors, published_date, journal,
            framework, taxa, ecosystem, region, methods, week_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (doi) DO UPDATE SET
            framework = EXCLUDED.framework,
            taxa = EXCLUDED.taxa,
            ecosystem = EXCLUDED.ecosystem,
            region = EXCLUDED.region,
            methods = EXCLUDED.methods,
            analyzed_at = NOW()`,
          [
            paper.doi,
            paper.title,
            paper.abstract,
            JSON.stringify(paper.authors),
            paper.published_date,
            paper.journal,
            paper.framework,
            paper.taxa,
            paper.ecosystem,
            paper.region,
            JSON.stringify(paper.methods),
            weekNumber,
          ]
        );
        savedCount++;
      } catch (error) {
        console.error(`  ✗ Failed to save paper ${paper.doi}:`, error.message);
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Saved ${savedCount} papers to database`);
    return savedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database save error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Generate weekly trends by aggregating analyzed papers
 * @param {Date} weekStart - Start date of the week
 * @returns {Promise<Array>} Array of weekly trend objects
 */
async function generateWeeklyTrends(weekStart) {
  const client = await pool.connect();

  try {
    const weekNumber = getWeekNumber(weekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    console.log(`Generating weekly trends for week ${weekNumber} (${weekStart.toISOString().split('T')[0]})...`);

    // Aggregate papers by region
    const result = await client.query(
      `SELECT
        region,
        COUNT(*) as studies_count,
        COUNT(DISTINCT journal) as datasets_count,
        MODE() WITHIN GROUP (ORDER BY taxa) as dominant_taxa,
        MODE() WITHIN GROUP (ORDER BY framework) as dominant_framework,
        MODE() WITHIN GROUP (ORDER BY ecosystem) as dominant_ecosystem,
        jsonb_agg(DISTINCT methods) FILTER (WHERE methods IS NOT NULL) as methods,
        string_agg(DISTINCT title, ' | ') as titles_sample
      FROM analyzed_papers
      WHERE week_number = $1 AND region IS NOT NULL
      GROUP BY region`,
      [weekNumber]
    );

    // Calculate activity scores and trends
    const trends = [];
    for (const row of result.rows) {
      const activityScore = (
        (row.studies_count * 10) +
        (row.datasets_count * 15)
      );

      // Generate topic focus from titles (skip for now to speed up testing)
      const topicFocus = row.titles_sample ? row.titles_sample.split(' | ')[0].substring(0, 100) : 'Marine conservation research';

      // Determine trend (compare to previous week)
      const trend = await calculateTrend(row.region, weekNumber);

      // Flatten methods array
      const methodsFlat = row.methods
        ? Array.from(new Set(row.methods.flat().filter(Boolean)))
        : [];

      await client.query(
        `INSERT INTO weekly_trends
         (week_start, region, activity_score, studies_count, datasets_count,
          researchers_count, topic_focus, trend, dominant_taxa,
          dominant_framework, dominant_ecosystem, methods)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (week_start, region) DO UPDATE SET
          activity_score = EXCLUDED.activity_score,
          studies_count = EXCLUDED.studies_count,
          datasets_count = EXCLUDED.datasets_count,
          researchers_count = EXCLUDED.researchers_count,
          topic_focus = EXCLUDED.topic_focus,
          trend = EXCLUDED.trend,
          dominant_taxa = EXCLUDED.dominant_taxa,
          dominant_framework = EXCLUDED.dominant_framework,
          dominant_ecosystem = EXCLUDED.dominant_ecosystem,
          methods = EXCLUDED.methods`,
        [
          weekStart,
          row.region,
          activityScore,
          row.studies_count,
          row.datasets_count,
          0, // researchers_count (removed from aggregation)
          topicFocus,
          trend,
          row.dominant_taxa,
          row.dominant_framework,
          row.dominant_ecosystem,
          JSON.stringify(methodsFlat),
        ]
      );

      trends.push({
        region: row.region,
        activity_score: activityScore,
        studies_count: row.studies_count,
        topic_focus: topicFocus,
        trend,
      });
    }

    console.log(`✓ Generated ${trends.length} weekly trends`);
    return trends;
  } catch (error) {
    console.error('Trend generation error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Generate concise topic focus from paper titles using AI
 * @param {string} titlesSample - Sample of paper titles
 * @returns {Promise<string>} One-line topic focus
 */
async function generateTopicFocus(titlesSample) {
  if (!titlesSample) return 'Marine conservation research';

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 100,
      system: 'You are an expert at summarizing research themes. Generate concise, informative topic summaries.',
      messages: [
        {
          role: 'user',
          content: `Summarize the main research theme from these paper titles in ONE concise sentence (max 10 words):\n\n${titlesSample.substring(0, 500)}`,
        },
      ],
    });

    const focus = message.content[0].text.trim().replace(/['"]/g, '');
    return focus.length > 100 ? focus.substring(0, 97) + '...' : focus;
  } catch (error) {
    console.error('Topic focus generation error:', error.message);
    return 'Marine conservation research';
  }
}

/**
 * Calculate trend direction by comparing to previous week
 * @param {string} region - Region name
 * @param {number} currentWeek - Current week number
 * @returns {Promise<string>} Trend direction: 'increasing', 'stable', 'decreasing'
 */
async function calculateTrend(region, currentWeek) {
  try {
    const result = await pool.query(
      `SELECT activity_score
       FROM weekly_trends
       WHERE region = $1 AND week_start = (
         SELECT MAX(week_start) FROM weekly_trends
         WHERE region = $1 AND EXTRACT(WEEK FROM week_start) < $2
       )`,
      [region, currentWeek]
    );

    if (result.rows.length === 0) {
      return 'stable'; // No previous data
    }

    const previousScore = result.rows[0].activity_score;
    const currentResult = await pool.query(
      `SELECT SUM(
         (CASE WHEN framework IS NOT NULL THEN 10 ELSE 0 END) +
         (CASE WHEN taxa IS NOT NULL THEN 15 ELSE 0 END) +
         (CASE WHEN ecosystem IS NOT NULL THEN 5 ELSE 0 END)
       ) as current_score
       FROM analyzed_papers
       WHERE region = $1 AND week_number = $2`,
      [region, currentWeek]
    );

    const currentScore = currentResult.rows[0]?.current_score || 0;
    const change = ((currentScore - previousScore) / previousScore) * 100;

    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  } catch (error) {
    console.error('Trend calculation error:', error.message);
    return 'stable';
  }
}

/**
 * Get ISO week number from date
 * @param {Date} date - Date to get week number for
 * @returns {number} ISO week number
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Run the complete weekly intelligence pipeline
 * @param {Object} options - Pipeline options
 * @param {Date} options.fromDate - Start date for paper search (default: 7 days ago)
 * @param {Date} options.toDate - End date for paper search (default: today)
 * @param {number} options.limit - Max papers to fetch from CrossRef (default: 200)
 * @param {number} options.minKeywords - Min keywords for filtering (default: 2)
 * @param {number} options.batchSize - Papers per AI call (default: 5)
 * @returns {Promise<Object>} Pipeline results
 */
async function runWeeklyPipeline(options = {}) {
  const {
    fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    toDate = new Date(),
    limit = 200,
    minKeywords = 2,
    batchSize = 5,
  } = options;

  console.log('\n========================================');
  console.log('COMPASS ID Research Intelligence Pipeline');
  console.log('========================================\n');
  console.log(`Period: ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`);
  console.log(`Settings: ${limit} papers max, ${minKeywords}+ keywords, ${batchSize} papers/batch\n`);

  const startTime = Date.now();

  try {
    // Step 1: Fetch papers from CrossRef
    console.log('Step 1: Fetching papers from CrossRef...');
    const allPapers = await fetchFromCrossRef({ fromDate, toDate, limit });

    // Step 2: Filter by conservation keywords
    console.log('\nStep 2: Filtering papers by conservation keywords...');
    const relevantPapers = filterRelevantPapers(allPapers, minKeywords);

    if (relevantPapers.length === 0) {
      console.log('\n⚠ No relevant papers found. Pipeline complete.');
      return { success: true, papers: 0, trends: 0 };
    }

    // Step 3: AI batch analysis
    console.log('\nStep 3: AI batch analysis...');
    const analyzedPapers = await batchAnalyzePapers(relevantPapers, batchSize);

    // Step 4: Save to database
    console.log('\nStep 4: Saving papers to database...');
    const weekNumber = getWeekNumber(fromDate);
    const savedCount = await savePapers(analyzedPapers, weekNumber);

    // Step 5: Generate weekly trends
    console.log('\nStep 5: Generating weekly trends...');
    const trends = await generateWeeklyTrends(fromDate);

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n========================================');
    console.log('Pipeline Complete ✓');
    console.log('========================================');
    console.log(`Duration: ${duration}s`);
    console.log(`Papers analyzed: ${analyzedPapers.length}`);
    console.log(`Papers saved: ${savedCount}`);
    console.log(`Trends generated: ${trends.length}`);
    console.log('========================================\n');

    return {
      success: true,
      papers: savedCount,
      trends: trends.length,
      duration: parseFloat(duration),
    };
  } catch (error) {
    console.error('\n✗ Pipeline failed:', error.message);
    throw error;
  }
}

export {
  fetchFromCrossRef,
  filterRelevantPapers,
  batchAnalyzePapers,
  savePapers,
  generateWeeklyTrends,
  runWeeklyPipeline,
  getWeekNumber,
};
