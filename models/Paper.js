// Mock Paper model - returns empty data until database is set up
// TODO: Replace with real database when PostgreSQL is configured

const MOCK_PAPERS = [];

export default class Paper {
  static async search(filters = {}) {
    console.log('[Mock] Searching papers with filters:', filters);

    // Return mock papers with geographic locations for testing
    // TODO: Replace with real database query when PostgreSQL is configured
    return {
      papers: MOCK_PAPERS,
      total: MOCK_PAPERS.length,
      page: filters.page || 1,
      limit: filters.limit || 20
    };
  }
  
  static async findById(id) {
    console.log('[Mock] Finding paper by ID:', id);
    return MOCK_PAPERS.find(p => p.id === id) || null;
  }
  
  static async findByDOI(doi) {
    console.log('[Mock] Finding paper by DOI:', doi);
    return MOCK_PAPERS.find(p => p.doi === doi) || null;
  }
  
  static async create(paperData) {
    console.log('[Mock] Creating paper:', paperData.doi);
    return { id: Math.random().toString(36), ...paperData };
  }
  
  static async updateByDOI(doi, updates) {
    console.log('[Mock] Updating paper:', doi);
    return { doi, ...updates };
  }
  
  static async claimPaper(paperId, userId, orcid) {
    console.log('[Mock] Claiming paper:', paperId);
    const paper = await this.findById(paperId);
    return paper;
  }
  
  static async addFrameworkTag(paperId, userId, framework) {
    console.log('[Mock] Adding framework tag:', framework);
    return { id: Math.random().toString(36), ...framework };
  }

  static async updateGeographicLocation(paperId, location) {
    console.log('[Mock] Updating geographic location for paper:', paperId);
    const paper = await this.findById(paperId);
    if (paper) {
      paper.geographic_location = location;
    }
    return paper;
  }
}
