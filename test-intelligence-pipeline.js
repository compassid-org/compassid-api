/**
 * Test script for Research Intelligence Pipeline
 *
 * This script runs the weekly intelligence pipeline to:
 * 1. Fetch conservation papers from CrossRef
 * 2. Filter by conservation keywords
 * 3. Analyze with AI (Claude 3.5 Haiku)
 * 4. Save to database
 * 5. Generate weekly trends
 */

import dotenv from 'dotenv';
dotenv.config();

import { runWeeklyPipeline } from './src/services/researchIntelligence.js';

async function main() {
  try {
    console.log('Starting Research Intelligence Pipeline Test...\n');

    // Run pipeline for last 7 days with conservative limits for testing
    const result = await runWeeklyPipeline({
      fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      toDate: new Date(),
      limit: 50,  // Fetch max 50 papers from CrossRef (reduced for testing)
      minKeywords: 2,  // Require at least 2 conservation keywords
      batchSize: 5,  // Process 5 papers per AI call
    });

    if (result.success) {
      console.log('\n✅ Pipeline test successful!');
      console.log(`   Papers analyzed: ${result.papers}`);
      console.log(`   Trends generated: ${result.trends}`);
      console.log(`   Duration: ${result.duration}s`);
    } else {
      console.log('\n❌ Pipeline test failed');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Pipeline error:', error);
    process.exit(1);
  }
}

main();
