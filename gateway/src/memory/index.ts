/**
 * Memory System — v2
 *
 * Write pipeline: chunks and facts are stored after each exchange (unchanged).
 * Read pipeline: Claire uses the search_memory tool when she needs deep recall.
 *
 * The system no longer auto-fetches memories or dumps all facts into the prompt.
 */

export { initMemoryStore, addChunk, getChunkCounts, isInitialized } from './store.js';
export { createChunks, createRecentChunk, type Message, type Chunk } from './chunking.js';
export { retrieveMemories, formatMemoriesForPrompt, type RetrievedMemory } from './retrieval.js';
export { embedText, embedTexts } from './embeddings.js';
export {
  initFactsStore,
  getAllFacts,
  findSimilarFacts,
  formatFactsForPrompt,
  isFactsInitialized,
  type Fact,
  type FactCategory,
} from './facts.js';

import { addChunk, isInitialized } from './store.js';
import { createRecentChunk, type Message } from './chunking.js';
import {
  initFactsStore,
  processExchangeForFacts,
  isFactsInitialized,
} from './facts.js';

/**
 * Store a conversation exchange in the vector store.
 * Also triggers async fact extraction.
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

    if (isFactsInitialized() && chunkId) {
      processExchangeForFacts(userMessage, assistantMessage, chunkId).catch(err => {
        console.error('[memory] Fact extraction failed:', err);
      });
    }
  }

  return chunkId;
}
