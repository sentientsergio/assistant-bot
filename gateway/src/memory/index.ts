/**
 * Memory System
 * 
 * Tiered conversational memory with vector search.
 * 
 * HOT: In-context messages (handled by existing conversation.ts)
 * WARM: Recent chunks in LanceDB (this module)
 * COLD: Compressed summaries (future)
 * FACTS: Extracted stable facts (preferences, info, etc.)
 */

export { initMemoryStore, addChunk, getChunkCounts, isInitialized } from './store.js';
export { createChunks, createRecentChunk, type Message, type Chunk } from './chunking.js';
export { retrieveMemories, formatMemoriesForPrompt, type RetrievedMemory } from './retrieval.js';
export { embedText, embedTexts } from './embeddings.js';
export { 
  initFactsStore, 
  getAllFacts, 
  formatFactsForPrompt,
  isFactsInitialized,
  type Fact,
  type FactCategory,
} from './facts.js';

import { initMemoryStore, addChunk, isInitialized } from './store.js';
import { createRecentChunk, type Message } from './chunking.js';
import { retrieveMemories, formatMemoriesForPrompt } from './retrieval.js';
import { 
  initFactsStore, 
  processExchangeForFacts, 
  getAllFacts, 
  formatFactsForPrompt,
  isFactsInitialized,
} from './facts.js';

/**
 * High-level interface: Store a conversation exchange
 * Also triggers fact extraction (async, non-blocking)
 */
export async function storeExchange(
  userMessage: string,
  assistantMessage: string,
  channel: string,
  timestamp?: string
): Promise<string | null> {
  if (!isInitialized()) {
    console.log('[memory] Store not initialized, skipping');
    return null;
  }
  
  const ts = timestamp || new Date().toISOString();
  
  const messages: Message[] = [
    { role: 'user', content: userMessage, timestamp: ts, channel },
    { role: 'assistant', content: assistantMessage, timestamp: ts, channel },
  ];
  
  const chunk = createRecentChunk(messages);
  let chunkId: string | null = null;
  
  if (chunk) {
    chunkId = await addChunk(chunk.content, chunk.channel, chunk.turnCount);
    
    // Trigger fact extraction (async, don't wait)
    if (isFactsInitialized() && chunkId) {
      processExchangeForFacts(userMessage, assistantMessage, chunkId).catch(err => {
        console.error('[memory] Fact extraction failed:', err);
      });
    }
  }
  
  return chunkId;
}

/**
 * High-level interface: Get relevant memories for context
 */
export async function getRelevantMemories(
  query: string,
  hotContext: string[] = []
): Promise<string> {
  if (!isInitialized()) {
    return '';
  }
  
  try {
    const memories = await retrieveMemories(query, {
      topK: 5,
      excludeContent: hotContext,
    });
    
    return formatMemoriesForPrompt(memories);
  } catch (err) {
    console.error('[memory] Retrieval error:', err);
    return '';
  }
}
