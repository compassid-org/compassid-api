const pool = require('../config/database.js');

const generateSitemap = async (req, res, next) => {
  try {
    // Fetch all research items with slugs
    const researchResult = await pool.query(
      `SELECT slug, updated_at, created_at
       FROM research_items
       WHERE slug IS NOT NULL
       ORDER BY updated_at DESC`
    );

    // Fetch all user profiles (compass_ids)
    const usersResult = await pool.query(
      `SELECT compass_id, updated_at, created_at
       FROM users
       WHERE compass_id IS NOT NULL
       ORDER BY updated_at DESC`
    );

    // Build XML sitemap
    const baseURL = 'https://compassid.org';
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Static Pages -->
  <url>
    <loc>${baseURL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseURL}/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseURL}/map</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseURL}/search</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseURL}/frameworks</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseURL}/blog</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- Research Papers -->
`;

    // Add research items
    researchResult.rows.forEach(research => {
      const lastmod = research.updated_at || research.created_at;
      sitemap += `  <url>
    <loc>${baseURL}/research/${research.slug}</loc>
    <lastmod>${lastmod.toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });

    sitemap += `
  <!-- Researcher Profiles -->
`;

    // Add user profiles
    usersResult.rows.forEach(user => {
      const lastmod = user.updated_at || user.created_at;
      sitemap += `  <url>
    <loc>${baseURL}/profile/${user.compass_id}</loc>
    <lastmod>${lastmod.toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
    });

    sitemap += `</urlset>`;

    // Set headers for XML
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateSitemap
};
