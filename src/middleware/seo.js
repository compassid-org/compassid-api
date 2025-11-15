const pool = require('../config/database.js');
const fs = require('fs');
const path = require('path');

/**
 * SEO Middleware: Injects meta tags into HTML for research papers and profiles
 * This enables Google Scholar and other crawlers to properly index metadata
 */
async function injectMetaTags(req, res, next) {
  try {
    // Read the built index.html from frontend dist folder
    const htmlPath = path.join(__dirname, '../../../compassid-frontend/dist/index.html');

    // Check if file exists
    if (!fs.existsSync(htmlPath)) {
      console.error('Frontend build not found at:', htmlPath);
      console.error('Run "npm run build" in compassid-frontend directory first');
      return res.status(500).send('Frontend build not found. Please run build first.');
    }

    let html = fs.readFileSync(htmlPath, 'utf8');

    // Extract slug/compassId from URL
    const pathParts = req.path.split('/').filter(Boolean);
    const resourceType = pathParts[0]; // 'research' or 'profile'
    const identifier = pathParts[1]; // slug or compass_id

    if (resourceType === 'research' && identifier) {
      // Fetch research data
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

      const query = `
        SELECT
          r.id, r.slug, r.title, r.abstract, r.doi, r.publication_year,
          r.journal, r.authors, r.created_at,
          c.framework_alignment, c.geo_scope_text, c.taxon_scope,
          u.first_name, u.last_name, u.institution, u.orcid_id
        FROM research_items r
        JOIN compass_metadata c ON r.id = c.research_id
        JOIN users u ON r.user_id = u.id
        WHERE ${isUUID ? 'r.id = $1' : 'r.slug = $1'}
      `;

      const result = await pool.query(query, [identifier]);

      if (result.rows.length > 0) {
        const research = result.rows[0];
        const escapedTitle = (research.title || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedAbstract = (research.abstract || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Build comprehensive meta tags
        const metaTags = `
    <!-- SEO Meta Tags -->
    <title>${escapedTitle} | COMPASSID</title>
    <meta name="description" content="${escapedAbstract.substring(0, 160)}">

    <!-- Google Scholar Meta Tags (Highwire Press format) -->
    <meta name="citation_title" content="${escapedTitle}">
    <meta name="citation_author" content="${research.first_name} ${research.last_name}">
    ${research.authors ? JSON.parse(research.authors).map(author =>
      `<meta name="citation_author" content="${(author.name || '').replace(/"/g, '&quot;')}">`
    ).join('\n    ') : ''}
    ${research.publication_year ? `<meta name="citation_publication_date" content="${research.publication_year}/01/01">` : ''}
    ${research.journal ? `<meta name="citation_journal_title" content="${research.journal.replace(/"/g, '&quot;')}">` : ''}
    ${research.doi ? `<meta name="citation_doi" content="${research.doi}">` : ''}
    ${research.abstract ? `<meta name="citation_abstract" content="${escapedAbstract}">` : ''}
    <meta name="citation_online_date" content="${new Date(research.created_at).toISOString().split('T')[0]}">
    <meta name="citation_fulltext_html_url" content="https://compassid.org/research/${research.slug || research.id}">

    <!-- Dublin Core Metadata -->
    <meta name="DC.title" content="${escapedTitle}">
    <meta name="DC.creator" content="${research.first_name} ${research.last_name}">
    ${research.abstract ? `<meta name="DC.description" content="${escapedAbstract}">` : ''}
    ${research.publication_year ? `<meta name="DC.date" content="${research.publication_year}">` : ''}
    ${research.doi ? `<meta name="DC.identifier" content="https://doi.org/${research.doi}">` : ''}
    <meta name="DC.type" content="Text.Article">
    ${research.geo_scope_text ? `<meta name="DC.coverage" content="${research.geo_scope_text.replace(/"/g, '&quot;')}">` : ''}

    <!-- OpenGraph Meta Tags -->
    <meta property="og:title" content="${escapedTitle}">
    <meta property="og:description" content="${escapedAbstract.substring(0, 200)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://compassid.org/research/${research.slug || research.id}">
    ${research.publication_year ? `<meta property="article:published_time" content="${research.publication_year}-01-01">` : ''}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapedTitle}">
    <meta name="twitter:description" content="${escapedAbstract.substring(0, 200)}">

    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      "headline": "${escapedTitle}",
      "abstract": "${escapedAbstract}",
      "author": [{
        "@type": "Person",
        "name": "${research.first_name} ${research.last_name}"
        ${research.orcid_id ? `, "identifier": "https://orcid.org/${research.orcid_id}"` : ''}
      }],
      ${research.publication_year ? `"datePublished": "${research.publication_year}-01-01",` : ''}
      ${research.journal ? `"publisher": {"@type": "Organization", "name": "${research.journal.replace(/"/g, '\\"')}"},` : ''}
      ${research.doi ? `"identifier": "https://doi.org/${research.doi}",` : ''}
      ${research.geo_scope_text ? `"spatialCoverage": "${research.geo_scope_text.replace(/"/g, '\\"')}",` : ''}
      ${research.taxon_scope ? `"about": [${JSON.parse(research.taxon_scope).map(t => `{"@type": "Thing", "name": "${t.replace(/"/g, '\\"')}"}`).join(', ')}],` : ''}
      ${research.framework_alignment ? `"keywords": "${JSON.parse(research.framework_alignment).join(', ').replace(/"/g, '\\"')}"` : '"keywords": ""'}
    }
    </script>`;

        // Inject before </head>
        html = html.replace('</head>', metaTags + '\n  </head>');
      } else {
        // Research not found - let React handle 404
        console.log('Research not found:', identifier);
      }
    } else if (resourceType === 'profile' && identifier) {
      // Fetch researcher profile data
      const query = `
        SELECT
          u.compass_id, u.first_name, u.last_name, u.email,
          u.institution, u.bio, u.orcid_id, u.current_position,
          u.website, u.location, u.updated_at, u.created_at
        FROM users u
        WHERE u.compass_id = $1
      `;

      const result = await pool.query(query, [identifier]);

      if (result.rows.length > 0) {
        const user = result.rows[0];
        const escapedBio = (user.bio || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const fullName = `${user.first_name} ${user.last_name}`;

        const metaTags = `
    <!-- SEO Meta Tags -->
    <title>${fullName} | COMPASSID Researcher Profile</title>
    <meta name="description" content="${escapedBio.substring(0, 160) || `${fullName} - ${user.current_position || 'Researcher'} at ${user.institution || 'Research Institution'}`}">

    <!-- OpenGraph Meta Tags -->
    <meta property="og:title" content="${fullName} | COMPASSID">
    <meta property="og:description" content="${escapedBio.substring(0, 200) || `${user.current_position || 'Researcher'} at ${user.institution || ''}`}">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="https://compassid.org/profile/${user.compass_id}">
    <meta property="profile:first_name" content="${user.first_name}">
    <meta property="profile:last_name" content="${user.last_name}">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${fullName}">
    <meta name="twitter:description" content="${escapedBio.substring(0, 200) || `${user.current_position || 'Researcher'} at ${user.institution || ''}`}">

    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": "${fullName}",
      "givenName": "${user.first_name}",
      "familyName": "${user.last_name}",
      ${user.current_position ? `"jobTitle": "${user.current_position.replace(/"/g, '\\"')}",` : ''}
      ${user.institution ? `"worksFor": {"@type": "Organization", "name": "${user.institution.replace(/"/g, '\\"')}"},` : ''}
      ${user.bio ? `"description": "${escapedBio}",` : ''}
      "url": "https://compassid.org/profile/${user.compass_id}"
      ${user.orcid_id ? `, "identifier": "https://orcid.org/${user.orcid_id}"` : ''}
    }
    </script>`;

        html = html.replace('</head>', metaTags + '\n  </head>');
      } else {
        console.log('Profile not found:', identifier);
      }
    }

    // Send the modified HTML
    res.send(html);
  } catch (error) {
    console.error('SEO middleware error:', error);
    // Fallback: serve original HTML without meta tags
    next();
  }
}

module.exports = { injectMetaTags };
