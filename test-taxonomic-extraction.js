/**
 * Test script to verify enhanced taxonomic extraction
 * Tests the "Indirana frogs" example that was missing taxonomic tags
 */

require('dotenv').config();
const { extractComprehensiveMetadata } = require('./services/claudeService');

const testPaper = {
  title: "High cryptic diversity of endemic Indirana frogs in the Western Ghats biodiversity hotspot",
  abstract: "Amphibians are rapidly declining worldwide, with a significant portion of threatened species found in biodiversity hotspots. The Western Ghats of India is one such hotspot, harboring numerous endemic species. The genus Indirana is endemic to this region and includes several species with restricted distributions. Using an integrative taxonomic approach combining morphological, molecular, and bioacoustic data, we investigated the diversity within the Indirana beddomii complex. Our analyses revealed the presence of at least five distinct evolutionary lineages, including two described species (Indirana beddomii and Indirana diplosticta) and three candidate species. These findings highlight the high cryptic diversity within this group and emphasize the need for comprehensive taxonomic revisions and conservation assessments in the Western Ghats."
};

async function testTaxonomicExtraction() {
  console.log('Testing enhanced taxonomic extraction...\n');
  console.log('Paper Title:', testPaper.title);
  console.log('\nExpected Taxonomic Extraction:');
  console.log('- Amphibians: Indirana frogs (Indirana sp.)');
  console.log('- Amphibians: Indirana beddomii');
  console.log('- Amphibians: Indirana diplosticta');
  console.log('- Or at minimum: Amphibians\n');

  try {
    const result = await extractComprehensiveMetadata({
      title: testPaper.title,
      abstract: testPaper.abstract
    });

    if (result.success) {
      console.log('✓ Metadata extraction successful!\n');
      console.log('Extracted Taxonomic Coverage:');
      if (result.data.taxonomic_coverage && result.data.taxonomic_coverage.length > 0) {
        result.data.taxonomic_coverage.forEach((taxa, idx) => {
          console.log(`  ${idx + 1}. ${taxa}`);
        });
        console.log('\n✓ SUCCESS: Taxonomic information was extracted!');
      } else {
        console.log('  (empty)');
        console.log('\n✗ FAILURE: No taxonomic information extracted');
      }

      console.log('\nOther Extracted Metadata:');
      console.log('- Ecosystem:', result.data.ecosystem_types);
      console.log('- Methods:', result.data.research_methods);
      console.log('- Frameworks:', result.data.frameworks);
      console.log('- Location:', result.data.location?.name);
      console.log('\nAI Rationale:', result.data.rationale);
      console.log('\nTokens used:', result.metadata.tokensUsed);
    } else {
      console.error('✗ Metadata extraction failed:', result.error);
    }
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

testTaxonomicExtraction();
