/**
 * One-time script to generate AI metadata for the existing Bactrian camel paper
 */

const pool = require('./src/config/database.cjs');
const { extractComprehensiveMetadata } = require('./services/claudeService');

async function generateMetadataForPaper(paperId) {
  try {
    console.log(`Generating AI metadata for paper: ${paperId}`);

    // Fetch the paper
    const paperResult = await pool.query(
      'SELECT id, title, abstract FROM research_items WHERE id = $1',
      [paperId]
    );

    if (paperResult.rows.length === 0) {
      console.error('Paper not found');
      return;
    }

    const paper = paperResult.rows[0];
    console.log(`\nPaper Title: ${paper.title.substring(0, 80)}...`);

    // Call AI service to generate comprehensive metadata
    console.log('\nCalling AI service...');
    const result = await extractComprehensiveMetadata({
      title: paper.title,
      abstract: paper.abstract
    });

    if (!result.success) {
      console.error('Failed to generate metadata:', result.error);
      return;
    }

    const metadata = result.data;
    console.log('\nGenerated Metadata:');
    console.log('- Ecosystem Types:', metadata.ecosystem_types);
    console.log('- Research Methods:', metadata.research_methods);
    console.log('- Taxonomic Coverage:', metadata.taxonomic_coverage);
    console.log('- Frameworks:', metadata.frameworks);
    console.log('- Location:', metadata.location);
    console.log('- Geographic Scope:', metadata.geographic_scope);
    console.log('- Temporal Range:', metadata.temporal_range);
    console.log('- Confidence:', metadata.confidence);

    // Update compass_metadata with AI-generated data
    console.log('\nUpdating database...');
    await pool.query(
      `UPDATE compass_metadata SET
        ecosystem_type = COALESCE($1, ecosystem_type),
        methods = COALESCE($2::jsonb, methods),
        taxon_scope = COALESCE($3::jsonb, taxon_scope),
        framework_alignment = COALESCE($4::jsonb, framework_alignment),
        geo_scope_text = COALESCE($5, geo_scope_text),
        temporal_start = COALESCE($6, temporal_start),
        temporal_end = COALESCE($7, temporal_end)
      WHERE research_id = $8`,
      [
        metadata.ecosystem_types && metadata.ecosystem_types.length > 0 ? metadata.ecosystem_types[0] : null,
        metadata.research_methods && metadata.research_methods.length > 0 ? JSON.stringify(metadata.research_methods) : null,
        metadata.taxonomic_coverage && metadata.taxonomic_coverage.length > 0 ? JSON.stringify(metadata.taxonomic_coverage) : null,
        metadata.frameworks && metadata.frameworks.length > 0 ? JSON.stringify(metadata.frameworks) : null,
        metadata.location ? metadata.location.name : null,
        metadata.temporal_range ? `${metadata.temporal_range.start}-01-01` : null,
        metadata.temporal_range ? `${metadata.temporal_range.end}-12-31` : null,
        paperId
      ]
    );

    // If we have location coordinates, update geo_scope_geom as GeoJSON
    if (metadata.location && metadata.location.latitude && metadata.location.longitude) {
      const geoJson = {
        type: 'Point',
        coordinates: [metadata.location.longitude, metadata.location.latitude]
      };

      console.log('- Updating location coordinates:', geoJson);

      await pool.query(
        `UPDATE compass_metadata SET geo_scope_geom = $1 WHERE research_id = $2`,
        [JSON.stringify(geoJson), paperId]
      );
    }

    console.log('\n✓ Metadata generated and saved successfully!');
    console.log('\nYou can now refresh the Geographic Explorer page to see the updated data.');

  } catch (error) {
    console.error('Error generating metadata:', error);
  } finally {
    await pool.end();
  }
}

// Run for the Bactrian camel paper
const PAPER_ID = '55ce7eae-bbce-436a-866c-c40d755c5373';
generateMetadataForPaper(PAPER_ID);
