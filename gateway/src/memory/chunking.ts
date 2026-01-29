/**
 * Chunking Module
 * 
 * Converts conversations into embeddable chunks.
 * Uses 3-5 turn segments with speaker labels and timestamps.
 */

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  channel: string;
}

export interface Chunk {
  content: string;
  channel: string;
  turnCount: number;
  startTime: string;
  endTime: string;
}

// Chunking parameters
const MIN_TURNS = 3;
const MAX_TURNS = 5;
const MIN_CONTENT_LENGTH = 20; // Skip very short chunks

// Messages to skip (not worth embedding)
const TRIVIAL_PATTERNS = [
  /^(ok|okay|k|yes|no|yeah|yep|nope|sure|thanks|thank you|ty|thx|cool|nice|great|good|fine|alright|lol|haha|heh|hmm|ah|oh|uh)\.?$/i,
];

/**
 * Check if a message is trivial (not worth embedding on its own)
 */
function isTrivial(content: string): boolean {
  const trimmed = content.trim();
  return TRIVIAL_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Format a message for inclusion in a chunk
 */
function formatMessage(msg: Message): string {
  const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const role = msg.role === 'user' ? 'User' : 'Assistant';
  return `[${time}] ${role}: ${msg.content}`;
}

/**
 * Convert a list of messages into embeddable chunks
 * Uses sliding window with overlap
 */
export function createChunks(messages: Message[]): Chunk[] {
  if (messages.length < MIN_TURNS) {
    // Not enough messages for a proper chunk
    // Could still create one if content is substantial
    if (messages.length > 0) {
      const content = messages.map(formatMessage).join('\n');
      if (content.length >= MIN_CONTENT_LENGTH) {
        return [{
          content,
          channel: messages[0].channel,
          turnCount: messages.length,
          startTime: messages[0].timestamp,
          endTime: messages[messages.length - 1].timestamp,
        }];
      }
    }
    return [];
  }

  const chunks: Chunk[] = [];
  let i = 0;

  while (i < messages.length) {
    // Determine chunk size (prefer MAX_TURNS, but at least MIN_TURNS)
    const remaining = messages.length - i;
    const chunkSize = Math.min(MAX_TURNS, Math.max(MIN_TURNS, remaining));
    
    if (remaining < MIN_TURNS && chunks.length > 0) {
      // Not enough messages left for a full chunk, and we already have chunks
      // These messages were likely included in the previous chunk's overlap
      break;
    }

    const chunkMessages = messages.slice(i, i + chunkSize);
    const content = chunkMessages.map(formatMessage).join('\n');

    // Skip if content is too short or all messages are trivial
    const nonTrivialCount = chunkMessages.filter(m => !isTrivial(m.content)).length;
    
    if (content.length >= MIN_CONTENT_LENGTH && nonTrivialCount > 0) {
      chunks.push({
        content,
        channel: chunkMessages[0].channel,
        turnCount: chunkMessages.length,
        startTime: chunkMessages[0].timestamp,
        endTime: chunkMessages[chunkMessages.length - 1].timestamp,
      });
    }

    // Move forward with overlap (1 message overlap for continuity)
    i += Math.max(1, chunkSize - 1);
  }

  return chunks;
}

/**
 * Create a single chunk from recent messages (for immediate storage)
 * Used when new messages come in
 */
export function createRecentChunk(messages: Message[]): Chunk | null {
  if (messages.length === 0) return null;
  
  // Filter out purely trivial messages
  const meaningful = messages.filter(m => !isTrivial(m.content));
  if (meaningful.length === 0) return null;
  
  // Use all messages for context, even trivial ones
  const content = messages.map(formatMessage).join('\n');
  
  if (content.length < MIN_CONTENT_LENGTH) return null;
  
  return {
    content,
    channel: messages[0].channel,
    turnCount: messages.length,
    startTime: messages[0].timestamp,
    endTime: messages[messages.length - 1].timestamp,
  };
}
