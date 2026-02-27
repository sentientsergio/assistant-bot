/**
 * Conversation State Manager
 *
 * Maintains a single MessageParam[] array in process memory across all channels.
 * One Claire, one Sergio, one conversation.
 *
 * - Persists to disk after each turn for crash recovery
 * - Strips thinking blocks before persistence
 * - Serializes concurrent turns via a promise queue
 * - Concatenates rapid-fire messages into a single user turn
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

const PERSISTENCE_FILE = 'conversation-state.json';
const RAPID_FIRE_WINDOW_MS = 3000;

let messages: MessageParam[] = [];
let workspacePath: string = '';
let turnQueue: Promise<void> = Promise.resolve();
let pendingUserMessages: Array<{ content: string; timestamp: number }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the conversation state, reloading from disk if available.
 */
export async function initConversationState(wsPath: string): Promise<void> {
  workspacePath = wsPath;

  const filePath = getStatePath();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.messages)) {
      messages = parsed.messages;
      console.log(`[conversation-state] Restored ${messages.length} messages from disk`);
    }
  } catch {
    console.log('[conversation-state] No prior state on disk, starting fresh');
    messages = [];
  }
}

function getStatePath(): string {
  return join(workspacePath, 'conversations', PERSISTENCE_FILE);
}

/**
 * Get the current messages array (read-only reference).
 */
export function getMessages(): MessageParam[] {
  return messages;
}

/**
 * Get the count of messages.
 */
export function getMessageCount(): number {
  return messages.length;
}

/**
 * Append a user message to the conversation.
 */
export function appendUserMessage(content: string): void {
  messages.push({ role: 'user', content });
}

/**
 * Append an assistant response (full content blocks) to the conversation.
 * Strips thinking blocks before storing.
 */
export function appendAssistantResponse(contentBlocks: ContentBlockParam[]): void {
  const stripped = stripThinkingBlocks(contentBlocks);
  messages.push({ role: 'assistant', content: stripped });
}

/**
 * Append a raw MessageParam (used for tool_result turns).
 */
export function appendRawMessage(msg: MessageParam): void {
  messages.push(msg);
}

/**
 * Roll back the last user message. Called when a turn fails mid-flight
 * to prevent stale messages from corrupting the conversation state.
 */
export function rollbackLastUserMessage(): void {
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    messages.pop();
    console.log('[conversation-state] Rolled back last user message after failed turn');
  }
}

/**
 * Persist the current messages array to disk.
 * Called after each complete turn.
 */
export async function persistState(): Promise<void> {
  const filePath = getStatePath();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const data = JSON.stringify({ messages, lastPersisted: new Date().toISOString() }, null, 2);
    await writeFile(filePath, data, 'utf-8');
    console.log(`[conversation-state] Persisted ${messages.length} messages to disk`);
  } catch (err) {
    console.error('[conversation-state] Failed to persist:', err);
  }
}

/**
 * Strip thinking blocks from content. They're ephemeral reasoning
 * and don't survive to the next turn.
 */
function stripThinkingBlocks(blocks: ContentBlockParam[]): ContentBlockParam[] {
  return blocks.filter(block => {
    if (typeof block === 'string') return true;
    if (typeof block === 'object' && block !== null && 'type' in block) {
      return (block as { type: string }).type !== 'thinking';
    }
    return true;
  });
}

/**
 * Enqueue a turn. All incoming messages — regardless of channel — are serialized
 * through this queue. If an API call is in-flight, new messages wait.
 *
 * @param fn - The async function representing this turn's work
 * @returns The result of the turn function
 */
export function enqueueTurn<T>(fn: () => Promise<T>): Promise<T> {
  const result = turnQueue.then(fn, fn);
  turnQueue = result.then(() => {}, () => {});
  return result;
}

/**
 * Queue a rapid-fire user message. If multiple messages arrive within the
 * rapid-fire window, they're concatenated into a single user turn.
 *
 * @returns A promise that resolves when the message (or batch) is ready to process
 */
export function queueRapidFireMessage(
  content: string,
  onBatch: (combined: string) => Promise<void>
): void {
  pendingUserMessages.push({ content, timestamp: Date.now() });

  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(async () => {
    const batch = pendingUserMessages.splice(0);
    flushTimer = null;

    if (batch.length === 0) return;

    const combined = batch.length === 1
      ? batch[0].content
      : batch.map(m => m.content).join('\n\n');

    await onBatch(combined);
  }, RAPID_FIRE_WINDOW_MS);
}

/**
 * Get the last N messages from the conversation (for heartbeat context).
 */
export function getRecentMessagesFromState(limit: number = 10): MessageParam[] {
  return messages.slice(-limit);
}

/**
 * Get the text content of the last assistant message (for logging).
 */
export function getLastAssistantText(): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null && 'type' in block) {
            const typed = block as { type: string; text?: string };
            if (typed.type === 'text' && typed.text) return typed.text;
          }
        }
      }
      return null;
    }
  }
  return null;
}
