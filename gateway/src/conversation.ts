/**
 * Conversation Store
 * 
 * Manages unified conversation history across all messaging channels.
 * Single messages.json file with channel tags per message.
 * 
 * Note: This is for the MESSAGING PLANE (Telegram, web, SMS).
 * Cursor is the DEVELOPMENT PLANE and does not participate in this log.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export interface Message {
  channel: string;        // Which messaging channel (telegram, web, sms)
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;      // ISO format
}

export interface ConversationLog {
  messages: Message[];
  lastActivity: string;   // ISO format
}

const HISTORY_TTL_HOURS = 24;
const MAX_MESSAGES_HOT = 5;     // Messages loaded into HOT context
const MAX_MESSAGES_STORE = 100; // Messages kept in log before pruning to WARM-only

/**
 * Get the path to the unified conversation log
 */
function getConversationPath(workspacePath: string): string {
  return join(workspacePath, 'conversations', 'messages.json');
}

/**
 * Load the full conversation log
 */
export async function loadConversationLog(
  workspacePath: string
): Promise<ConversationLog> {
  const path = getConversationPath(workspacePath);
  
  try {
    const content = await readFile(path, 'utf-8');
    const log: ConversationLog = JSON.parse(content);
    return log;
  } catch {
    // No log exists yet
    return {
      messages: [],
      lastActivity: new Date().toISOString(),
    };
  }
}

/**
 * Save the conversation log
 */
async function saveConversationLog(
  workspacePath: string,
  log: ConversationLog
): Promise<void> {
  const path = getConversationPath(workspacePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(log, null, 2), 'utf-8');
}

/**
 * Add a message to the conversation log
 */
export async function addMessage(
  workspacePath: string,
  channel: string,
  role: 'user' | 'assistant',
  content: string
): Promise<ConversationLog> {
  const log = await loadConversationLog(workspacePath);
  
  const message: Message = {
    channel,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  
  log.messages.push(message);
  log.lastActivity = message.timestamp;
  
  // Prune if over storage limit (keeps recent messages)
  if (log.messages.length > MAX_MESSAGES_STORE) {
    log.messages = log.messages.slice(-MAX_MESSAGES_STORE);
  }
  
  await saveConversationLog(workspacePath, log);
  return log;
}

/**
 * Get recent messages for HOT context
 * Can filter by channel or get all channels mixed
 */
export function getRecentMessages(
  log: ConversationLog,
  options: {
    channel?: string;     // Filter to specific channel, or all if undefined
    limit?: number;       // Max messages to return
    withinHours?: number; // Only messages within N hours
  } = {}
): Message[] {
  const { channel, limit = MAX_MESSAGES_HOT, withinHours = HISTORY_TTL_HOURS } = options;
  
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - withinHours);
  const cutoffISO = cutoff.toISOString();
  
  let filtered = log.messages.filter(msg => msg.timestamp > cutoffISO);
  
  if (channel) {
    filtered = filtered.filter(msg => msg.channel === channel);
  }
  
  // Return most recent N
  return filtered.slice(-limit);
}

/**
 * Legacy compatibility: Load conversation for a specific channel
 * Returns a ConversationHistory-like object for backwards compatibility
 */
export interface ConversationHistory {
  channel: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  lastActivity: string;
}

export async function loadConversation(
  workspacePath: string,
  channel: string
): Promise<ConversationHistory> {
  const log = await loadConversationLog(workspacePath);
  const messages = getRecentMessages(log, { channel });
  
  // Convert to legacy format (without channel field per message)
  const legacyMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  }));
  
  const lastMsg = messages[messages.length - 1];
  
  return {
    channel,
    messages: legacyMessages,
    lastActivity: lastMsg?.timestamp || log.lastActivity,
  };
}

/**
 * Get time since last activity (in minutes)
 */
export function getMinutesSinceLastActivity(history: ConversationHistory): number {
  if (!history.lastActivity) return Infinity;
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
 * Check if there has been any contact today on any channel
 */
export async function hasContactTodayAnyChannel(workspacePath: string): Promise<boolean> {
  const log = await loadConversationLog(workspacePath);
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return log.messages.some(msg => msg.timestamp.startsWith(today));
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

/**
 * Format recent messages from all channels for cross-channel awareness
 */
export async function formatCrossChannelContext(
  workspacePath: string,
  excludeChannel?: string,
  limit: number = 10
): Promise<string> {
  const log = await loadConversationLog(workspacePath);
  
  // Get recent messages from OTHER channels
  let messages = getRecentMessages(log, { limit: limit * 2 });
  
  if (excludeChannel) {
    messages = messages.filter(m => m.channel !== excludeChannel);
  }
  
  if (messages.length === 0) {
    return '';
  }
  
  // Take most recent
  messages = messages.slice(-limit);
  
  const lines: string[] = [];
  
  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const channelTag = `[${msg.channel.toUpperCase()}]`;
    const role = msg.role === 'user' ? 'Sergio' : 'Claire';
    const content = msg.content.length > 200 
      ? msg.content.slice(0, 200) + '...' 
      : msg.content;
    lines.push(`${channelTag} ${time} ${role}: ${content}`);
  }
  
  return lines.join('\n');
}

/**
 * Legacy: Load all conversations (now just returns the unified log split by channel)
 */
export async function loadAllConversations(
  workspacePath: string
): Promise<ConversationHistory[]> {
  const log = await loadConversationLog(workspacePath);
  
  // Group messages by channel
  const byChannel = new Map<string, Message[]>();
  
  for (const msg of log.messages) {
    if (!msg.channel) continue;
    if (!byChannel.has(msg.channel)) {
      byChannel.set(msg.channel, []);
    }
    byChannel.get(msg.channel)!.push(msg);
  }
  
  // Convert to ConversationHistory format
  const histories: ConversationHistory[] = [];
  
  for (const [channel, messages] of byChannel) {
    const recent = messages.slice(-MAX_MESSAGES_HOT);
    const lastMsg = recent[recent.length - 1];
    
    histories.push({
      channel,
      messages: recent.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
      lastActivity: lastMsg?.timestamp || log.lastActivity,
    });
  }
  
  return histories;
}

/**
 * Legacy: Format all conversations for summary
 */
export function formatAllConversationsForSummary(
  histories: ConversationHistory[],
  excludeChannel?: string
): string {
  const otherChannels = histories.filter(h => h.channel !== excludeChannel);
  
  if (otherChannels.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  
  for (const history of otherChannels) {
    if (history.messages.length === 0) continue;
    if (!history.channel) continue;
    
    lines.push(`\n[${history.channel.toUpperCase()}]`);
    for (const msg of history.messages) {
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const role = msg.role === 'user' ? 'Sergio' : 'Claire';
      const content = msg.content.length > 200 
        ? msg.content.slice(0, 200) + '...' 
        : msg.content;
      lines.push(`${time} ${role}: ${content}`);
    }
  }
  
  return lines.join('\n');
}
