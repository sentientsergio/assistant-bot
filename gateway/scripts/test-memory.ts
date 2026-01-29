/**
 * Memory System Smoke Test
 * 
 * Tests touchChunks and adaptiveTopK functionality
 * Run with: npx tsx scripts/test-memory.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

import { initMemoryStore, addChunk, searchChunks, isInitialized } from '../src/memory/store.js';
import { retrieveMemories } from '../src/memory/retrieval.js';
import * as lancedb from '@lancedb/lancedb';
import { join } from 'path';

const TEST_WORKSPACE = '../workspace-dev';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Memory System Smoke Test ===\n');
  
  // Initialize
  console.log('1. Initializing memory store...');
  await initMemoryStore(TEST_WORKSPACE);
  console.log('   ✓ Initialized\n');
  
  // Add test chunks with varying relevance
  console.log('2. Adding test chunks...');
  const testChunks = [
    { content: 'User asked about the weather in New York. Assistant said it was sunny and 72°F.', relevance: 'high' },
    { content: 'User discussed their favorite coffee shops. Assistant recommended Blue Bottle.', relevance: 'medium' },
    { content: 'User mentioned they have a meeting with John at 3pm tomorrow.', relevance: 'low for weather' },
  ];
  
  const addedIds: string[] = [];
  for (const chunk of testChunks) {
    const id = await addChunk(chunk.content, 'test', 2, 'warm');
    addedIds.push(id);
    console.log(`   Added: ${id} (${chunk.relevance})`);
  }
  console.log('   ✓ Test chunks added\n');
  
  // Wait a moment then retrieve
  console.log('3. Testing retrieval (weather query)...');
  await sleep(500);
  
  const results = await retrieveMemories('What was the weather like?', {
    topK: 5,
    excludeContent: [],
  });
  
  console.log(`   Found ${results.length} memories:`);
  for (const mem of results) {
    console.log(`   - Score ${mem.score.toFixed(3)}: ${mem.content.slice(0, 50)}...`);
  }
  console.log('');
  
  // Verify touchChunks by checking timestamps
  console.log('4. Verifying touchChunks (lastAccessedAt update)...');
  const db = await lancedb.connect(join(TEST_WORKSPACE, 'memory.lance'));
  const table = await db.openTable('chunks');
  
  // Get one of our test chunks - use query() for non-vector search
  const checkId = addedIds[0];
  const rows = await table.query().where(`id = '${checkId}'`).limit(1).toArray();
  
  if (rows.length > 0) {
    const row = rows[0];
    const created = new Date(row.createdAt as string);
    const accessed = new Date(row.lastAccessedAt as string);
    
    console.log(`   Chunk ${checkId}:`);
    console.log(`   - createdAt: ${created.toISOString()}`);
    console.log(`   - lastAccessedAt: ${accessed.toISOString()}`);
    
    if (accessed > created) {
      console.log('   ✓ touchChunks working (lastAccessedAt > createdAt)\n');
    } else {
      console.log('   ? touchChunks may not have run (timestamps equal)\n');
    }
  }
  
  // Test adaptiveTopK with a query that should have score gaps
  console.log('5. Testing adaptiveTopK (score distribution)...');
  const coffeeResults = await retrieveMemories('coffee shops recommendations', {
    topK: 10,
    excludeContent: [],
  });
  
  console.log(`   Query "coffee shops" returned ${coffeeResults.length} results`);
  console.log('   (Check logs above for "Adaptive cutoff" message if gap was detected)\n');
  
  // Cleanup - remove test chunks
  console.log('6. Cleaning up test chunks...');
  for (const id of addedIds) {
    await table.delete(`id = '${id}'`);
  }
  console.log('   ✓ Test chunks removed\n');
  
  console.log('=== Smoke Test Complete ===');
}

main().catch(console.error);
