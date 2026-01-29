/**
 * Embeddings Module
 * 
 * Handles text embedding using OpenAI's text-embedding-3-small model.
 * Can be swapped for local Ollama/nomic later if needed.
 */

import OpenAI from 'openai';

// Lazy initialization - client created on first use (after dotenv loads)
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

// Using text-embedding-3-small: 1536 dimensions, cheap, good quality
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export { EMBEDDING_DIMENSIONS };

/**
 * Embed a single text string
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  
  return response.data[0].embedding;
}

/**
 * Embed multiple texts in a batch (more efficient)
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  
  // Sort by index to maintain order
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
