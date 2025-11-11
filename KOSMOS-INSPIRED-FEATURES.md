# Kosmos-Inspired Features for COMPASS ID

## What is Kosmos?

**Kosmos: An AI Scientist for Autonomous Discovery** (arXiv 2511.02824) is a groundbreaking system that automates scientific research end-to-end. Key characteristics:

- **12-hour research cycles** performing 200+ agent rollouts
- **42,000 lines of code** executed per run (data analysis)
- **1,500 papers** read and synthesized per run
- **79.4% accuracy** on scientific statements (independently verified)
- **7 real discoveries** across 4 scientific fields
- **6 months of human research** equivalent per 20-cycle run

**Core Innovation**: Structured world model that enables coherent long-term research pursuit across hundreds of agent iterations.

---

## Priority 1: Quick Wins (Implement First)

### 1. Automated Research Gap Detector

**Description**: Automatically identifies understudied areas in conservation research by analyzing metadata across multiple dimensions.

**How It Works**:
```javascript
// Leverage existing compass_metadata table
1. Query all papers by: ecosystem × method × taxon × region combinations
2. Use Claude 3.5 Sonnet to identify "cold spots" (underrepresented combinations)
3. Generate hypotheses about why gaps exist (funding, methodological barriers, etc.)
4. Rank gaps by conservation priority (species threat level, ecosystem urgency)
5. Compare to SDG targets and CBD goals for policy relevance
```

**Implementation Details**:
- **New endpoint**: `GET /api/analytics/research-gaps`
- **Database queries**:
  ```sql
  -- Count papers by category combinations
  SELECT
    c.ecosystem_type,
    UNNEST(c.methods) as method,
    UNNEST(c.taxon_scope) as taxon,
    COUNT(*) as paper_count
  FROM compass_metadata c
  GROUP BY ecosystem_type, method, taxon
  ORDER BY paper_count ASC;
  ```
- **AI Analysis**: Claude 3.5 Sonnet analyzes distribution patterns
- **Cost**: ~$0.10 per full analysis
- **Runtime**: 2-3 minutes for 1,936 papers
- **Caching**: Daily refresh, cached results for 24 hours

**Output Format**:
```json
{
  "success": true,
  "generatedAt": "2025-11-11T10:30:00Z",
  "gaps": [
    {
      "category": "methodological",
      "description": "Marine mammals using eDNA",
      "currentPaperCount": 3,
      "expectedPaperCount": 45,
      "gapSize": "93% understudied",
      "hypothesis": "Methodological barriers: eDNA protocols for marine mammals are nascent compared to terrestrial species",
      "priority": "high",
      "sdgRelevance": ["SDG 14: Life Below Water"],
      "potentialImpact": "Could revolutionize marine conservation monitoring",
      "relatedPapers": [{ "id": 123, "title": "..." }]
    }
  ],
  "summary": {
    "totalGaps": 47,
    "criticalGaps": 12,
    "topPriorities": ["Marine eDNA", "Desert ecosystem restoration", "Urban wildlife corridors"]
  }
}
```

**Frontend Integration**:
- Add new card to Analytics page: "Research Gap Analysis"
- Display top 10 gaps with visualizations (heatmaps, bar charts)
- Allow filtering by ecosystem, method, taxon, SDG
- Click gap → view related papers + literature suggestions

**Value Proposition**:
- PhD students: Dissertation topic discovery
- Funders: Identify high-impact funding opportunities
- Policy makers: Data-driven conservation priorities
- Researchers: 3 months of gap analysis → 5 minutes

**Estimated Effort**: 4-6 hours
**Cost per Analysis**: $0.08-0.12
**User Impact**: High

---

## Priority 2: Medium Complexity (Implement After MVP)

### 2. Conservation Strategy Synthesizer

**Description**: Given a conservation challenge, automatically synthesizes evidence-based recommendations by analyzing your entire database.

**How It Works**:
```javascript
// Multi-agent approach (inspired by Kosmos world model)
Agent 1: Literature Search
  - Input: Natural language query (e.g., "best practices for arid restoration")
  - Uses existing natural language search API
  - Filters by relevance, recency, citations
  - Returns top 50-100 papers

Agent 2: Evidence Extraction
  - Parses methods, conservation actions, outcomes from metadata
  - Extracts success rates, cost estimates, timeframes
  - Identifies geographic/ecological contexts

Agent 3: Synthesis & Recommendation
  - Groups similar approaches
  - Ranks by evidence strength (paper count, citations, success rate)
  - Generates structured strategy report with citations
  - Includes caveats (context-dependent, limited evidence, etc.)
```

**Implementation Details**:
- **New endpoint**: `POST /api/research/synthesize-strategy`
- **Request body**:
  ```json
  {
    "query": "best practices for arid ecosystem restoration",
    "filters": {
      "regions": ["Africa", "Middle East"],
      "dateRange": { "start": "2020", "end": "2025" },
      "minCitations": 5
    },
    "outputFormat": "detailed" // or "brief"
  }
  ```
- **AI Model**: Claude 3.5 Sonnet (for synthesis quality)
- **Cost**: ~$0.05-0.10 per report (depending on paper count)
- **Runtime**: 30-60 seconds
- **Caching**: Cache common queries for 7 days

**Output Format**:
```json
{
  "success": true,
  "query": "best practices for arid ecosystem restoration",
  "papersAnalyzed": 47,
  "strategies": [
    {
      "name": "Community-based restoration with native species",
      "evidenceStrength": "strong",
      "paperCount": 23,
      "avgCitationCount": 34,
      "successRate": "78% (18/23 studies reported positive outcomes)",
      "keyFindings": [
        "Native species show 3x higher survival rates than introduced species",
        "Community engagement reduces poaching by 65%",
        "Cost-effective: $500-$2000 per hectare"
      ],
      "geographicContext": ["Sahel", "Horn of Africa", "Arabian Peninsula"],
      "timeframe": "3-5 years to measurable impact",
      "caveats": [
        "Requires long-term community buy-in",
        "May not work in areas with severe degradation"
      ],
      "topPapers": [
        { "id": 456, "title": "...", "citations": 78, "year": 2023 }
      ]
    },
    {
      "name": "Assisted natural regeneration",
      "evidenceStrength": "moderate",
      "paperCount": 12,
      "...": "..."
    }
  ],
  "summary": "Based on 47 studies from 2020-2025, community-based restoration with native species shows the strongest evidence...",
  "dataGaps": [
    "Limited long-term (>10 year) outcome data",
    "Few cost-benefit analyses available"
  ],
  "disclaimer": "This synthesis is based on available peer-reviewed literature and should be validated with local expertise."
}
```

**Frontend Integration**:
- New page: `/research/strategy-synthesizer`
- Input: Natural language query + filters (like advanced search)
- Output: Interactive report with expandable sections
- Download as PDF or Markdown
- Share link with collaborators
- Cite COMPASS ID as source

**Use Cases**:
- Conservation NGO: "What worked for elephant-human conflict in East Africa?"
- Government agency: "Best practices for marine protected area management"
- Researcher: "What conservation methods have highest ROI in tropical forests?"

**Estimated Effort**: 8-12 hours
**Cost per Synthesis**: $0.05-0.10
**User Impact**: Very High (replaces 6+ months of manual literature review)

---

### 3. Trending Conservation Discoveries (Weekly Digest)

**Description**: Automated weekly analysis that identifies emerging patterns, novel combinations, or surprising findings in recently imported papers.

**How It Works**:
```javascript
// Runs after weekly-import-conservation-papers.js
1. Compare this week's papers to historical database
   - New method combinations (e.g., "ML + camera traps + snow leopards")
   - Emerging threats (e.g., 15% increase in microplastic studies)
   - Geographic shifts (e.g., new conservation hotspots)
   - Novel frameworks (e.g., first papers linking SDG 13 + 15)

2. Pattern Detection Algorithm:
   - TF-IDF for emerging keywords
   - Temporal analysis (month-over-month growth rates)
   - Network analysis (co-occurrence of methods/taxa/ecosystems)
   - Citation velocity (rapidly cited recent papers)

3. Generate Discovery Report:
   - Top 5 emerging trends
   - 3 novel research combinations
   - 2 surprising findings (unexpected correlations)
   - Annotated with paper citations
```

**Implementation Details**:
- **New script**: `scripts/weekly-discovery-analysis.js`
- **Runs**: After weekly paper import (automated cron job)
- **Database**: Store trends in `conservation_trends` table
- **AI Model**: Claude 3.5 Haiku (cost-effective for pattern detection)
- **Cost**: ~$0.15-0.25 per week
- **Runtime**: 5-10 minutes

**Database Schema**:
```sql
CREATE TABLE conservation_trends (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  trend_type VARCHAR(50), -- 'emerging_method', 'new_threat', 'geographic_shift', etc.
  trend_name VARCHAR(255),
  description TEXT,
  paper_count INTEGER,
  growth_rate DECIMAL,
  confidence_score DECIMAL, -- 0.0 to 1.0
  related_paper_ids INTEGER[],
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Output Format** (Email Digest):
```markdown
# This Week in Conservation Research
*November 4-11, 2025 | COMPASS ID Trends Report*

## 🔥 Emerging Trends

### 1. AI-Powered Acoustic Monitoring for Bats (↑ 45% this month)
**15 new papers** explore using machine learning with acoustic sensors for bat population monitoring.
This represents a 45% increase compared to October 2025.

**Why it matters**: Cost-effective, non-invasive method for monitoring nocturnal species.

**Key papers**:
- *"Deep Learning for Bat Call Classification"* (Nature Ecology, 2025) - 12 citations
- *"Automated Bat Monitoring in Wind Farms"* (Conservation Biology, 2025) - 8 citations

[View all papers →]

---

### 2. Microplastic Threats in Freshwater Ecosystems (↑ 23% this quarter)
**18 papers** document microplastic impacts on freshwater biodiversity.

**Surprising finding**: Invertebrates show 3x higher sensitivity than fish species.

**Geographic focus**: Europe (40%), Asia (35%), North America (25%)

[View all papers →]

---

## 🆕 Novel Research Combinations

### First Use: eDNA + Citizen Science for Urban Wildlife
**3 papers** combine environmental DNA sampling with citizen science platforms for urban biodiversity monitoring.

**Potential**: Democratizes conservation monitoring in cities.

[View papers →]

---

## 📊 By the Numbers

- **39 new papers** added this week
- **12 countries** represented
- **8 ecosystems** covered
- Top framework: **SDG 15** (Life on Land) - 28% of papers

---

*Want to customize your digest? [Update preferences]*
*Have feedback? [Contact us]*
```

**Frontend Integration**:
- New section on homepage: "This Week's Trends"
- Archive of past weekly reports: `/trends/archive`
- Subscribe to email digest (user preferences)
- RSS feed for automated consumption

**Estimated Effort**: 10-15 hours (including email infrastructure)
**Cost per Week**: $0.20-0.30
**User Impact**: Medium-High (keeps users engaged weekly)

---

## Priority 3: Advanced Features (Future)

### 4. Hypothesis Generator for Conservation Challenges

**Description**: Given a conservation challenge and dataset, automatically generate testable hypotheses similar to Kosmos's hypothesis generation capability.

**Example Query**: "Why are elephant populations declining in Botswana?"

**System Response**:
```markdown
# Generated Hypotheses (Ranked by Evidence Strength)

## Hypothesis 1: Human-wildlife conflict intensification (Strong Evidence)
**Based on**: 23 papers, 890 citations
**Mechanism**: Agricultural expansion into wildlife corridors
**Testable prediction**: Elephant mortality should correlate with farmland proximity
**Data needed**: GPS collar data + land use maps
**Related papers**: [...]

## Hypothesis 2: Climate-driven habitat shifts (Moderate Evidence)
**Based on**: 12 papers, 450 citations
**Mechanism**: Drought reducing water sources
**Testable prediction**: Migration patterns shifting toward permanent water bodies
**Data needed**: Rainfall data + movement tracking
**Related papers**: [...]

## Hypothesis 3: Disease outbreaks (Weak Evidence)
**Based on**: 4 papers, 89 citations
**Mechanism**: Novel pathogen introduction
**Testable prediction**: Pathogen prevalence correlates with mortality
**Data needed**: Necropsy results + disease surveillance
**Related papers**: [...]
```

**Implementation Complexity**: High
**Estimated Effort**: 20-30 hours
**Requires**: Integration with external data sources (climate, land use, GPS tracking)

---

### 5. Automated Meta-Analysis Pipeline

**Description**: Full Kosmos-style multi-day research runs that conduct meta-analyses on specific conservation questions.

**Workflow**:
```javascript
Day 1: Literature Search (Agent 1)
  - Search COMPASS ID database
  - Fetch additional papers from CrossRef/OpenAlex
  - Extract relevant statistics (effect sizes, sample sizes, p-values)

Day 2: Data Extraction & Quality Assessment (Agent 2)
  - Parse methods sections for study design
  - Extract quantitative results
  - Assess publication bias risk

Day 3: Statistical Analysis (Agent 3)
  - Run meta-analysis (forest plots, funnel plots)
  - Calculate pooled effect sizes
  - Test for heterogeneity

Day 4: Report Generation (Agent 4)
  - Generate publication-ready manuscript draft
  - Create visualizations (ggplot2 via Python/R integration)
  - Compile references
```

**Example Output**: "Meta-analysis of camera trap effectiveness for tiger population estimation (N=47 studies, pooled detection rate = 0.68, 95% CI [0.61-0.75])"

**Implementation Complexity**: Very High
**Estimated Effort**: 40-60 hours
**Requires**: Statistical computing infrastructure (R/Python), multi-day agent orchestration

---

### 6. AI Conservation Research Assistant (Chatbot)

**Description**: Conversational interface where users can have back-and-forth research discussions, similar to ChatGPT but specialized for conservation science.

**Example Conversation**:
```
User: What's the latest on coral reef restoration?

AI: Based on 234 papers in COMPASS ID, coral reef restoration has three dominant approaches:
    1. Coral gardening (156 papers, 78% success rate)
    2. Artificial reefs (89 papers, 65% success rate)
    3. Larval propagation (34 papers, emerging method)

    Would you like to dive deeper into any of these?

User: Tell me more about coral gardening success rates by region

AI: *Analyzes 156 papers*

    Success rates vary significantly by region:
    - Caribbean: 82% (N=67 papers)
    - Indo-Pacific: 76% (N=71 papers)
    - Red Sea: 89% (N=18 papers)

    The Red Sea shows highest success, likely due to [hypothesis based on papers].

    Should I generate a detailed regional comparison report?
```

**Implementation Complexity**: Medium-High
**Estimated Effort**: 15-25 hours
**Requires**: Conversational memory management, streaming responses

---

## Technical Architecture

### Shared Infrastructure Needs

**1. Agent Orchestration Layer**
```javascript
// services/agentOrchestrator.js
class AgentOrchestrator {
  constructor() {
    this.worldModel = {}; // Kosmos-inspired shared state
    this.agents = [];
  }

  async runResearchCycle(objective, maxCycles = 20) {
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      // Parallel agent execution
      const results = await Promise.all(
        this.agents.map(agent => agent.execute(this.worldModel))
      );

      // Update shared world model
      this.updateWorldModel(results);

      // Check if objective achieved
      if (this.isObjectiveAchieved(objective)) break;
    }

    return this.generateReport();
  }
}
```

**2. Caching Layer**
```javascript
// Avoid re-analyzing same papers repeatedly
const analysisCache = new Map(); // or Redis for production

async function analyzeWithCache(cacheKey, analysisFn) {
  if (analysisCache.has(cacheKey)) {
    return analysisCache.get(cacheKey);
  }

  const result = await analysisFn();
  analysisCache.set(cacheKey, result, { ttl: 86400 }); // 24h cache
  return result;
}
```

**3. Cost Tracking**
```javascript
// Track AI costs per feature
const costTracker = {
  researchGaps: { calls: 0, cost: 0 },
  strategySynthesis: { calls: 0, cost: 0 },
  weeklyTrends: { calls: 0, cost: 0 }
};

// Log to database for billing/analytics
```

---

## Cost Estimates (Monthly)

| Feature | Frequency | Cost per Run | Monthly Cost |
|---------|-----------|--------------|--------------|
| Research Gap Detector | Daily | $0.10 | $3.00 |
| Strategy Synthesizer | On-demand (~50/mo) | $0.08 | $4.00 |
| Weekly Trends | Weekly | $0.25 | $1.00 |
| **Total** | | | **$8.00/mo** |

**Scale Considerations**:
- At 10,000 users with 5 syntheses/user/month: $4,000/month
- Mitigation: Implement rate limits, caching, premium tiers

---

## Prioritized Roadmap

### Phase 1: MVP (Week 1-2)
- ✅ Research Gap Detector (backend endpoint)
- ✅ Frontend integration (Analytics page)
- ✅ Basic caching

### Phase 2: Core Features (Week 3-5)
- ✅ Conservation Strategy Synthesizer
- ✅ Weekly Trends pipeline
- ✅ Email digest infrastructure

### Phase 3: Advanced (Month 2-3)
- ⏳ Hypothesis Generator
- ⏳ Automated Meta-Analysis
- ⏳ AI Research Assistant chatbot

### Phase 4: Optimization (Ongoing)
- ⏳ Cost optimization (caching, rate limits)
- ⏳ Performance monitoring
- ⏳ User feedback iteration

---

## Success Metrics

**Engagement Metrics**:
- Weekly active users of Kosmos features
- Strategy synthesis requests per week
- Email digest open rates

**Impact Metrics**:
- Research gaps cited in grant proposals
- Conservation strategies implemented in field
- Papers published using COMPASS ID synthesis reports

**Technical Metrics**:
- Average response time (target: <60s)
- AI cost per user per month (target: <$0.50)
- Cache hit rate (target: >70%)

---

## References

- **Kosmos Paper**: https://arxiv.org/abs/2511.02824
- **GitHub Implementation**: https://github.com/jimmc414/Kosmos (community adaptation)
- **Claude API Pricing**: https://anthropic.com/pricing
- **COMPASS ID Analytics**: /api/analytics/*

---

## Notes

- **Start small**: Implement Research Gap Detector first (highest ROI)
- **User feedback**: Beta test with conservation researchers before full rollout
- **Cost monitoring**: Set up alerts if AI costs exceed $100/month
- **Ethical considerations**: Always cite source papers, maintain transparency about AI limitations
- **Data privacy**: Ensure user queries are not logged or shared

---

*Document created: 2025-11-11*
*Last updated: 2025-11-11*
*Status: Planning phase*
