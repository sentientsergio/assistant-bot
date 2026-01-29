/**
 * Retrieval Module
 * 
 * Handles memory retrieval with time-weighted scoring.
 * Combines semantic similarity with recency.
 */

import { searchChunks, touchChunks, ScoredChunk } from './store.js';

// Retrieval parameters
const DEFAULT_TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.3; // Minimum similarity to include
const RECENCY_WEIGHT = 0.3;       // 30% recency, 70% semantic
const DECAY_RATE = 0.01;          // ~1 week half-life

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
  const scored = results
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
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);
  
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
