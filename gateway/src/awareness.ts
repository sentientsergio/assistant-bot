/**
 * Awareness Context Builder
 * 
 * Builds structured awareness context for Claire before every message.
 * Answers the three questions:
 * 1. What have I written lately? (Self-awareness)
 * 2. What has Sergio written lately? (Sergio-awareness)
 * 3. How is this conversation going? (Relationship-awareness)
 * 
 * Design: Descriptive, not prescriptive. Present facts, let Claude reason.
 */

import { loadConversationLog, type Message } from './conversation.js';

// Types

export interface SelfAwareness {
  messagesSinceSergioLast: Message[];   // Claire's messages since Sergio's last message
  lastMessageTime: Date | null;
  timeSinceLastMessage: number;         // minutes
  topicsMentioned: string[];            // Topics she's raised
}

export interface SergioAwareness {
  lastMessage: Message | null;
  timeSinceLastMessage: number;         // minutes
  recentMessages: Message[];            // His recent messages
  engagementLevel: 'active' | 'sporadic' | 'silent';
  topicsAddressed: string[];            // Topics he's answered
}

export interface ConversationState {
  unansweredCount: number;              // Claire's messages without response
  lastExchangeTone: 'warm' | 'neutral' | 'tense' | 'unknown';
  currentDomain: string | null;         // What are we talking about?
  silenceDuration: number;              // minutes since any message
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayType: 'weekday' | 'weekend';
  isActiveConversation: boolean;        // For elastic formatting
}

export interface AwarenessContext {
  self: SelfAwareness;
  sergio: SergioAwareness;
  conversationState: ConversationState;
}

// Topic extraction patterns (simple keyword-based)
// Updated 2026-02-03: Added work, commitment, architecture, relationship per Claire's feedback
const TOPIC_PATTERNS: Record<string, RegExp> = {
  'hydration': /\b(water|hydrat|oz|drink)\b/i,
  'medication': /\b(meds?|medication|pill|taken)\b/i,
  'movement': /\b(walk|movement|steps?|exercise|move)\b/i,
  'fasting': /\b(fast|eating window|IF|intermittent|broke fast)\b/i,
  'weight': /\b(weight|scale|lbs?|pounds?)\b/i,
  'calendar': /\b(calendar|meeting|schedule|appointment)\b/i,
  'project': /\b(project|code|cursor|implementation|build)\b/i,
  'philosophy': /\b(think|meaning|identity|soul|becoming)\b/i,
  'work': /\b(SURS|testbed|import.?export|sprint|omni|regression)\b/i,
  'commitment': /\b(commit|promise|will do|going to|intention|plan to)\b/i,
  'architecture': /\b(architect|design|system|prompt|gateway|memory)\b/i,
  'relationship': /\b(claire|trust|together|how we|between us)\b/i,
};

/**
 * Extract topics mentioned in a message
 */
function extractTopics(content: string): string[] {
  const topics: string[] = [];
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(content)) {
      topics.push(topic);
    }
  }
  return topics;
}

/**
 * Detect engagement level based on message patterns
 */
function detectEngagementLevel(
  messages: Message[], 
  timeSinceLastMessage: number
): 'active' | 'sporadic' | 'silent' {
  if (timeSinceLastMessage > 360) { // 6+ hours
    return 'silent';
  }
  if (timeSinceLastMessage > 120) { // 2+ hours
    return 'sporadic';
  }
  // Check message frequency in last hour
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentCount = messages.filter(m => 
    new Date(m.timestamp).getTime() > oneHourAgo
  ).length;
  
  return recentCount >= 2 ? 'active' : 'sporadic';
}

/**
 * Detect tone of last exchange (simple heuristic)
 */
function detectTone(messages: Message[]): 'warm' | 'neutral' | 'tense' | 'unknown' {
  if (messages.length === 0) return 'unknown';
  
  const lastFew = messages.slice(-4);
  const content = lastFew.map(m => m.content.toLowerCase()).join(' ');
  
  // Simple heuristics
  if (/\b(thanks|thank you|appreciate|love|great|perfect)\b/.test(content)) {
    return 'warm';
  }
  if (/\b(wrong|no\b|incorrect|not what|already|stop)\b/.test(content)) {
    return 'tense';
  }
  
  return 'neutral';
}

/**
 * Detect current domain of conversation
 */
function detectDomain(messages: Message[]): string | null {
  if (messages.length === 0) return null;
  
  const lastFew = messages.slice(-3);
  const content = lastFew.map(m => m.content).join(' ');
  const topics = extractTopics(content);
  
  // Return most recent dominant topic
  if (topics.length > 0) {
    return topics[topics.length - 1];
  }
  
  return null;
}

/**
 * Get time of day classification
 */
function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Get day type
 */
function getDayType(): 'weekday' | 'weekend' {
  const day = new Date().getDay();
  return (day === 0 || day === 6) ? 'weekend' : 'weekday';
}

/**
 * Build the full awareness context
 */
export async function buildAwarenessContext(
  workspacePath: string,
  lookbackHours: number = 48
): Promise<AwarenessContext> {
  const now = Date.now();
  const cutoff = new Date(now - lookbackHours * 60 * 60 * 1000);
  
  // Load conversation log
  const log = await loadConversationLog(workspacePath);
  
  // Filter to lookback window
  const messages = log.messages.filter(m => 
    new Date(m.timestamp) > cutoff
  );
  
  // Find Sergio's messages and Claire's messages
  const sergioMessages = messages.filter(m => m.role === 'user');
  const claireMessages = messages.filter(m => m.role === 'assistant');
  
  // Find Sergio's last message
  const sergioLastMessage = sergioMessages.length > 0 
    ? sergioMessages[sergioMessages.length - 1] 
    : null;
  
  const sergioLastTime = sergioLastMessage 
    ? new Date(sergioLastMessage.timestamp).getTime()
    : 0;
  
  const timeSinceSergioLast = sergioLastMessage
    ? Math.floor((now - sergioLastTime) / 60000)
    : Infinity;
  
  // Find Claire's messages since Sergio's last message
  const claireSinceSergioLast = claireMessages.filter(m =>
    new Date(m.timestamp).getTime() > sergioLastTime
  );
  
  // Claire's last message
  const claireLastMessage = claireMessages.length > 0
    ? claireMessages[claireMessages.length - 1]
    : null;
  
  const claireLastTime = claireLastMessage
    ? new Date(claireLastMessage.timestamp).getTime()
    : 0;
  
  const timeSinceClaireLast = claireLastMessage
    ? Math.floor((now - claireLastTime) / 60000)
    : Infinity;
  
  // Extract topics Claire has mentioned since Sergio's last message
  const claireTopics = new Set<string>();
  for (const msg of claireSinceSergioLast) {
    for (const topic of extractTopics(msg.content)) {
      claireTopics.add(topic);
    }
  }
  
  // Extract topics Sergio has addressed recently
  const sergioTopics = new Set<string>();
  const recentSergioMessages = sergioMessages.slice(-5);
  for (const msg of recentSergioMessages) {
    for (const topic of extractTopics(msg.content)) {
      sergioTopics.add(topic);
    }
  }
  
  // Determine if we're in an active conversation
  const lastMessageTime = Math.max(sergioLastTime, claireLastTime);
  const silenceDuration = Math.floor((now - lastMessageTime) / 60000);
  const isActiveConversation = silenceDuration < 30 && messages.length > 4;
  
  // Build context
  const context: AwarenessContext = {
    self: {
      messagesSinceSergioLast: claireSinceSergioLast,
      lastMessageTime: claireLastMessage ? new Date(claireLastMessage.timestamp) : null,
      timeSinceLastMessage: timeSinceClaireLast,
      topicsMentioned: Array.from(claireTopics),
    },
    sergio: {
      lastMessage: sergioLastMessage,
      timeSinceLastMessage: timeSinceSergioLast,
      recentMessages: recentSergioMessages,
      engagementLevel: detectEngagementLevel(sergioMessages, timeSinceSergioLast),
      topicsAddressed: Array.from(sergioTopics),
    },
    conversationState: {
      unansweredCount: claireSinceSergioLast.length,
      lastExchangeTone: detectTone(messages.slice(-6)),
      currentDomain: detectDomain(messages),
      silenceDuration,
      timeOfDay: getTimeOfDay(),
      dayType: getDayType(),
      isActiveConversation,
    },
  };
  
  return context;
}

/**
 * Format time duration in human-readable form
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Format awareness context for prompt injection (full format)
 */
export function formatAwarenessForPrompt(context: AwarenessContext): string {
  const sections: string[] = [];
  
  sections.push(`## Conversational Awareness

Before responding, review your current interaction state:
`);
  
  // Self-awareness section
  sections.push(`### Your Recent Activity
`);
  
  if (context.self.messagesSinceSergioLast.length === 0) {
    sections.push(`You have not sent any messages since Sergio last spoke.
`);
  } else {
    sections.push(`Since Sergio's last message, you have sent ${context.self.messagesSinceSergioLast.length} message(s):
`);
    
    for (const msg of context.self.messagesSinceSergioLast.slice(-5)) { // Show last 5 max
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const preview = msg.content.length > 100 
        ? msg.content.slice(0, 100) + '...' 
        : msg.content;
      sections.push(`- ${time}: "${preview}"
`);
    }
    
    if (context.self.topicsMentioned.length > 0) {
      sections.push(`
Topics you've mentioned: ${context.self.topicsMentioned.join(', ')}
`);
    }
  }
  
  if (context.self.lastMessageTime) {
    sections.push(`Time since your last message: ${formatDuration(context.self.timeSinceLastMessage)}
`);
  }
  
  // Sergio-awareness section
  sections.push(`
### Sergio's Recent Activity
`);
  
  if (context.sergio.lastMessage) {
    const time = new Date(context.sergio.lastMessage.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const preview = context.sergio.lastMessage.content.length > 150
      ? context.sergio.lastMessage.content.slice(0, 150) + '...'
      : context.sergio.lastMessage.content;
    
    sections.push(`Last message: "${preview}" (${time}, ${formatDuration(context.sergio.timeSinceLastMessage)} ago)
`);
    
    if (context.conversationState.unansweredCount > 0) {
      sections.push(`Responses to your ${context.conversationState.unansweredCount} recent message(s): None
`);
    }
    
    if (context.sergio.topicsAddressed.length > 0) {
      sections.push(`Topics he's addressed recently: ${context.sergio.topicsAddressed.join(', ')}
`);
    }
  } else {
    sections.push(`No recent messages from Sergio in the last ${48} hours.
`);
  }
  
  sections.push(`Engagement: ${context.sergio.engagementLevel}
`);
  
  // Conversation state section
  sections.push(`
### Conversational Context
`);
  
  sections.push(`- Unanswered messages from you: ${context.conversationState.unansweredCount}
- Silence duration: ${formatDuration(context.conversationState.silenceDuration)}
- Time: ${context.conversationState.timeOfDay} (${context.conversationState.dayType})
- Last exchange tone: ${context.conversationState.lastExchangeTone}
`);
  
  if (context.conversationState.currentDomain) {
    sections.push(`- Current topic domain: ${context.conversationState.currentDomain}
`);
  }
  
  sections.push(`
---
`);
  
  return sections.join('');
}

/**
 * Format awareness context (slim format for active conversations)
 */
export function formatAwarenessSlim(context: AwarenessContext): string {
  const sections: string[] = [];
  
  sections.push(`## Recent Context (active conversation)
`);
  
  // Just the essentials
  if (context.self.messagesSinceSergioLast.length > 0) {
    sections.push(`Your messages since Sergio last spoke: ${context.self.messagesSinceSergioLast.length}
`);
  }
  
  sections.push(`Time in silence: ${formatDuration(context.conversationState.silenceDuration)}
`);
  
  if (context.conversationState.currentDomain) {
    sections.push(`Current topic: ${context.conversationState.currentDomain}
`);
  }
  
  sections.push(`
---
`);
  
  return sections.join('');
}

/**
 * Format awareness with elastic formatting (full or slim based on context)
 */
export function formatAwareness(context: AwarenessContext): string {
  // Use slim format if actively engaged
  if (context.conversationState.isActiveConversation) {
    return formatAwarenessSlim(context);
  }
  
  // Use full format otherwise
  return formatAwarenessForPrompt(context);
}

/**
 * Pre-check: Should a heartbeat fire at all?
 * Returns false if we should suppress the heartbeat entirely.
 */
export function shouldFireHeartbeat(context: AwarenessContext): { 
  shouldFire: boolean; 
  reason: string;
} {
  // Hard limit: if Claire has sent 3+ unanswered messages, suppress
  if (context.conversationState.unansweredCount >= 3) {
    return { 
      shouldFire: false, 
      reason: `Already sent ${context.conversationState.unansweredCount} unanswered messages`
    };
  }
  
  // If we just messaged recently (< 30 min), suppress
  if (context.self.timeSinceLastMessage < 30 && context.self.lastMessageTime) {
    return {
      shouldFire: false,
      reason: `Last message was only ${context.self.timeSinceLastMessage}m ago`
    };
  }
  
  // Weekend: lighter touch - max 2 unanswered
  if (context.conversationState.dayType === 'weekend' && 
      context.conversationState.unansweredCount >= 2) {
    return {
      shouldFire: false,
      reason: `Weekend mode: already sent ${context.conversationState.unansweredCount} unanswered messages`
    };
  }
  
  // Night time: suppress non-urgent heartbeats
  if (context.conversationState.timeOfDay === 'night') {
    return {
      shouldFire: false,
      reason: 'Night hours - suppressing heartbeat'
    };
  }
  
  // Active conversation: let them breathe
  if (context.conversationState.isActiveConversation) {
    return {
      shouldFire: false,
      reason: 'Active conversation in progress'
    };
  }
  
  return { shouldFire: true, reason: 'OK' };
}

/**
 * Get topics Claire has mentioned that Sergio hasn't addressed
 * Useful for knowing what NOT to ask about again
 */
export function getUnansweredTopics(context: AwarenessContext): string[] {
  const mentioned = new Set(context.self.topicsMentioned);
  const addressed = new Set(context.sergio.topicsAddressed);
  
  return Array.from(mentioned).filter(topic => !addressed.has(topic));
}
