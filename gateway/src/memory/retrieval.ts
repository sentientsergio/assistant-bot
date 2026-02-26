/**
 * Retrieval Module
 * 
 * Handles memory retrieval with time-weighted scoring.
 * Combines semantic similarity with recency.
 * 
 * CALIBRATION NOTES (2026-02-03):
 * We now use actual cosine similarity (0-1 scale) from embeddings.
 * Tested values:
 *   - Near-exact text match: ~80%
 *   - Good semantic match: ~50%
 *   - Weak/irrelevant: ~15%
 * 
 * Threshold of 0.35 filters out irrelevant content while keeping
 * chunks with meaningful semantic overlap.
 */

import { searchChunks, touchChunks, ScoredChunk } from './store.js';

// Retrieval parameters - calibrated for cosine similarity (0-1 scale)
const DEFAULT_TOP_K = 5;
const MIN_TOP_K = 2;              // Always return at least this many if available
const MAX_TOP_K = 10;             // Never return more than this
const SIMILARITY_THRESHOLD = 0.35; // Minimum cosine similarity to include (35%)
const SCORE_GAP_THRESHOLD = 0.10; // If score drops by this much, consider cutting off
const RECENCY_WEIGHT = 0.2;       // 20% recency, 80% semantic (prioritize relevance over freshness)
const DECAY_RATE = 0.005;         // Slower decay (~6 days half-life)

export interface RetrievedMemory {
  content: string;
  channel: string;
  age: string;        // Human-readable age
  score: number;      // Combined score
  tier: 'warm' | 'cold';
}

/**
 * Compute time decay based on hours since last access
 */
function computeRecency(lastAccessedAt: string): number {
  const now = Date.now();
  const accessed = new Date(lastAccessedAt).getTime();
  const hoursSince = (now - accessed) / (1000 * 60 * 60);
  
  // Exponential decay: score = (1 - decay_rate) ^ hours
  return Math.pow(1 - DECAY_RATE, hoursSince);
}

/**
 * Compute adaptive top-K based on score distribution
 * Returns results up to a natural gap in scores, or the requested topK
 */
function adaptiveTopK<T extends { combinedScore: number }>(
  results: T[],
  requestedK: number
): T[] {
  if (results.length <= MIN_TOP_K) return results;
  
  // Always include at least MIN_TOP_K
  const output: T[] = results.slice(0, MIN_TOP_K);
  
  // Check remaining results for score gaps
  for (let i = MIN_TOP_K; i < Math.min(results.length, MAX_TOP_K); i++) {
    const current = results[i];
    const previous = results[i - 1];
    
    // If there's a big gap in scores, stop here
    const gap = previous.combinedScore - current.combinedScore;
    if (gap > SCORE_GAP_THRESHOLD) {
      console.log(`[memory] Adaptive cutoff at ${i} results (gap: ${gap.toFixed(3)})`);
      break;
    }
    
    // If we've hit the requested K, check if next item is similar enough to include
    if (output.length >= requestedK) {
      // Only continue if score is very close to previous
      if (gap > SCORE_GAP_THRESHOLD / 2) {
        break;
      }
    }
    
    output.push(current);
  }
  
  return output;
}

/**
 * Format age as human-readable string
 */
function formatAge(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const minutes = Math.floor((now - then) / (1000 * 60));
  
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * Retrieve relevant memories for a query
 */
export async function retrieveMemories(
  query: string,
  options: {
    topK?: number;
    excludeContent?: string[]; // Content strings already in HOT context
  } = {}
): Promise<RetrievedMemory[]> {
  const { topK = DEFAULT_TOP_K, excludeContent = [] } = options;
  
  // Search both WARM and COLD tiers
  const results = await searchChunks(query, topK * 2); // Get extra for filtering
  
  // Compute combined scores and filter
  const scoredAndFiltered = results
    .map(chunk => {
      const recency = computeRecency(chunk.lastAccessedAt);
      const combinedScore = (chunk.score * (1 - RECENCY_WEIGHT)) + (recency * RECENCY_WEIGHT);
      
      return {
        ...chunk,
        combinedScore,
        recency,
      };
    })
    .filter(chunk => {
      // Filter by threshold
      if (chunk.combinedScore < SIMILARITY_THRESHOLD) return false;
      
      // Filter out content already in context (approximate match)
      const contentLower = chunk.content.toLowerCase();
      for (const exclude of excludeContent) {
        if (contentLower.includes(exclude.toLowerCase().slice(0, 50))) {
          return false;
        }
      }
      
      return true;
    })
    .sort((a, b) => b.combinedScore - a.combinedScore);
  
  // Apply adaptive top-K based on score distribution
  const scored = adaptiveTopK(scoredAndFiltered, topK);
  
  // Touch retrieved chunks to reinforce them
  const ids = scored.map(c => c.id);
  await touchChunks(ids);
  
  // Log what was retrieved for debugging
  for (const chunk of scored) {
    console.log(`[memory] Retrieved (score: ${chunk.combinedScore.toFixed(3)}): ${chunk.content.slice(0, 60)}...`);
  }
  
  // Format for return
  return scored.map(chunk => ({
    content: chunk.content,
    channel: chunk.channel,
    age: formatAge(chunk.createdAt),
    score: chunk.combinedScore,
    tier: chunk.tier,
  }));
}

/**
 * Format retrieved memories for inclusion in prompt
 */
export function formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return '';
  
  const lines = ['## Earlier Context (from memory)\n'];
  
  for (const memory of memories) {
    const channelNote = memory.channel ? ` [${memory.channel}]` : '';
    lines.push(`**${memory.age}${channelNote}:**`);
    lines.push(memory.content);
    lines.push('');
  }
  
  return lines.join('\n');
}
