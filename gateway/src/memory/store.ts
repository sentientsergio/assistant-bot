/**
 * Memory Store
 * 
 * LanceDB-backed vector storage for conversation chunks.
 * Handles both WARM (recent chunks) and COLD (compressed summaries) tiers.
 */

import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import { embedText, cosineSimilarity, EMBEDDING_DIMENSIONS } from './embeddings.js';
import { join } from 'path';

// Database and table references
let db: lancedb.Connection | null = null;
let chunksTable: lancedb.Table | null = null;

// Schema for conversation chunks
export interface MemoryChunk {
  id: string;
  content: string;
  channel: string;
  tier: 'warm' | 'cold';
  createdAt: string;      // ISO timestamp
  lastAccessedAt: string; // ISO timestamp (for time decay)
  turnCount: number;
  vector: number[];
  [key: string]: unknown; // Index signature for LanceDB compatibility
}

// Query result with score
export interface ScoredChunk extends MemoryChunk {
  score: number;
}

/**
 * Initialize the LanceDB connection and tables
 */
export async function initMemoryStore(workspacePath: string): Promise<void> {
  const dbPath = join(workspacePath, 'memory.lance');
  
  console.log(`[memory] Initializing LanceDB at ${dbPath}`);
  
  db = await lancedb.connect(dbPath);
  
  // Check if chunks table exists, create if not
  const tables = await db.tableNames();
  
  if (tables.includes('chunks')) {
    chunksTable = await db.openTable('chunks');
    const count = await chunksTable.countRows();
    console.log(`[memory] Opened existing chunks table (${count} rows)`);
  } else {
    // Create with initial empty row to establish schema, then delete it
    // LanceDB requires at least one row to create a table
    const initialRow: MemoryChunk = {
      id: '__init__',
      content: '',
      channel: '',
      tier: 'warm',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      turnCount: 0,
      vector: new Array(EMBEDDING_DIMENSIONS).fill(0),
    };
    
    chunksTable = await db.createTable('chunks', [initialRow]);
    await chunksTable.delete('id = "__init__"');
    console.log('[memory] Created new chunks table');
  }
  
  // Ensure FTS index exists on content column for hybrid search
  try {
    await chunksTable.createIndex('content', { config: Index.fts() });
    console.log('[memory] FTS index ready on content column');
  } catch (err) {
    // Index might already exist, that's fine
    console.log('[memory] FTS index already exists or skipped');
  }
}

/**
 * Add a chunk to memory
 */
export async function addChunk(
  content: string,
  channel: string,
  turnCount: number,
  tier: 'warm' | 'cold' = 'warm'
): Promise<string> {
  if (!chunksTable) {
    throw new Error('Memory store not initialized');
  }
  
  const id = `${tier}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  
  console.log(`[memory] Embedding chunk (${content.length} chars)...`);
  const vector = await embedText(content);
  
  const chunk: MemoryChunk = {
    id,
    content,
    channel,
    tier,
    createdAt: now,
    lastAccessedAt: now,
    turnCount,
    vector,
  };
  
  await chunksTable.add([chunk]);
  console.log(`[memory] Added chunk ${id} to ${tier} tier`);
  
  return id;
}

/**
 * Search for similar chunks using pure vector search with cosine similarity
 * 
 * Returns actual cosine similarity scores (0-1 scale) for proper threshold calibration.
 * We removed hybrid search because its scoring was on a different scale that we
 * miscalibrated, causing relevant chunks to be filtered out.
 */
export async function searchChunks(
  query: string,
  limit: number = 5,
  tier?: 'warm' | 'cold'
): Promise<ScoredChunk[]> {
  if (!chunksTable) {
    throw new Error('Memory store not initialized');
  }
  
  console.log(`[memory] Searching for: "${query.slice(0, 50)}..."`);
  const queryVector = await embedText(query);
  
  // Use pure vector search - LanceDB returns results by L2 distance
  let search = chunksTable.vectorSearch(queryVector).limit(limit * 2);
  
  if (tier) {
    search = search.where(`tier = '${tier}'`);
  }
  
  const results = await search.toArray();
  
  // Compute actual cosine similarity for each result
  // This gives us interpretable 0-1 scores we can threshold properly
  const scored: ScoredChunk[] = results.slice(0, limit).map((row: Record<string, unknown>) => {
    // LanceDB returns vectors as Vector objects - convert to plain array
    const rawVector = row.vector;
    const resultVector: number[] = Array.isArray(rawVector) 
      ? rawVector 
      : Array.from(rawVector as Iterable<number>);
    
    const similarity = cosineSimilarity(queryVector, resultVector);
    
    return {
      id: row.id as string,
      content: row.content as string,
      channel: row.channel as string,
      tier: row.tier as 'warm' | 'cold',
      createdAt: row.createdAt as string,
      lastAccessedAt: row.lastAccessedAt as string,
      turnCount: row.turnCount as number,
      vector: resultVector,
      score: similarity,
    };
  });
  
  // Sort by cosine similarity (highest first)
  scored.sort((a, b) => b.score - a.score);
  
  console.log(`[memory] Found ${scored.length} chunks (vector search, cosine similarity)`);
  return scored;
}

/**
 * Update lastAccessedAt for retrieved chunks (reinforcement)
 * This helps with time-decay scoring - frequently accessed chunks stay fresh
 */
export async function touchChunks(ids: string[]): Promise<void> {
  if (!chunksTable || ids.length === 0) return;
  
  const now = new Date().toISOString();
  
  try {
    // Update each chunk's lastAccessedAt
    // LanceDB update: read matching rows, modify, merge back
    for (const id of ids) {
      await chunksTable.update({
        where: `id = '${id}'`,
        values: { lastAccessedAt: now },
      });
    }
    console.log(`[memory] Touched ${ids.length} chunks`);
  } catch (err) {
    // Non-fatal - just log and continue
    console.log(`[memory] Touch failed (non-fatal): ${err}`);
  }
}

/**
 * Get count of chunks by tier
 */
export async function getChunkCounts(): Promise<{ warm: number; cold: number }> {
  if (!chunksTable) {
    return { warm: 0, cold: 0 };
  }
  
  const all = await chunksTable.countRows();
  // LanceDB doesn't have easy count with filter, so approximate
  return { warm: all, cold: 0 }; // TODO: implement proper counting
}

/**
 * Delete old chunks (for maintenance)
 */
export async function deleteChunksOlderThan(date: Date, tier: 'warm' | 'cold'): Promise<number> {
  if (!chunksTable) return 0;
  
  const isoDate = date.toISOString();
  await chunksTable.delete(`tier = '${tier}' AND createdAt < '${isoDate}'`);
  
  // Can't easily get count of deleted rows
  return 0;
}

/**
 * Check if store is initialized
 */
export function isInitialized(): boolean {
  return chunksTable !== null;
}
