const pool = require('../config/database.js');
const bcrypt = require('bcryptjs');

async function runSeeds() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Creating sample users...');
    const passwordHash = await bcrypt.hash('demo123456', 10);

    const users = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, institution) VALUES
       ('maria.santos@oceaninstitute.org', $1, 'Maria', 'Santos', 'Ocean Research Institute'),
       ('james.chen@forestlab.edu', $1, 'James', 'Chen', 'Global Forest Conservation Lab'),
       ('aisha.mohamed@climateaction.org', $1, 'Aisha', 'Mohamed', 'Climate Adaptation Research Center')
       RETURNING id`,
      [passwordHash]
    );

    const userIds = users.rows.map(u => u.id);

    console.log('Creating sample research items...');

    const research1 = await client.query(
      `INSERT INTO research_items (user_id, doi, title, abstract, publication_year, journal, authors)
       VALUES ($1, '10.1234/marine.2023.001',
       'Marine Protected Areas and Antarctic Krill Population Dynamics',
       'This study examines the effectiveness of marine protected areas in conserving Antarctic krill populations and their role in the Southern Ocean food web, contributing to CCAMLR conservation objectives.',
       2023,
       'Marine Ecology Progress Series',
       '[{"name": "Maria Santos", "orcid": "0000-0001-2345-6789"}, {"name": "Peter Anderson"}]')
       RETURNING id`,
      [userIds[0]]
    );

    await client.query(
      `INSERT INTO compass_metadata (research_id, framework_alignment, geo_scope, geo_scope_text, taxon_scope, temporal_start, temporal_end, methods)
       VALUES ($1,
       '["SDG-14.2", "SDG-14.5", "CCAMLR"]',
       ST_GeomFromGeoJSON('{"type": "Polygon", "coordinates": [[[-60, -62], [-60, -70], [-45, -70], [-45, -62], [-60, -62]]]}'),
       'Antarctic Peninsula and Scotia Sea',
       '[{"scientific_name": "Euphausia superba", "common_name": "Antarctic krill", "taxon_rank": "species"}]',
       '2020-01-01', '2023-12-31',
       '["Population modeling", "Field surveys", "Remote sensing"]')`,
      [research1.rows[0].id]
    );

    const research2 = await client.query(
      `INSERT INTO research_items (user_id, doi, title, abstract, publication_year, journal, authors)
       VALUES ($1, '10.1234/forest.2024.042',
       'Tropical Forest Restoration and Biodiversity Recovery in Southeast Asia',
       'Assessment of forest restoration efforts in protected areas across Southeast Asia, measuring biodiversity recovery rates and contribution to CBD Target 3 and SDG 15 objectives.',
       2024,
       'Conservation Biology',
       '[{"name": "James Chen"}, {"name": "Lin Wei"}]')
       RETURNING id`,
      [userIds[1]]
    );

    await client.query(
      `INSERT INTO compass_metadata (research_id, framework_alignment, geo_scope, geo_scope_text, taxon_scope, temporal_start, temporal_end, methods)
       VALUES ($1,
       '["CBD-TARGET-3", "CBD-TARGET-2", "SDG-15.1", "SDG-15.5"]',
       ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[100, 5], [100, 20], [110, 20], [110, 5], [100, 5]]]]}'),
       'Thailand, Cambodia, Vietnam - Protected forest areas',
       '[{"scientific_name": "Panthera tigris", "common_name": "Tiger", "taxon_rank": "species"}, {"common_name": "Forest birds", "taxon_rank": "class"}]',
       '2018-01-01', '2023-12-31',
       '["Biodiversity surveys", "GIS analysis", "Camera trapping", "Participatory monitoring"]')`,
      [research2.rows[0].id]
    );

    const research3 = await client.query(
      `INSERT INTO research_items (user_id, doi, title, abstract, publication_year, journal, authors)
       VALUES ($1, '10.1234/climate.2024.089',
       'Climate Adaptation Strategies for Coastal Communities in East Africa',
       'Analysis of community-based adaptation strategies in coastal regions facing sea-level rise and increased storm frequency, supporting SDG 13 and national climate policies.',
       2024,
       'Climate Change Adaptation',
       '[{"name": "Aisha Mohamed"}, {"name": "David Kimani"}]')
       RETURNING id`,
      [userIds[2]]
    );

    await client.query(
      `INSERT INTO compass_metadata (research_id, framework_alignment, geo_scope, geo_scope_text, taxon_scope, temporal_start, temporal_end, methods)
       VALUES ($1,
       '["SDG-13", "SDG-14.2", "UNFCCC"]',
       ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[38, -6], [38, -1], [42, -1], [42, -6], [38, -6]]]]}'),
       'Kenyan and Tanzanian coastal regions',
       '[]',
       '2022-01-01', '2024-06-30',
       '["Community surveys", "Climate modeling", "Economic analysis", "Policy review"]')`,
      [research3.rows[0].id]
    );

    const research4 = await client.query(
      `INSERT INTO research_items (user_id, doi, title, abstract, publication_year, journal, authors)
       VALUES ($1, '10.1234/wetlands.2023.067',
       'Ramsar Wetland Conservation and Migratory Bird Populations',
       'Long-term monitoring of migratory bird populations in designated Ramsar sites, demonstrating the effectiveness of international wetland conservation agreements.',
       2023,
       'Wetlands Ecology and Management',
       '[{"name": "Maria Santos"}, {"name": "Elena Rodriguez"}]')
       RETURNING id`,
      [userIds[0]]
    );

    await client.query(
      `INSERT INTO compass_metadata (research_id, framework_alignment, geo_scope, geo_scope_text, taxon_scope, temporal_start, temporal_end, methods)
       VALUES ($1,
       '["RAMSAR", "CBD-TARGET-3", "SDG-15.1"]',
       ST_GeomFromGeoJSON('{"type": "Point", "coordinates": [-3.7, 40.4]}'),
       'Iberian Peninsula wetlands',
       '[{"common_name": "Migratory waterbirds", "taxon_rank": "order"}]',
       '2015-01-01', '2023-12-31',
       '["Bird counts", "Satellite tracking", "Habitat assessment"]')`,
      [research4.rows[0].id]
    );

    await client.query('COMMIT');
    console.log('Seed data created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeeds().catch(console.error);