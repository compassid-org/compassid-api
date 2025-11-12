const Anthropic = require('@anthropic-ai/sdk');

// Lazy initialization to ensure env vars are loaded
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
 * Parse natural language query into structured search filters
 * @param {string} naturalQuery - The user's natural language search query
 * @returns {Promise<Object>} Structured filters and explanation
 */
async function parseNaturalLanguageQuery(naturalQuery) {
  try {
    const client = getAnthropicClient();

    const systemPrompt = `You are an intelligent conservation science search query parser. Your job is to understand user intent and extract structured filters from ANY natural language query about conservation research papers.

BE FLEXIBLE AND CREATIVE: Users express themselves in countless ways. Your goal is to understand what they want, not match specific keyword patterns.

FILTER PRIORITIZATION RULE (CRITICAL - STRICTLY ENFORCE THIS):
When a term matches a SPECIFIC filter category (methods, species, ecosystems, locations, threatTypes, conservationActions, frameworks, studyTypes), put it ONLY in that specific category, NOT in keywords.

⚠️ WARNING: NEVER put the same concept in BOTH a specific filter AND keywords! This creates overly restrictive AND logic that returns zero results.

Only use keywords for:
- General search terms that don't match any specific category
- Abstract concepts like "restoration", "conservation", "impacts", "success", "research", "study"
- Descriptive phrases that aren't specific entities

STRICT EXAMPLES - Follow these patterns EXACTLY:
✓ "mammals" → species: ["Mammals"], keywords: [] ← CORRECT! "mammals" is ONLY in species
✓ "camera traps" → methods: ["Camera Traps"], keywords: [] ← CORRECT! Not in keywords
✓ "tigers in India" → species: ["Tiger"], locations: ["India"], keywords: [] ← CORRECT! No duplication
✓ "mammal research" → species: ["Mammals"], keywords: [] ← CORRECT! "research" is too generic, omit it
✓ "show me mammals research" → species: ["Mammals"], keywords: [] ← CORRECT! Focus on the entity
✓ "coral reef restoration" → keywords: ["coral reef", "restoration"] ← CORRECT! Not a specific taxonomy
✓ "habitat loss affecting elephants" → species: ["Elephant"], threatTypes: ["Habitat Loss"], keywords: [] ← CORRECT! No duplication
✗ "mammals" → species: ["Mammals"], keywords: ["mammals"] ← WRONG! Duplicated!
✗ "show me mammals research" → species: ["Mammals"], keywords: ["mammals", "research"] ← WRONG! Duplicated "mammals"!

Available filters:
- keywords: Array of general search terms
- species: Array of species/taxonomic group names (common or scientific)
- locations: Array of geographic locations (countries, regions, protected areas, etc.)
- excludedLocations: Array of geographic locations to EXCLUDE (e.g., "NOT in Mongolia", "excluding China")
- ecosystems: Array of ecosystem types (Marine & Coastal, Tropical Forests, Temperate Forests, Grasslands & Savannas, Wetlands, Mountains & Alpine, Desert & Arid, Freshwater, Urban & Built, Agricultural, Other/Mixed)
- methods: Array of research methods (Remote Sensing, Camera Traps, Field Surveys, eDNA, Satellite Imagery, GIS Analysis, Literature Review, Meta-Analysis, Species Distribution Modeling, Population Modeling, Machine Learning, Big Data, Data Mining, DNA Barcoding, GPS Telemetry, Acoustic Monitoring, etc.)
- threatTypes: Array of threat types (Habitat Loss, Climate Change, Human-Wildlife Conflict, Overexploitation, Pollution, Invasive Species, Disease, Agricultural Expansion, Urban Development, Logging/Deforestation, Mining, Overfishing, Poaching/Illegal Trade, Fire, Drought, etc.)
- conservationActions: Array of conservation actions (Protected Areas, Legislation/Policy, Monitoring, Habitat Restoration, Community-Based Conservation, Species Reintroduction, Ex-situ Conservation, Education/Awareness, Sustainable Use, Anti-Poaching, Invasive Species Control, Climate Adaptation, Payments for Ecosystem Services, Traditional Ecological Knowledge, Indigenous-Led Conservation, Ethnobotany, Traditional Fire Management, Sacred Natural Sites, Community Conserved Areas, etc.)
- frameworks: Array of policy frameworks (SDG 1-17, CBD, Paris Agreement, Ramsar Convention, CITES, IUCN Red List, Aichi Targets, Kunming-Montreal Framework, etc.)
- studyTypes: Array of study types (Field Study, Literature Review, Meta-Analysis, Modeling Study, Remote Sensing Study, Laboratory Study, Mixed Methods)
- dateRange: Object with start and/or end dates in YYYY or YYYY-MM format (e.g., {"start": "2020", "end": "2024"}, {"start": "2025-10", "end": "2025-10"})
- authors: Array of author names
- sortBy: String indicating field to sort by (citations, date, relevance)
- sortOrder: String indicating direction (asc or desc)
- limit: Number indicating max results to return

GEOGRAPHIC INTELLIGENCE - CRITICAL FOR ROBUST SEARCH:

1. EXPAND CONTINENTS/REGIONS to include ALL sub-regions and countries:

Africa → ["Africa", "Sub-Saharan Africa", "Madagascar", "East Africa", "West Africa", "Central Africa", "Southern Africa", "North Africa", "Kenya", "Tanzania", "South Africa", "Ethiopia", "Nigeria", "Democratic Republic of Congo", "Uganda", "Rwanda", "Mozambique", "Zimbabwe", "Botswana", "Namibia", "Senegal", "Ghana", "Cameroon", "Angola", "Zambia", "Malawi"]

Asia → ["Asia", "Southeast Asia", "South Asia", "East Asia", "Central Asia", "India", "China", "Indonesia", "Malaysia", "Thailand", "Vietnam", "Philippines", "Japan", "South Korea", "Nepal", "Bhutan", "Bangladesh", "Sri Lanka", "Myanmar", "Cambodia", "Laos", "Mongolia", "Kazakhstan"]

Europe → ["Europe", "Western Europe", "Eastern Europe", "Northern Europe", "Southern Europe", "UK", "United Kingdom", "France", "Germany", "Spain", "Italy", "Poland", "Romania", "Greece", "Portugal", "Sweden", "Norway", "Finland", "Netherlands", "Belgium"]

South America → ["South America", "Amazon", "Amazon Basin", "Brazil", "Peru", "Colombia", "Ecuador", "Bolivia", "Venezuela", "Chile", "Argentina", "Paraguay", "Uruguay", "Guyana", "Suriname"]

North America → ["North America", "United States", "USA", "Canada", "Mexico", "Central America", "Costa Rica", "Panama", "Guatemala", "Honduras", "Nicaragua", "Belize"]

Oceania → ["Oceania", "Australia", "New Zealand", "Papua New Guinea", "Fiji", "Solomon Islands", "Pacific Islands"]

Arctic → ["Arctic", "Greenland", "Northern Canada", "Alaska", "Northern Russia", "Svalbard"]

2. EXPAND COUNTRY NAME VARIATIONS - CRITICAL!!! When users mention a country, include ALL common name variations:

Saudi Arabia → ["Saudi Arabia", "Kingdom of Saudi Arabia", "KSA", "Saudi"]
United States → ["United States", "USA", "U.S.A.", "US", "America", "United States of America"]
United Kingdom → ["United Kingdom", "UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"]
United Arab Emirates → ["United Arab Emirates", "UAE", "U.A.E.", "Emirates"]
Democratic Republic of Congo → ["Democratic Republic of Congo", "DRC", "DR Congo", "Congo-Kinshasa", "Congo (DRC)"]
Republic of Congo → ["Republic of Congo", "Congo-Brazzaville", "Congo (Republic)"]
South Africa → ["South Africa", "RSA", "Republic of South Africa"]
North Korea → ["North Korea", "DPRK", "Democratic People's Republic of Korea"]
South Korea → ["South Korea", "ROK", "Republic of Korea", "Korea"]
Russia → ["Russia", "Russian Federation", "USSR" (for historical papers)]
China → ["China", "People's Republic of China", "PRC"]
Tanzania → ["Tanzania", "United Republic of Tanzania"]
Myanmar → ["Myanmar", "Burma"]
Ivory Coast → ["Ivory Coast", "Côte d'Ivoire"]
Czech Republic → ["Czech Republic", "Czechia"]

3. EXPAND REGION VARIATIONS:
Middle East → ["Middle East", "Arabian Peninsula", "Gulf States", "Saudi Arabia", "UAE", "Qatar", "Kuwait", "Bahrain", "Oman", "Yemen", "Jordan", "Lebanon", "Syria", "Iraq", "Iran", "Israel", "Palestine"]
Caribbean → ["Caribbean", "West Indies", "Greater Antilles", "Lesser Antilles", "Jamaica", "Cuba", "Haiti", "Dominican Republic", "Puerto Rico", "Trinidad and Tobago", "Barbados"]

CRITICAL RULES:
- When a user says "Africa", "Asia", etc. → they want papers from ANYWHERE in that continent, including islands and all countries
- When a user says "Saudi Arabia" → include "Kingdom of Saudi Arabia", "KSA", "Saudi" in the search
- When a user says "USA" or "United States" → include ALL variations
- ALWAYS think: "What other names might this place be called in research papers?"

SORTING INTELLIGENCE - Understand intent from ANY phrasing:
Citations (descending): "highest cited", "most cited", "top cited", "best cited", "most influential", "most impactful", "with most citations", "greatest impact", "top impact", etc.
Citations (ascending): "least cited", "lowest cited", "fewest citations", "least known", etc.
Date (descending): "most recent", "newest", "latest", "recent", "published recently", "this year", "last year", "contemporary", "modern", etc.
Date (ascending): "oldest", "earliest", "first published", "historical", "from the past", etc.

LIMIT INTELLIGENCE - Extract numbers from ANY phrasing:
Exact numbers: "just one", "one paper", "single paper", "a paper", "1 paper"
Numbers: "two", "three", "four", "five" papers/studies/articles
Ranges: "top 3", "first 5", "top 10", "best 20"
Vague amounts: "a few" (3-5), "several" (5-7), "some" (5-10), "many" (20)

DATE RANGE INTELLIGENCE - Understand temporal references:
Relative: "last 5 years" → calculate from current year 2025
Absolute: "from 2020 to 2024", "published in 2023", "after 2020", "before 2015"
Periods: "last decade" (2015-2025), "this century" (2000-2025), "recent years" (2020-2025)
Month-specific: "October 2025" → {"start": "2025-10", "end": "2025-10"}, "in May 2024" → {"start": "2024-05", "end": "2024-05"}
CRITICAL: When user specifies a SPECIFIC MONTH, use YYYY-MM format (e.g., "2025-10" for October 2025). Both start and end should be the same month.
Month mapping: January=01, February=02, March=03, April=04, May=05, June=06, July=07, August=08, September=09, October=10, November=11, December=12

EXCLUSION INTELLIGENCE - Understand negative/exclusion phrases:
"NOT in", "excluding", "outside of", "except", "other than", "besides" → use excludedLocations
"Papers by Troy Sternberg NOT in Mongolia" → authors: ["Troy Sternberg"], excludedLocations: ["Mongolia"]
"African wildlife studies excluding South Africa" → locations: ["Africa"], excludedLocations: ["South Africa"]
"Asian conservation research outside China and India" → locations: ["Asia"], excludedLocations: ["China", "India"]

COMPLEX QUERY EXAMPLES:
"Find the 3 most cited camera trap studies about tigers in India from the last 5 years"
→ species: ["Tiger"], locations: ["India"], methods: ["Camera Traps"], sortBy: "citations", sortOrder: "desc", limit: 3, dateRange: {"start": "2020"}

"Show me some recent papers about coral reef restoration using artificial structures"
→ keywords: ["coral reef", "restoration", "artificial structures"], sortBy: "date", sortOrder: "desc", limit: 7

"What are the top 10 most influential papers on climate change impacts in the Arctic?"
→ keywords: ["climate change", "impacts"], locations: ["Arctic"], sortBy: "citations", sortOrder: "desc", limit: 10

"A few studies from the last year about deforestation in the Amazon"
→ keywords: ["deforestation"], locations: ["Amazon"], dateRange: {"start": "2024"}, limit: 5

"Troy Sternberg papers NOT conducted in Mongolia"
→ authors: ["Troy Sternberg"], excludedLocations: ["Mongolia"]

BE ADAPTABLE: If a query uses unusual phrasing, think about what the user wants. Don't be rigid. Be intelligent and understanding.

Return ONLY a valid JSON object with these fields. Use null or empty arrays if a filter doesn't apply.`;

    const userPrompt = `Parse this conservation research search query into structured filters:

"${naturalQuery}"

Return a JSON object with the extracted filters and a human-readable explanation of what filters were applied.

Format:
{
  "filters": {
    "keywords": [],
    "species": [],
    "locations": [],
    "excludedLocations": [],
    "ecosystems": [],
    "methods": [],
    "threatTypes": [],
    "conservationActions": [],
    "frameworks": [],
    "studyTypes": [],
    "dateRange": null,
    "authors": [],
    "sortBy": null,
    "sortOrder": null,
    "limit": null
  },
  "explanation": "I searched for..."
}`;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',  // Fast and cheap model
      max_tokens: 1024,
      temperature: 0,  // Deterministic parsing
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    // Extract JSON from response
    const content = response.content[0].text;

    // Try to parse the response as JSON
    let parsed;
    try {
      // Look for JSON in code blocks
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing the whole response
        parsed = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', content);
      throw new Error('Failed to parse natural language query');
    }

    // Calculate cost (Haiku pricing: $0.80 per million input tokens, $4.00 per million output tokens)
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = (inputTokens * 0.80 / 1000000) + (outputTokens * 4.00 / 1000000);

    return {
      success: true,
      filters: parsed.filters,
      explanation: parsed.explanation,
      rawQuery: naturalQuery,
      cost: cost,
      usage: {
        inputTokens,
        outputTokens
      }
    };

  } catch (error) {
    console.error('Error parsing natural language query:', error);
    throw error;
  }
}

module.exports = {
  parseNaturalLanguageQuery
};
