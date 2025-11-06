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
 * Generate AI text using Claude API
 * @param {Object} options - Generation options
 * @param {string} options.prompt - The user's prompt/instruction
 * @param {string} options.context - Additional context (grant details, frameworks, documents)
 * @param {string} options.section - Section type (executive, background, methodology, etc.)
 * @param {string} options.template - Template ID for funder-specific guidance (optional)
 * @param {number} options.maxTokens - Maximum tokens to generate (default: 1024)
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateText({ prompt, context = '', section = 'general', template = '', maxTokens = 1024 }) {
  try {
    // Template-specific institutional knowledge
    const templateGuidance = {
      // US Federal Agencies
      'nsf': 'NSF emphasizes BROADER IMPACTS alongside intellectual merit. Highlight societal benefits, education/outreach, diversity, and collaboration. Use clear headings. Be specific about methodological rigor and preliminary results.',
      'nih': 'NIH values innovation, significance, investigator expertise, and strong preliminary data. Emphasize translational potential and public health impact. Include clear specific aims, strong innovation section, and detailed research strategy.',
      'nih-career': 'NIH Career Development awards focus on the applicant\'s development plan. Emphasize mentorship, training activities, career goals, and institutional support. Show clear path to independence.',
      'doe': 'DOE prioritizes energy innovation, scalability, and practical applications. Emphasize technological advancement, energy efficiency, and economic viability. Include technology readiness level (TRL).',
      'noaa': 'NOAA values ecosystem-based management, stakeholder engagement, and actionable science for coastal/marine conservation. Emphasize applied research, data sharing, and policy relevance.',
      'usda': 'USDA emphasizes practical agricultural applications, sustainability, food security, and farmer engagement. Show clear benefits to agricultural communities and environmental stewardship.',
      'epa': 'EPA prioritizes environmental protection, human health impacts, regulatory relevance, and community partnerships. Emphasize science-to-policy pathways and environmental justice.',

      // European Funders
      'horizon-europe': 'Horizon Europe requires clear excellence, impact, and implementation quality. Emphasize European collaboration, open science, innovation potential, and alignment with EU priorities (Green Deal, digital transformation).',
      'erc': 'ERC values groundbreaking, high-risk/high-gain research. Focus on scientific excellence and novelty above all. Demonstrate PI\'s track record and pioneering nature of the work.',
      'marie-curie': 'Marie Curie emphasizes researcher mobility, training, career development, and international collaboration. Highlight transferable skills development and intersectoral partnerships.',
      'life-programme': 'LIFE Programme prioritizes demonstration and best practice projects with replicability. Emphasize concrete environmental/climate benefits, stakeholder engagement, and policy influence.',
      'ukri': 'UKRI values research excellence, societal impact pathways, and partnership approaches. Demonstrate how research addresses UK and global challenges. Strong impact case essential.',
      'nerc': 'NERC emphasizes environmental science excellence and natural environment applications. Show strong methodology, data management plan, and pathway to impact for environmental policy.',
      'leverhulme': 'Leverhulme Trust values curiosity-driven research, interdisciplinarity, and original thinking. Emphasize innovative approaches and willingness to take intellectual risks.',

      // National Geographic & Exploration Foundations
      'natgeo-research': 'National Geographic values storytelling, exploration, conservation impact, and visual documentation. Emphasize fieldwork, discovery potential, species/habitat conservation, and compelling narratives. Include photography/videography plans and public engagement through storytelling.',
      'natgeo-early-career': 'National Geographic Early Career grants seek emerging explorer-scientists with bold ideas and conservation passion. Highlight your unique perspective, field expertise, and commitment to conservation storytelling. Show mentorship and career trajectory.',
      'explorers-club': 'Explorers Club values field-based exploration, scientific discovery, and expanding geographic knowledge. Emphasize remote/challenging fieldwork, exploration objectives, and contributions to understanding Earth and its inhabitants.',
      'explorers-youth': 'Explorers Club Youth Fund supports student explorers. Emphasize educational value, personal growth through exploration, safety planning, and how the project launches your exploration career.',

      // Anthropology Foundations
      'wenner-gren-dissertation': 'Wenner-Gren emphasizes anthropological significance, theoretical contribution, and methodological soundness. Highlight cultural context, ethnographic methods, and how research advances anthropological understanding. Be specific about fieldwork logistics.',
      'wenner-gren-postphd': 'Wenner-Gren Post-PhD grants value innovative anthropological research beyond dissertation. Emphasize new directions, theoretical contribution, and significance to anthropological debates. Show research independence.',
      'leakey': 'Leakey Foundation prioritizes human origins research (paleoanthropology, primatology, archaeology, human evolution). Emphasize fossil/archaeological evidence, evolutionary significance, and field methodology. Include site access and permits.',

      // Conservation Foundations
      'rufford': 'Rufford Foundation supports nature conservation in developing countries, particularly early-career conservationists. Emphasize practical conservation outcomes, community engagement, capacity building, and biodiversity benefits. Show cost-effectiveness.',
      'mbz-species': 'Mohamed bin Zayed Species Conservation Fund supports species-specific conservation projects. Focus on threatened species, clear conservation actions, measurable outcomes, and IUCN Red List relevance. Projects should be practical and time-bound.',
      'disney-conservation': 'Disney Conservation Fund values wildlife conservation, habitat protection, and community engagement (especially programs involving children/families). Emphasize species recovery, ecosystem health, and inspiring conservation action.',

      // International Development & Climate
      'gef': 'GEF requires global environmental benefits, country ownership, stakeholder participation, and sustainability. Emphasize multi-stakeholder approaches, capacity building, and alignment with GEF focal areas (biodiversity, climate, land degradation).',
      'world-bank': 'World Bank values economic development alongside environmental sustainability. Emphasize poverty reduction, climate resilience, scalability, and government partnerships. Include strong monitoring & evaluation.',
      'undp-gef': 'UNDP-GEF Small Grants support community-based conservation. Emphasize local community leadership, grassroots innovation, and sustainable livelihoods linked to conservation. Show community ownership.',

      // Private Foundations
      'moore': 'Moore Foundation supports large-scale, transformative conservation and science. Emphasize systemic change, ambitious goals, innovative approaches, and long-term sustainability. Focus on measurable impact at scale.',
      'packard': 'Packard Foundation values science-based conservation, collaborative approaches, and marine/climate focus. Emphasize rigorous science, partnership models, and policy influence.',
      'pew': 'Pew emphasizes evidence-driven advocacy, marine conservation, and policy change. Show clear pathway from research to policy impact, stakeholder engagement, and communications strategy.',
      'wellcome': 'Wellcome Trust prioritizes bold health research ideas, interdisciplinary approaches, and global health impact. Emphasize innovation, scientific excellence, and potential to transform health outcomes.',
      'gates': 'Gates Foundation focuses on global health equity, poverty alleviation, and scalable solutions. Emphasize cost-effectiveness, delivery mechanisms, partnerships in low-resource settings, and measurable health outcomes.',

      // Other National Funders
      'nserc': 'NSERC values research excellence, training highly qualified personnel (HQP), and potential for Canadian economic/social benefit. Emphasize student training and Canadian research capacity.',
      'arc': 'ARC Discovery Projects emphasize research excellence, innovation, and benefit to Australia. Show strong track record, methodology, and significance to Australian research priorities.',
      'dfg': 'DFG values scientific quality, originality, and contribution to German research landscape. Emphasize rigorous methodology, international collaboration, and advancement of field.',
      'jsps': 'JSPS KAKENHI emphasizes academic excellence, novelty, and feasibility. Show clear research plan, international collaboration potential, and contribution to scientific progress.',
    };

    // Build system prompt based on section type
    const systemPrompts = {
      executive: 'You are an expert grant writer specializing in executive summaries for research proposals. Write concise, compelling summaries that highlight key objectives, significance, and expected impact. IMPORTANT: Review all previously written sections in the context to ensure consistency and coherence across the entire application. Reference specific details from other sections.',
      background: 'You are an expert grant writer specializing in background and significance sections. Provide comprehensive literature reviews, establish research gaps, and justify the importance of the proposed work. IMPORTANT: Build upon details from the Executive Summary and other completed sections. Maintain consistency in terminology, scope, and framing throughout.',
      objectives: 'You are an expert grant writer specializing in research objectives. Articulate clear, specific, measurable objectives that align with funding priorities and policy frameworks. IMPORTANT: Ensure objectives directly connect to the background/significance and align with the executive summary. Use consistent terminology from previous sections.',
      methodology: 'You are an expert grant writer specializing in research methodology. Describe rigorous, feasible methods with appropriate detail on data collection, analysis, and validation. IMPORTANT: Methods must directly address the objectives stated in previous sections. Reference specific goals and maintain consistency with the overall project narrative.',
      impact: 'You are an expert grant writer specializing in impact statements and framework alignment. Clearly connect research outcomes to policy frameworks (SDGs, Paris Agreement, etc.) and demonstrate measurable societal benefits. IMPORTANT: Link impacts directly to objectives and methodology from previous sections. Show how outcomes align with the funder\'s priorities mentioned in the grant template.',
      timeline: 'You are an expert grant writer specializing in project timelines. Create realistic, detailed timelines with clear milestones, deliverables, and risk mitigation strategies. IMPORTANT: Timeline must reflect the methodology and objectives from previous sections. Ensure milestones map to specific research activities already described.',
      budget: 'You are an expert grant writer specializing in budget justification. Provide detailed, well-justified budget explanations that demonstrate value and necessity of each expense. IMPORTANT: Budget items must align with methodology, timeline, and objectives from previous sections. Reference specific activities and justify costs based on the project scope.',
      general: 'You are an expert grant writer for conservation and environmental research. Write compelling, evidence-based content that aligns with academic standards and funder priorities. IMPORTANT: Maintain consistency with all other sections of the grant application. Reference previously written content to ensure a cohesive narrative.',
    };

    let systemPrompt = systemPrompts[section] || systemPrompts.general;

    // Append funder-specific guidance if template is provided
    if (template && templateGuidance[template]) {
      systemPrompt += `\n\nFUNDER-SPECIFIC GUIDANCE: ${templateGuidance[template]}`;
    }

    // Check if citations are requested in the context
    const citationsRequested = context.includes('=== CITATION REQUIREMENTS ===');
    if (citationsRequested) {
      systemPrompt += `\n\nCITATION INSTRUCTIONS: When generating content, include inline citations in standard academic format (Author, Year). Use your knowledge of recent literature (last 5 years when possible) to cite relevant papers that support key claims. Include a mix of seminal works and recent publications. Format citations as: "Recent studies have shown that climate change affects biodiversity (Smith et al., 2023; Johnson & Lee, 2022)." Aim for 5-10 relevant citations throughout the text to demonstrate comprehensive literature knowledge.`;
    }

    // Build user message with context
    let userMessage = '';
    if (context) {
      userMessage += `Context:\n${context}\n\n`;
    }
    userMessage += `Task: ${prompt}`;

    // Call Claude API
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022', // Using Haiku for cost-effectiveness
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    // Extract generated text
    const generatedText = message.content[0].text;

    return {
      success: true,
      text: generatedText,
      metadata: {
        model: message.model,
        tokensUsed: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          total: message.usage.input_tokens + message.usage.output_tokens,
        },
        stopReason: message.stop_reason,
      },
    };
  } catch (error) {
    console.error('Claude API Error:', error);

    // Return error with helpful message
    return {
      success: false,
      error: error.message || 'Failed to generate text',
      metadata: {
        errorType: error.type || 'unknown',
      },
    };
  }
}

/**
 * Generate suggestions for research paper tagging
 * @param {Object} options - Suggestion options
 * @param {string} options.title - Paper title
 * @param {string} options.abstract - Paper abstract
 * @param {Array} options.existingTags - Already applied tags
 * @returns {Promise<Object>} Suggested frameworks and tags
 */
async function generateResearchSuggestions({ title, abstract, existingTags = [] }) {
  try {
    const prompt = `Given this research paper, suggest relevant policy frameworks and tags.

Title: ${title}

Abstract: ${abstract}

${existingTags.length > 0 ? `Already tagged with: ${existingTags.join(', ')}` : ''}

Provide suggestions in this JSON format:
{
  "frameworks": ["SDG X: Name", "Policy Framework"],
  "species": ["species names if applicable"],
  "methods": ["research methods used"],
  "geographic": ["countries/regions"],
  "rationale": "Brief explanation of suggestions"
}`;

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system: 'You are an expert in environmental policy frameworks and research classification. Analyze research papers and suggest appropriate policy framework alignments, species, methods, and geographic tags.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].text;

    // Try to parse JSON response
    try {
      const suggestions = JSON.parse(responseText);
      return {
        success: true,
        suggestions,
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    } catch (parseError) {
      // If JSON parsing fails, return raw text
      return {
        success: true,
        suggestions: { rationale: responseText },
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    }
  } catch (error) {
    console.error('Claude Suggestions Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate suggestions',
    };
  }
}

/**
 * Generate research chat response with context awareness
 * @param {Object} options - Chat options
 * @param {string} options.question - User's question
 * @param {Array} options.papers - Selected research papers context
 * @param {Array} options.frameworks - Selected policy frameworks
 * @param {Array} options.geography - Selected geographic regions
 * @param {Array} options.taxonomy - Selected species/taxa
 * @param {Array} options.conversationHistory - Previous messages for context
 * @returns {Promise<Object>} AI response with insights
 */
async function generateResearchChat({ question, papers = [], frameworks = [], geography = [], taxonomy = [], conversationHistory = [] }) {
  try {
    // Build context string
    let contextParts = [];

    if (papers.length > 0) {
      contextParts.push(`Research Papers Context (${papers.length} papers):\n${papers.map(p => {
        let paperInfo = `- ${p.title}`;
        if (p.year) paperInfo += ` (${p.year})`;
        if (p.doi) paperInfo += ` [DOI: ${p.doi}]`;
        if (p.authors) paperInfo += ` - ${p.authors}`;
        return paperInfo;
      }).join('\n')}`);
    }

    if (frameworks.length > 0) {
      contextParts.push(`Policy Frameworks:\n${frameworks.map(f => `- ${f.name || f}`).join('\n')}`);
    }

    if (geography.length > 0) {
      contextParts.push(`Geographic Regions:\n${geography.map(g => `- ${g.name || g}`).join('\n')}`);
    }

    if (taxonomy.length > 0) {
      contextParts.push(`Species/Taxa:\n${taxonomy.map(t => {
        const scientificName = t.scientificName || t.scientific_name;
        const commonName = t.commonName || t.common_name;
        const name = t.name;

        if (scientificName && commonName) {
          return `- ${scientificName} (${commonName})`;
        } else if (scientificName) {
          return `- ${scientificName}`;
        } else if (commonName) {
          return `- ${commonName}`;
        } else {
          return `- ${name || t}`;
        }
      }).join('\n')}`);
    }

    const context = contextParts.length > 0 ? contextParts.join('\n\n') : 'No specific research context selected.';

    // Build conversation messages
    const messages = [];

    // Add conversation history (last 5 messages for context)
    if (conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-5);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.type === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current question with context
    messages.push({
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: ${question}`,
    });

    // Call Claude API
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      system: 'You are an expert research assistant specializing in environmental science, conservation biology, and policy frameworks. Your role is to analyze research papers and provide insights on their alignment with international policy frameworks (SDGs, Paris Agreement, CBD, etc.). Provide clear, evidence-based responses with specific citations and policy implications. Format your responses with clear headings using **markdown bold**.',
      messages,
    });

    const responseText = message.content[0].text;

    return {
      success: true,
      response: responseText,
      metadata: {
        model: message.model,
        tokensUsed: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          total: message.usage.input_tokens + message.usage.output_tokens,
        },
        contextUsed: {
          papers: papers.length,
          frameworks: frameworks.length,
          geography: geography.length,
          taxonomy: taxonomy.length,
        },
      },
    };
  } catch (error) {
    console.error('Claude Research Chat Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate response',
      metadata: {
        errorType: error.type || 'unknown',
      },
    };
  }
}

/**
 * Generate filter suggestions based on search query
 * @param {Object} options - Query options
 * @param {string} options.query - User's search query
 * @returns {Promise<Object>} Suggested filters (frameworks, geography, taxonomy, methods)
 */
async function generateFilterSuggestions({ query }) {
  try {
    const prompt = `Analyze this search query and suggest relevant research filters to help narrow down results.

Search Query: "${query}"

Provide filter suggestions in this JSON format:
{
  "frameworks": ["SDG X: Name", "Policy Framework Name"],
  "geography": ["Country/Region names"],
  "taxonomy": ["Species/taxa names if relevant"],
  "methods": ["Research method names"]
}

Guidelines:
- For frameworks: Suggest 2-5 relevant SDGs, international agreements (Paris, CBD, Ramsar, etc.), or regional policies
- For geography: Extract or infer geographic locations mentioned or implied (countries, regions, oceans, etc.)
- For taxonomy: Only suggest if species/organisms are mentioned or clearly relevant
- For methods: Suggest relevant research methodologies (Remote Sensing, Field Surveys, Modeling, etc.)
- Return empty arrays for categories that don't apply to the query`;

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      system: 'You are an expert in environmental research, policy frameworks, and academic search optimization. Analyze search queries and suggest intelligent filters that would help users find relevant research papers.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].text;

    // Try to parse JSON response
    try {
      const suggestions = JSON.parse(responseText);
      return {
        success: true,
        suggestions,
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    } catch (parseError) {
      // If JSON parsing fails, return empty suggestions
      return {
        success: true,
        suggestions: {
          frameworks: [],
          geography: [],
          taxonomy: [],
          methods: []
        },
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
          parseError: 'Failed to parse JSON response',
        },
      };
    }
  } catch (error) {
    console.error('Claude Filter Suggestions Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate filter suggestions',
    };
  }
}

/**
 * Extract geographic location from paper title and abstract using AI
 * @param {Object} options - Location extraction options
 * @param {string} options.title - Paper title
 * @param {string} options.abstract - Paper abstract
 * @returns {Promise<Object>} Geographic location data with coordinates
 */
async function extractLocation({ title, abstract }) {
  try {
    const prompt = `Analyze this research paper and extract the primary geographic location where the research was conducted.

Title: ${title}

Abstract: ${abstract}

Extract the PRIMARY geographic location and provide coordinates. Return your response in this exact JSON format:
{
  "location": {
    "name": "Location Name, Country",
    "lat": latitude as number,
    "lng": longitude as number,
    "confidence": "high|medium|low",
    "source": "explicit mention in abstract|inferred from context|title only"
  },
  "rationale": "Brief explanation of why this location was selected"
}

Guidelines:
- Return the most specific location possible (e.g., "Great Barrier Reef, Australia" rather than just "Australia")
- Coordinates should be decimal degrees (e.g., -18.2871, 147.6992)
- Use approximate center coordinates for large regions
- If multiple locations are mentioned, choose the PRIMARY study site
- If no clear location can be determined, set confidence to "low" and use best inference
- Only return JSON, no additional text`;

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      system: 'You are an expert in geographic information extraction and geocoding. You analyze research papers and extract precise geographic locations with coordinates. You have deep knowledge of world geography, ecosystems, protected areas, and research sites.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].text;

    // Try to parse JSON response
    try {
      const result = JSON.parse(responseText);
      return {
        success: true,
        location: {
          lat: result.location.lat,
          lng: result.location.lng,
          name: result.location.name,
          extracted_by_ai: true,
          confidence: result.location.confidence,
          source: result.location.source,
        },
        rationale: result.rationale,
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    } catch (parseError) {
      return {
        success: false,
        error: 'Failed to parse location data from AI response',
        rawResponse: responseText,
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    }
  } catch (error) {
    console.error('Claude Location Extraction Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to extract location',
    };
  }
}

/**
 * Extract comprehensive metadata for research papers (location + all tags)
 * @param {Object} options - Extraction options
 * @param {string} options.title - Paper title
 * @param {string} options.abstract - Paper abstract
 * @returns {Promise<Object>} Complete metadata including location, ecosystems, methods, frameworks, taxonomy, scope, temporal range
 */
async function extractComprehensiveMetadata({ title, abstract }) {
  try {
    const prompt = `Analyze this research paper and extract comprehensive metadata including geographic location, ecosystem types, research methods, policy frameworks, taxonomic coverage, geographic scope, and temporal range.

Title: ${title}

Abstract: ${abstract}

Extract ALL relevant metadata and return your response in this exact JSON format:
{
  "location": {
    "name": "Primary study location (e.g., 'Great Barrier Reef, Australia')",
    "latitude": latitude as number,
    "longitude": longitude as number,
    "confidence": confidence score 0.0-1.0
  },
  "ecosystem_types": ["Array of ecosystem types from: Marine & Coastal, Tropical Forests, Temperate Forests, Grasslands & Savannas, Wetlands, Mountains & Alpine, Desert & Arid, Freshwater, Urban & Built, Agricultural, Other/Mixed"],
  "research_methods": ["Array of research methods using ONLY these exact terms: 'Remote Sensing', 'Satellite Imagery', 'Aerial Surveys', 'Drone/UAV Monitoring', 'LiDAR', 'Satellite Tracking', 'GPS Telemetry', 'Radio Telemetry', 'Acoustic Telemetry', 'Geolocators', 'Field Surveys', 'Transect Surveys', 'Point Count Surveys', 'Mark-Recapture', 'Quadrat Sampling', 'Plot Sampling', 'Ecological Surveys', 'Species Inventories', 'Biodiversity Assessment', 'Camera Traps', 'Underwater Photography', 'Time-Lapse Photography', 'Video Analysis', 'Acoustic Monitoring', 'Bioacoustics', 'Passive Acoustic Monitoring (PAM)', 'Hydrophone Arrays', 'DNA Barcoding', 'eDNA (Environmental DNA)', 'Genomic Sequencing', 'Metabarcoding', 'Microsatellite Analysis', 'Population Genetics', 'Genetic Analysis', 'Phylogenetic Analysis', 'Isotope Analysis', 'Species Distribution Modeling', 'Population Viability Analysis', 'Habitat Suitability Modeling', 'Climate Modeling', 'Agent-Based Modeling', 'Artificial Intelligence', 'AI', 'Machine Learning', 'Deep Learning', 'Neural Networks', 'Convolutional Neural Networks (CNN)', 'Recurrent Neural Networks (RNN)', 'R-CNN', 'Fast R-CNN', 'Faster R-CNN', 'YOLO (Object Detection)', 'Random Forest', 'Support Vector Machines (SVM)', 'Decision Trees', 'Gradient Boosting', 'XGBoost', 'k-Nearest Neighbors (k-NN)', 'Naive Bayes', 'Ensemble Methods', 'Transfer Learning', 'Computer Vision', 'Image Classification', 'Object Detection', 'Semantic Segmentation', 'Natural Language Processing (NLP)', 'Big Data', 'Big Data Analytics', 'Large-Scale Data Analysis', 'High-Throughput Data Processing', 'Data Mining', 'GIS Analysis', 'Statistical Analysis', 'Modeling', 'Population Modeling', 'Ecosystem Modeling', 'Habitat Modeling', 'Water Quality Sampling', 'Soil Sampling', 'Sediment Core Analysis', 'Tissue Sampling', 'Plankton Tows', 'Laboratory Analysis', 'Environmental Monitoring', 'Citizen Science', 'Crowdsourced Data', 'Interview Surveys', 'Participatory Monitoring', 'Questionnaire', 'Interviews', 'Focus Groups', 'Participatory Mapping', 'Experimental Manipulation', 'Controlled Experiments', 'Mesocosm Studies', 'Translocation Experiments', 'Experimental Design', 'Meta-Analysis', 'Literature Review', 'Systematic Review'. Select ALL that apply. If a method is not in this list, choose the closest match."],
  "frameworks": ["Array of policy frameworks using ONLY these EXACT formats: 'SDG 1', 'SDG 2', 'SDG 4', 'SDG 5', 'SDG 6', 'SDG 7', 'SDG 8', 'SDG 9', 'SDG 10', 'SDG 12', 'SDG 13', 'SDG 14', 'SDG 15', 'SDG 16', 'SDG 17', 'CBD', 'Paris Agreement', 'Ramsar Convention', 'CITES', 'CCAMLR', 'CCAMLR Objective I', 'CCAMLR Objective II', 'CCAMLR Objective III', 'CCAMLR Objective IV', 'CCAMLR Objective V', 'CCAMLR Objective VI', 'CCAMLR Objective VII', 'CCAMLR Objective VIII', 'CCAMLR Objective IX', 'CCAMLR Objective X', 'CCAMLR Objective XI', 'OSPAR Convention', 'Barcelona Convention', 'Helsinki Convention', 'Cartagena Convention', 'Nairobi Convention', 'IUCN Red List', 'Endangered Species Act', 'Kyoto Protocol', 'Montreal Protocol', 'Nagoya Protocol', 'Bonn Convention', 'UNCCD', 'UNFCCC', 'UN Convention on the Law of the Sea', 'Minamata Convention', 'Stockholm Convention', 'Basel Convention', 'Rotterdam Convention', 'World Heritage Convention', 'Aichi Biodiversity Targets', 'Kunming-Montreal Global Biodiversity Framework'. DO NOT include SDG 3 (human health) or SDG 11 (urban planning) as these are not biodiversity-focused. DO NOT add descriptions, numbers in parentheses, or colons after SDG numbers. Use ONLY these exact strings."],
  "taxonomic_coverage": ["CRITICAL - BE VERY AGGRESSIVE ABOUT EXTRACTING TAXONOMIC INFORMATION. Array of species with format 'Group: Common name (Scientific name) [IUCN status if applicable]'. Use these taxonomic groups: 'Mammals', 'Birds', 'Reptiles', 'Amphibians', 'Marine Fish', 'Freshwater Fish', 'Insects', 'Arachnids', 'Crustaceans', 'Mollusks', 'Corals & Cnidarians', 'Echinoderms', 'Other Invertebrates', 'Vascular Plants', 'Bryophytes', 'Algae', 'Fungi', 'Lichens', 'Bacteria', 'Protists', 'Multiple Taxa', 'Ecosystem-level'. Examples: 'Mammals: Amur leopard (Panthera pardus orientalis) [CR]', 'Birds: California condor (Gymnogyps californianus) [CR]', 'Vascular Plants: Giant sequoia (Sequoiadendron giganteum)', 'Marine Fish: Atlantic bluefin tuna (Thunnus thynnus) [EN]', 'Corals & Cnidarians: Staghorn coral (Acropora cervicornis) [CR]'. IMPORTANT EXTRACTION RULES: (1) Look for species/taxa in BOTH title AND abstract, (2) Extract taxonomic patterns from titles: 'X frogs' → 'Amphibians: X frogs', 'Y birds' → 'Birds: Y', 'Z coral' → 'Corals & Cnidarians: Z', (3) Extract ALL genus and species names from abstract (often in italics or Latin binomial format), (4) Map common names to taxonomic groups: frogs/toads/salamanders → Amphibians, birds/avian → Birds, fish/piscine → Marine Fish/Freshwater Fish, coral/cnidarian → Corals & Cnidarians, trees/plants/flora → Vascular Plants, fungi/mushrooms → Fungi, (5) If title/abstract mentions 'biodiversity' or 'multiple species' without specifics, use 'Multiple Taxa', (6) ALWAYS extract broad taxonomic group even if no species name (e.g., if abstract says 'amphibians are declining' but no species, add 'Amphibians'), (7) For genus-level mentions, use format 'Group: Genus sp.' (e.g., 'Amphibians: Indirana sp.'), (8) Extract ALL species mentioned, not just the first one. If no specific species mentioned, use broad group only."],
  "geographic_scope": "One of: Site-specific, Local, Regional, National, Continental, Global",
  "temporal_range": {
    "start": year as integer (start of study period),
    "end": year as integer (end of study period)
  },
  "data_availability": "One of: Open Access, Public Dataset Available, Code/Scripts Available, Restricted Access, No Data Available",
  "threat_types": ["Array of threats mentioned: Habitat Loss, Climate Change, Overexploitation, Invasive Species, Pollution, Disease, Human-Wildlife Conflict, Other"],
  "conservation_actions": ["Array of conservation actions discussed: Protected Areas, Habitat Restoration, Species Reintroduction, Legislation/Policy, Community-Based Conservation, Indigenous-Led Conservation, Traditional Ecological Knowledge (TEK), Ethnobotany, Traditional Fire Management, Sacred Natural Sites, Community Conserved Areas, Ex-situ Conservation, Monitoring, Co-Management, Traditional Resource Management, Indigenous Land Rights, Other"],
  "study_type": "One of: Field Study, Modeling/Simulation, Literature Review, Meta-Analysis, Experimental, Mixed Methods, Other",
  "traditional_knowledge_present": "Boolean: true if the paper discusses traditional ecological knowledge, indigenous knowledge, local ecological knowledge, or community-based traditional practices",
  "rationale": "Brief explanation of extraction choices"
}

Guidelines:
- For location: Extract the PRIMARY geographic study site with approximate center coordinates
- For ecosystem_types: Select ALL relevant ecosystems mentioned in the paper from the provided list
- For research_methods: CRITICAL - Use ONLY the exact terms from the provided list. Map specific methods to the closest standard term (e.g., '16S rRNA sequencing' → 'Genomic Sequencing', 'quadrat analysis' → 'Quadrat Sampling'). Select ALL applicable methods.
- For frameworks: CRITICAL - Use ONLY the exact framework names from the list. For SDGs, use format 'SDG X' with NO descriptions (e.g., 'SDG 15' NOT 'SDG 15: Life on Land' or 'SDG 15 (Life on Land)'). Match the paper's goals to relevant SDGs and conventions.
- For taxonomic_coverage: CRITICAL - BE EXTREMELY AGGRESSIVE. This is a core feature. Extract species from BOTH title and abstract. Rules: (1) Title patterns: "diversity of X frogs" → extract "Amphibians: X frogs", "coral communities" → "Corals & Cnidarians", (2) Scientific names: Look for italicized text, Latin binomial names (e.g., Panthera leo, Indirana beddomii), genus names followed by species epithets, (3) Extract ALL species/genus mentions, not just the main focus, (4) Common name mapping: frogs/anurans/toads → Amphibians, birds/avian → Birds, coral/cnidarian → Corals & Cnidarians, trees/shrubs/herbs → Vascular Plants, fish → Marine Fish or Freshwater Fish based on context, (5) For genus-only mentions use "Group: Genus sp." format (e.g., "Amphibians: Indirana sp."), (6) Extract broad taxonomic groups even without species (if abstract discusses "amphibian conservation" with no specific species, still add "Amphibians"), (7) Multiple species: Extract ALL, don't limit to one, (8) IUCN status: Include if mentioned (CR, EN, VU, NT, LC, DD), (9) Format: "Group: Common name (Scientific name) [IUCN status]". Examples: Title "High cryptic diversity of endemic Indirana frogs" + Abstract mentions "Amphibians...Indirana beddomii...Indirana diplosticta" → Extract ["Amphibians: Indirana frogs (Indirana sp.)", "Amphibians: Indirana beddomii", "Amphibians: Indirana diplosticta"]. If no specific species, use broad group only.
- For geographic_scope: Use 'Site-specific' for single location studies, 'Local' for city/region, 'Regional' for multi-state/province, 'National' for country-wide, 'Continental' for multi-country, 'Global' for worldwide
- For temporal_range: Extract the years covered by the study period (when data was collected, not publication year)
- For data_availability: Check if paper mentions data sharing, code availability, or open access data. Select most specific option.
- For threat_types: Identify conservation threats discussed in the paper
- For conservation_actions: List conservation interventions or management strategies discussed. IMPORTANT: If the paper discusses traditional ecological knowledge (TEK), indigenous knowledge, local ecological knowledge, indigenous peoples' practices, traditional resource management, or community-based traditional conservation, include 'Traditional Ecological Knowledge (TEK)' and/or 'Indigenous-Led Conservation'. Be specific: use 'Ethnobotany' for plant-people relationships, 'Traditional Fire Management' for cultural burning practices, 'Sacred Natural Sites' for culturally significant protected areas, 'Community Conserved Areas' for ICCAs.
- For study_type: Classify the primary research approach used
- For traditional_knowledge_present: Set to true if the paper discusses any form of traditional, indigenous, or local ecological knowledge, indigenous land management, traditional fire practices, sacred sites, or indigenous peoples' role in conservation. This is IMPORTANT for identifying papers that integrate traditional and scientific knowledge.
- Only return valid JSON, no additional text`;

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1000,
      system: 'You are an expert in environmental research metadata extraction. You analyze research papers and extract comprehensive metadata including geographic location, ecosystem types, research methods, policy framework alignment, taxonomic coverage, and study characteristics. You have deep knowledge of world geography, ecosystems, conservation biology, and international policy frameworks.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].text;

    // Try to parse JSON response
    try {
      // Clean up potential markdown code blocks and extract JSON
      let cleanedResponse = responseText.trim();

      // Remove markdown code blocks
      if (cleanedResponse.includes('```json')) {
        const match = cleanedResponse.match(/```json\s*\n([\s\S]*?)\n```/);
        if (match) {
          cleanedResponse = match[1];
        } else {
          cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```/g, '');
        }
      } else if (cleanedResponse.includes('```')) {
        const match = cleanedResponse.match(/```\s*\n([\s\S]*?)\n```/);
        if (match) {
          cleanedResponse = match[1];
        } else {
          cleanedResponse = cleanedResponse.replace(/```/g, '');
        }
      }

      // If response has extra text after JSON, extract only the JSON object
      // Look for first { and last }
      const firstBrace = cleanedResponse.indexOf('{');
      const lastBrace = cleanedResponse.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
      }

      const result = JSON.parse(cleanedResponse);

      // Structure response to match frontend expectations
      return {
        success: true,
        data: {
          location: result.location ? {
            name: result.location.name,
            latitude: result.location.latitude,
            longitude: result.location.longitude,
            confidence: result.location.confidence || 0.5
          } : null,
          ecosystem_types: result.ecosystem_types || [],
          research_methods: result.research_methods || [],
          frameworks: result.frameworks || [],
          taxonomic_coverage: result.taxonomic_coverage || [],
          geographic_scope: result.geographic_scope || null,
          temporal_range: result.temporal_range || null,
          data_availability: result.data_availability || null,
          threat_types: result.threat_types || [],
          conservation_actions: result.conservation_actions || [],
          study_type: result.study_type || null,
          traditional_knowledge_present: result.traditional_knowledge_present || false,
          confidence: result.location?.confidence || 0.5,
          rationale: result.rationale
        },
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    } catch (parseError) {
      console.error('Failed to parse comprehensive metadata JSON:', parseError);
      return {
        success: false,
        error: 'Failed to parse metadata response',
        rawResponse: responseText,
        metadata: {
          tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
        },
      };
    }
  } catch (error) {
    console.error('Claude Comprehensive Metadata Extraction Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to extract comprehensive metadata',
    };
  }
}

/**
 * Generate conversational search assistant response
 * Handles paper analysis, summarization, research gap identification, and paper selection control
 * @param {Object} options - Assistant options
 * @param {string} options.message - User's message/question
 * @param {Array} options.conversationHistory - Previous messages in the conversation
 * @param {Array} options.currentPapers - Currently displayed/selected papers
 * @returns {Promise<Object>} Assistant response with message, filters, and actions
 */
async function generateSearchAssistantResponse({ message, conversationHistory = [], currentPapers = [] }) {
  try {
    const client = getAnthropicClient();

    // Prepare paper context for Claude
    const paperContext = currentPapers.length > 0
      ? `Currently viewing ${currentPapers.length} papers:\n\n` +
        currentPapers.slice(0, 20).map((paper, idx) =>
          `${idx + 1}. "${paper.title}" (${paper.year || 'n/a'}) by ${paper.authors || 'Unknown'}\n` +
          `   Location: ${paper.location || 'Not specified'}\n` +
          `   Ecosystems: ${(paper.ecosystems || []).join(', ') || 'None'}\n` +
          `   Methods: ${(paper.methods || []).join(', ') || 'None'}\n` +
          `   Taxonomic Coverage: ${(paper.taxonomic_coverage || []).join(', ') || 'None'}`
        ).join('\n\n') +
        (currentPapers.length > 20 ? `\n\n...and ${currentPapers.length - 20} more papers.` : '')
      : 'No papers currently selected or displayed.';

    // Build conversation messages for Claude
    const messages = [
      ...conversationHistory.slice(-10).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      })),
      {
        role: 'user',
        content: message
      }
    ];

    const systemPrompt = `You are a highly knowledgeable and engaging conservation research assistant for the COMPASSID platform. Your role is to help researchers discover, analyze, and understand conservation research papers.

YOUR CAPABILITIES:
1. **Paper Discovery**: Help users find papers by location, species, ecosystem, research methods, or frameworks
2. **Paper Analysis**: Summarize papers, identify key findings, discuss methodologies
3. **Research Gap Identification**: Analyze collections of papers to identify gaps, trends, and opportunities
4. **Map Control**: Select/deselect papers on the interactive map based on criteria
5. **Conversational Guidance**: Provide friendly, expert guidance on conservation research

CURRENT CONTEXT:
${paperContext}

HOW TO RESPOND:
- Be conversational, friendly, and enthusiastic about conservation research
- When analyzing papers, provide specific insights and cite paper titles
- When identifying research gaps, be specific and actionable
- When suggesting searches, use locations, species, ecosystems, methods, or time periods
- If asked to select papers, provide clear selection criteria
- CRITICAL: Do NOT include JSON code blocks in your message text - only plain conversational text
- The JSON structure is for data only - users see a friendly message, not code

YOUR RESPONSE FORMAT (JSON):
{
  "message": "Your friendly, detailed response to the user (markdown supported)",
  "filters": {
    "locations": ["location1", "location2"],
    "species": ["species1"],
    "ecosystems": ["ecosystem1"],
    "methods": ["method1"],
    "frameworks": ["framework1"],
    "dateRange": { "min": 2020, "max": 2024 }
  },
  "selectPapers": {
    "action": "select_matching" | "deselect_all" | "select_all",
    "criteria": {
      "location": "string",
      "ecosystems": ["ecosystem1"],
      "species": ["species1"]
    }
  },

IMPORTANT SELECTION RULES:
- "select_matching" REPLACES the current selection with ONLY papers matching criteria (automatically deselects others)
- "select_all" selects all papers with coordinates
- "deselect_all" clears all selections
- DO NOT use both "deselect_all" and "select_matching" - just use "select_matching" alone
- CRITICAL: When selecting from CURRENT papers, use ONLY "selectPapers" - do NOT include "applyToMap: true" or "filters"
- Use "applyToMap: true" and "filters" ONLY when searching for NEW papers that aren't currently loaded
  "actions": [
    {
      "label": "Action button label",
      "icon": "map" | "filter" | "clock",
      "filters": { ... }
    }
  ],
  "applyToMap": true/false
}

EXAMPLES OF GREAT RESPONSES:

User: "Do you see the papers selected?"
Response: {
  "message": "Yes! I can see ${currentPapers.length} papers currently displayed. These include research from [locations] focusing on [ecosystems/species]. Would you like me to summarize them, identify research gaps, or help you filter them by specific criteria?",
  "applyToMap": false
}

User: "Summarize the selected papers"
Response: {
  "message": "Here's a summary of the ${currentPapers.length} papers:\n\n**Geographic Coverage**: [locations]\n**Ecosystems**: [most common]\n**Key Methods**: [methods]\n**Research Trends**: [insights]\n\nThe collection shows strength in [area] but gaps in [area]. Notable papers include...",
  "applyToMap": false
}

User: "Find elephant papers in Kenya after 2020"
Response: {
  "message": "I'll search for elephant conservation research in Kenya from 2020 onwards. This will help us understand recent elephant population dynamics and conservation efforts in East Africa.",
  "filters": {
    "locations": ["Kenya"],
    "species": ["Elephants"],
    "dateRange": { "min": 2020, "max": 2024 }
  },
  "applyToMap": true,
  "actions": [
    { "label": "Show only Kenya papers", "icon": "map", "filters": { "locations": ["Kenya"] } },
    { "label": "All elephant research", "icon": "filter", "filters": { "species": ["Elephants"] } }
  ]
}

User: "Only select papers in Mongolia" or "Show only Mongolia papers on the map"
Response: {
  "message": "I'll display only the 7 papers from Mongolia on the map. These include research from the Gobi Desert and Mongolian Steppe covering topics like pastoral systems, drought dynamics, and desert dust impacts.",
  "selectPapers": {
    "action": "select_matching",
    "criteria": {
      "location": "Mongolia"
    }
  }
}

NOTE: No "applyToMap" or "filters" fields - we're selecting from current papers, not searching for new ones!

Remember: Be specific, insightful, and helpful. Reference actual paper details when analyzing the current selection.`;

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      system: systemPrompt,
      messages: messages,
    });

    const responseText = response.content[0].text;

    // Try to parse as JSON first (for structured responses)
    try {
      const structuredResponse = JSON.parse(responseText);
      return {
        success: true,
        ...structuredResponse,
        metadata: {
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        }
      };
    } catch (parseError) {
      // If not JSON, return as plain message
      return {
        success: true,
        message: responseText,
        applyToMap: false,
        metadata: {
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        }
      };
    }
  } catch (error) {
    console.error('Search Assistant Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate assistant response',
    };
  }
}

module.exports = {
  generateText,
  generateResearchSuggestions,
  generateResearchChat,
  generateFilterSuggestions,
  extractLocation,
  extractComprehensiveMetadata,
  generateSearchAssistantResponse
};
