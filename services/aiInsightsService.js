import Anthropic from '@anthropic-ai/sdk';

// Lazy initialization
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

/**
 * Analyze research gaps by finding understudied combinations
 * @param {Array} papers - Papers with metadata
 * @returns {Promise<Object>} Research gaps with priorities
 */
async function analyzeResearchGaps(papers) {
  try {
    const client = getAnthropicClient();

    // Aggregate metadata for analysis
    const methodCounts = {};
    const ecosystemCounts = {};
    const speciesCounts = {};
    const regionCounts = {};

    papers.forEach(paper => {
      // Count methods - JSONB field with nested structure
      if (paper.methods && typeof paper.methods === 'object') {
        const methods = paper.methods.research_methods || paper.methods;
        if (Array.isArray(methods)) {
          methods.forEach(method => {
            const methodName = typeof method === 'string' ? method : (method.method || method.name);
            if (methodName) {
              methodCounts[methodName] = (methodCounts[methodName] || 0) + 1;
            }
          });
        }
      }

      // Count ecosystems - TEXT field (singular)
      if (paper.ecosystem_type) {
        ecosystemCounts[paper.ecosystem_type] = (ecosystemCounts[paper.ecosystem_type] || 0) + 1;
      }

      // Count species - JSONB array with {common_name, scientific_name}
      if (paper.taxon_scope && Array.isArray(paper.taxon_scope)) {
        paper.taxon_scope.forEach(taxon => {
          const name = taxon.common_name || taxon.scientific_name || taxon;
          if (name) {
            speciesCounts[name] = (speciesCounts[name] || 0) + 1;
          }
        });
      }

      // Count regions - TEXT field (singular)
      if (paper.geo_scope_text) {
        regionCounts[paper.geo_scope_text] = (regionCounts[paper.geo_scope_text] || 0) + 1;
      }
    });

    const prompt = `You are a conservation research analyst. Analyze this metadata distribution and identify the TOP 10 most critical research gaps.

METADATA SUMMARY (from ${papers.length} papers):

Top Methods:
${Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `- ${k}: ${v} papers`).join('\n')}

Top Ecosystems:
${Object.entries(ecosystemCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `- ${k}: ${v} papers`).join('\n')}

Top Species/Taxa:
${Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `- ${k}: ${v} papers`).join('\n')}

Top Regions:
${Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `- ${k}: ${v} papers`).join('\n')}

Identify the TOP 10 research gaps by analyzing:
1. Underrepresented method × ecosystem combinations (e.g., "eDNA in Arid ecosystems")
2. Underrepresented species × region combinations (e.g., "Marine mammals in Africa")
3. Methodological gaps (e.g., "Acoustic monitoring underused for amphibians")
4. Geographic gaps (e.g., "Central Asian grasslands understudied")

For each gap, provide:
- category: "methodological", "geographic", "taxonomic", or "cross-domain"
- title: Short descriptive title (max 60 chars)
- description: One-sentence explanation of the gap
- currentPaperCount: Estimated current papers (based on data)
- expectedPaperCount: What you'd expect given the importance
- gapSizePercentage: How understudied (percentage)
- hypothesis: Why this gap exists (1 sentence)
- priority: "critical", "high", "medium", or "low"
- potentialImpact: Conservation impact if gap filled (1 sentence)

Return ONLY valid JSON with this structure:
{
  "gaps": [
    {
      "category": "methodological",
      "title": "eDNA for Marine Mammals",
      "description": "Environmental DNA methods are rarely applied to marine mammal conservation despite proven effectiveness",
      "currentPaperCount": 3,
      "expectedPaperCount": 45,
      "gapSizePercentage": 93,
      "hypothesis": "Methodological barriers and lack of cross-discipline collaboration",
      "priority": "critical",
      "potentialImpact": "Could revolutionize non-invasive marine mammal monitoring"
    }
  ],
  "summary": "Brief 2-sentence summary of overall gap patterns",
  "totalGapsIdentified": 10
}`;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;

    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse research gaps response:', content);
      throw new Error('Failed to parse AI response');
    }

    const cost = (response.usage.input_tokens * 3.00 / 1000000) + (response.usage.output_tokens * 15.00 / 1000000);

    return {
      success: true,
      gaps: parsed.gaps || [],
      summary: parsed.summary || '',
      totalGapsIdentified: parsed.totalGapsIdentified || 0,
      cost,
      usage: response.usage
    };

  } catch (error) {
    console.error('Error analyzing research gaps:', error);
    throw error;
  }
}

/**
 * Synthesize conservation strategy from research corpus
 * @param {string} query - Natural language query (e.g., "best practices for arid ecosystem restoration")
 * @param {Array} relevantPapers - Papers matching the query
 * @returns {Promise<Object>} Evidence-based strategy
 */
async function synthesizeConservationStrategy(query, relevantPapers) {
  try {
    const client = getAnthropicClient();

    // Prepare paper summaries for analysis
    const paperSummaries = relevantPapers.slice(0, 50).map(p => ({
      title: p.title,
      authors: p.authors || [],
      year: p.publication_year,
      journal: p.journal,
      citations: p.citations || 0,
      methods: p.methods || [],
      conservationActions: p.conservation_actions || [],
      threatTypes: p.threat_types || [],
      outcomes: p.outcomes || 'Not specified'
    }));

    const prompt = `You are a conservation strategy synthesizer. Based on ${relevantPapers.length} research papers, generate an evidence-based conservation strategy for:

QUERY: "${query}"

RELEVANT RESEARCH (Top ${paperSummaries.length} papers):
${JSON.stringify(paperSummaries, null, 2)}

Generate a comprehensive conservation strategy with:

1. **Executive Summary** (2-3 sentences): Key findings and recommended approach

2. **Top 5 Evidence-Based Strategies** (ranked by evidence strength):
   For each strategy:
   - strategy: Clear action item
   - evidenceStrength: "strong", "moderate", or "limited"
   - supportingPapers: Number of papers supporting this
   - successRate: Percentage success rate if available
   - implementationCost: "low", "medium", or "high"
   - timeframe: "immediate", "short-term", "long-term"
   - description: 2-sentence explanation with specific examples

3. **Key Considerations**:
   - risks: Potential risks or limitations
   - prerequisites: What's needed before implementation
   - monitoringMetrics: How to measure success

4. **Citation Recommendations**: Top 3 most relevant papers to read

Return ONLY valid JSON with this structure:
{
  "query": "original query",
  "executiveSummary": "...",
  "strategies": [
    {
      "rank": 1,
      "strategy": "Implement community-based conservation programs",
      "evidenceStrength": "strong",
      "supportingPapers": 23,
      "successRate": 78,
      "implementationCost": "medium",
      "timeframe": "short-term",
      "description": "Detailed explanation..."
    }
  ],
  "considerations": {
    "risks": ["risk 1", "risk 2"],
    "prerequisites": ["prereq 1", "prereq 2"],
    "monitoringMetrics": ["metric 1", "metric 2"]
  },
  "topPapers": [
    {
      "title": "...",
      "authors": "...",
      "year": 2023,
      "relevance": "Why this paper is critical"
    }
  ],
  "analysisQuality": {
    "paperCount": 47,
    "averageCitations": 23,
    "evidenceLevel": "high"
  }
}`;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 3072,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;

    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse strategy synthesis response:', content);
      throw new Error('Failed to parse AI response');
    }

    const cost = (response.usage.input_tokens * 3.00 / 1000000) + (response.usage.output_tokens * 15.00 / 1000000);

    return {
      success: true,
      ...parsed,
      cost,
      usage: response.usage
    };

  } catch (error) {
    console.error('Error synthesizing strategy:', error);
    throw error;
  }
}

/**
 * Identify trending discoveries from recent papers
 * @param {Array} recentPapers - Papers from last 90 days
 * @param {Array} historicalPapers - Papers from 1-3 years ago for comparison
 * @returns {Promise<Object>} Trending discoveries
 */
async function identifyTrendingDiscoveries(recentPapers, historicalPapers) {
  try {
    const client = getAnthropicClient();

    // Aggregate recent trends
    const recentMethodCounts = {};
    const recentTopicCounts = {};
    const recentSpeciesCounts = {};

    recentPapers.forEach(paper => {
      // Methods - JSONB with nested structure
      if (paper.methods && typeof paper.methods === 'object') {
        const methods = paper.methods.research_methods || paper.methods;
        if (Array.isArray(methods)) {
          methods.forEach(m => {
            const name = typeof m === 'string' ? m : (m.method || m.name);
            if (name) recentMethodCounts[name] = (recentMethodCounts[name] || 0) + 1;
          });
        }
      }
      // Species - taxon_scope JSONB array
      if (paper.taxon_scope && Array.isArray(paper.taxon_scope)) {
        paper.taxon_scope.forEach(taxon => {
          const name = taxon.common_name || taxon.scientific_name || taxon;
          if (name) recentSpeciesCounts[name] = (recentSpeciesCounts[name] || 0) + 1;
        });
      }
      // Ecosystems - use ecosystem_type for topic counting
      if (paper.ecosystem_type) {
        recentTopicCounts[paper.ecosystem_type] = (recentTopicCounts[paper.ecosystem_type] || 0) + 1;
      }
    });

    // Aggregate historical trends
    const historicalMethodCounts = {};
    const historicalTopicCounts = {};
    const historicalSpeciesCounts = {};

    historicalPapers.forEach(paper => {
      // Methods - JSONB with nested structure
      if (paper.methods && typeof paper.methods === 'object') {
        const methods = paper.methods.research_methods || paper.methods;
        if (Array.isArray(methods)) {
          methods.forEach(m => {
            const name = typeof m === 'string' ? m : (m.method || m.name);
            if (name) historicalMethodCounts[name] = (historicalMethodCounts[name] || 0) + 1;
          });
        }
      }
      // Species - taxon_scope JSONB array
      if (paper.taxon_scope && Array.isArray(paper.taxon_scope)) {
        paper.taxon_scope.forEach(taxon => {
          const name = taxon.common_name || taxon.scientific_name || taxon;
          if (name) historicalSpeciesCounts[name] = (historicalSpeciesCounts[name] || 0) + 1;
        });
      }
      // Ecosystems - use ecosystem_type for topic counting
      if (paper.ecosystem_type) {
        historicalTopicCounts[paper.ecosystem_type] = (historicalTopicCounts[paper.ecosystem_type] || 0) + 1;
      }
    });

    const prompt = `You are a conservation research trend analyst. Compare recent research (last 90 days) vs historical research (1-3 years ago) and identify the TOP 10 most significant emerging trends.

RECENT RESEARCH (${recentPapers.length} papers, last 90 days):
Top Methods: ${Object.entries(recentMethodCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}
Top Species: ${Object.entries(recentSpeciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}
Top Threats: ${Object.entries(recentTopicCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}

HISTORICAL BASELINE (${historicalPapers.length} papers, 1-3 years ago):
Top Methods: ${Object.entries(historicalMethodCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}
Top Species: ${Object.entries(historicalSpeciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}
Top Threats: ${Object.entries(historicalTopicCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}

Identify TOP 10 discoveries:
1. **Emerging Clusters**: New method/species/region combinations appearing frequently
2. **Rising Topics**: Threats or frameworks gaining 30%+ attention
3. **Novel Methods**: New research approaches appearing for first time
4. **Breakthrough Species**: Species suddenly getting research attention

For each discovery:
- category: "emerging_cluster", "rising_topic", "novel_method", or "breakthrough"
- title: Catchy title (max 60 chars)
- description: What's happening (2 sentences)
- recentPaperCount: Papers in last 90 days
- historicalPaperCount: Papers in baseline period
- growthPercentage: % increase
- significance: "high", "medium", or "low"
- whyNow: Why this trend is emerging now (1 sentence)

Return ONLY valid JSON:
{
  "discoveries": [
    {
      "category": "emerging_cluster",
      "title": "AI + Camera Traps for Snow Leopards",
      "description": "Machine learning models combined with camera trap networks are revolutionizing snow leopard monitoring in remote regions. 8 papers published in last 90 days vs 0 historically.",
      "recentPaperCount": 8,
      "historicalPaperCount": 0,
      "growthPercentage": 100,
      "significance": "high",
      "whyNow": "Recent advances in edge computing and affordable ML hardware"
    }
  ],
  "summary": "Brief 2-sentence summary of overall trend landscape",
  "totalDiscoveries": 10,
  "weekEnding": "2025-11-11"
}`;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;

    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse trending discoveries response:', content);
      throw new Error('Failed to parse AI response');
    }

    const cost = (response.usage.input_tokens * 3.00 / 1000000) + (response.usage.output_tokens * 15.00 / 1000000);

    return {
      success: true,
      discoveries: parsed.discoveries || [],
      summary: parsed.summary || '',
      totalDiscoveries: parsed.totalDiscoveries || 0,
      weekEnding: parsed.weekEnding || new Date().toISOString().split('T')[0],
      cost,
      usage: response.usage
    };

  } catch (error) {
    console.error('Error identifying trending discoveries:', error);
    throw error;
  }
}

export {
  analyzeResearchGaps,
  synthesizeConservationStrategy,
  identifyTrendingDiscoveries
};
