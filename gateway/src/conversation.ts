/**
 * Conversation Store
 * 
 * Manages rolling conversation history for stateful exchanges.
 * History is stored per-channel and pruned after 24 hours.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO format
}

export interface ConversationHistory {
  channel: string;
  messages: Message[];
  lastActivity: string; // ISO format
}

const HISTORY_TTL_HOURS = 24;
const MAX_MESSAGES = 20; // Limit to control context size and cost

/**
 * Get the path to a channel's conversation file
 */
function getConversationPath(workspacePath: string, channel: string): string {
  return join(workspacePath, 'conversations', `${channel}.json`);
}

/**
 * Load conversation history for a channel
 */
export async function loadConversation(
  workspacePath: string,
  channel: string
): Promise<ConversationHistory> {
  const path = getConversationPath(workspacePath, channel);
  
  try {
    const content = await readFile(path, 'utf-8');
    const history: ConversationHistory = JSON.parse(content);
    
    // Prune old messages
    const pruned = pruneOldMessages(history);
    
    // Save if we pruned anything
    if (pruned.messages.length !== history.messages.length) {
      await saveConversation(workspacePath, pruned);
    }
    
    return pruned;
  } catch {
    // No history exists yet
    return {
      channel,
      messages: [],
      lastActivity: new Date().toISOString(),
    };
  }
}

/**
 * Save conversation history
 */
export async function saveConversation(
  workspacePath: string,
  history: ConversationHistory
): Promise<void> {
  const path = getConversationPath(workspacePath, history.channel);
  
  // Ensure directory exists
  await mkdir(dirname(path), { recursive: true });
  
  await writeFile(path, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Add a message to conversation history
 */
export async function addMessage(
  workspacePath: string,
  channel: string,
  role: 'user' | 'assistant',
  content: string
): Promise<ConversationHistory> {
  const history = await loadConversation(workspacePath, channel);
  
  const message: Message = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  
  history.messages.push(message);
  history.lastActivity = message.timestamp;
  
  await saveConversation(workspacePath, history);
  
  return history;
}

/**
 * Remove messages older than TTL and limit to max count
 */
function pruneOldMessages(history: ConversationHistory): ConversationHistory {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - HISTORY_TTL_HOURS);
  const cutoffISO = cutoff.toISOString();
  
  // First filter by time
  let filtered = history.messages.filter(msg => msg.timestamp > cutoffISO);
  
  // Then limit by count (keep most recent)
  if (filtered.length > MAX_MESSAGES) {
    filtered = filtered.slice(-MAX_MESSAGES);
  }
  
  return {
    ...history,
    messages: filtered,
  };
}

/**
 * Get time since last activity (in minutes)
 */
export function getMinutesSinceLastActivity(history: ConversationHistory): number {
  const last = new Date(history.lastActivity);
  const now = new Date();
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60));
}

/**
 * Check if there was recent conversation (within N minutes)
 */
export function hasRecentActivity(history: ConversationHistory, withinMinutes: number): boolean {
  return getMinutesSinceLastActivity(history) < withinMinutes;
}

/**
 * Format conversation history for inclusion in system prompt
 */
export function formatHistoryForPrompt(history: ConversationHistory): string {
  if (history.messages.length === 0) {
    return '';
  }
  
  const lines: string[] = ['## Recent Conversation\n'];
  
  for (const msg of history.messages) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const role = msg.role === 'user' ? 'Sergio' : 'You';
    lines.push(`**${role}** (${time}): ${msg.content}\n`);
  }
  
  return lines.join('\n');
}
