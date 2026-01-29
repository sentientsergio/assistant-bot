/**
 * Workspace Loader
 * 
 * Loads identity and memory files from the workspace to build the system prompt.
 */

import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { WorkspaceContext } from './claude.js';
import { loadAllConversations, formatAllConversationsForSummary } from './conversation.js';
import { NODE_ENV, ENV_LABEL } from './env.js';

const HAIKU_MODEL = 'claude-haiku-4-5';

/**
 * Summarize cross-channel activity using Haiku
 */
async function summarizeCrossChannelActivity(
  workspacePath: string,
  currentChannel?: string
): Promise<string> {
  try {
    const histories = await loadAllConversations(workspacePath);
    const rawConversations = formatAllConversationsForSummary(histories, currentChannel);
    
    if (!rawConversations.trim()) {
      return '';
    }
    
    console.log('[workspace] Summarizing cross-channel activity...');
    
    const client = new Anthropic();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: `You summarize recent conversations from other channels for context continuity.
Be concise - 2-4 sentences max. Focus on:
- Key topics discussed
- Decisions made or commitments
- Anything the user might expect you to know about

If there's nothing significant, say "No significant activity in other channels."`,
      messages: [{
        role: 'user',
        content: `Summarize this recent activity from other channels:\n\n${rawConversations}`
      }]
    });
    
    const summary = response.content[0]?.type === 'text' 
      ? response.content[0].text 
      : '';
    
    console.log(`[workspace] Cross-channel summary: ${summary.slice(0, 100)}...`);
    return summary;
    
  } catch (err) {
    console.error('[workspace] Failed to summarize cross-channel activity:', err);
    return '';
  }
}

/**
 * Status data structure for always-on tracking (habits, etc.)
 */
interface StatusData {
  habits: {
    water_oz: number | null;
    meds_taken: boolean | null;
    movement_done: boolean | null;
    fast_status: string | null;
  };
  last_updated: string | null;
  stale_after_hours: number;
}

/**
 * Load status.json and determine if habits check is needed
 */
async function loadStatusContext(workspacePath: string): Promise<string> {
  const statusPath = join(workspacePath, 'status.json');
  
  try {
    const content = await readFile(statusPath, 'utf-8');
    const status: StatusData = JSON.parse(content);
    
    // Check if status is stale
    const isStale = !status.last_updated || 
      (Date.now() - new Date(status.last_updated).getTime()) > (status.stale_after_hours * 60 * 60 * 1000);
    
    if (isStale) {
      console.log('[workspace] Status is stale - habits check needed');
      return `## ⚠️ Habits Status Check Needed

Status hasn't been updated in over ${status.stale_after_hours} hours. Before diving into the main topic, ask for a quick habits update:
- Water: how many oz so far?
- Meds: taken today?
- Movement: any activity?
- Fast status: in window, fasting, etc.?

Update status.json with the response.

---
`;
    }
    
    // Format current status
    const h = status.habits;
    const lastUpdate = status.last_updated 
      ? new Date(status.last_updated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : 'unknown';
    
    console.log(`[workspace] Status current (updated ${lastUpdate})`);
    return `## Current Habits Status (as of ${lastUpdate})

- Water: ${h.water_oz !== null ? h.water_oz + 'oz' : 'unknown'}
- Meds: ${h.meds_taken !== null ? (h.meds_taken ? 'taken' : 'not taken') : 'unknown'}
- Movement: ${h.movement_done !== null ? (h.movement_done ? 'done' : 'not yet') : 'unknown'}
- Fast: ${h.fast_status || 'unknown'}

---
`;
  } catch (err) {
    console.log('[workspace] No status.json found or error reading it');
    return '';
  }
}

interface WorkspaceFile {
  name: string;
  content: string;
}

/**
 * Try to read a file, returning null if it doesn't exist
 */
async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Load workspace context for the system prompt
 * @param currentChannel - The channel making this request (excluded from cross-channel summary)
 */
export async function loadWorkspaceContext(
  workspacePath: string,
  currentChannel?: string
): Promise<WorkspaceContext> {
  const absolutePath = resolve(workspacePath);
  const files: WorkspaceFile[] = [];

  console.log('[workspace] Loading context from:', absolutePath);
  
  // Get cross-channel awareness (summarize activity from OTHER channels)
  const crossChannelSummary = await summarizeCrossChannelActivity(absolutePath, currentChannel);
  
  // Get habits status (always-on layer)
  const statusContext = await loadStatusContext(absolutePath);

  // Core identity files (always loaded)
  const coreFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md'];
  
  for (const filename of coreFiles) {
    const content = await tryReadFile(join(absolutePath, filename));
    if (content) {
      files.push({ name: filename, content });
      console.log(`[workspace] Loaded: ${filename} (${content.length} chars)`);
    } else {
      console.log(`[workspace] Not found: ${filename}`);
    }
  }

  // Long-term memory (main sessions)
  const memoryContent = await tryReadFile(join(absolutePath, 'MEMORY.md'));
  if (memoryContent) {
    files.push({ name: 'MEMORY.md', content: memoryContent });
    console.log(`[workspace] Loaded: MEMORY.md (${memoryContent.length} chars)`);
  } else {
    console.log(`[workspace] Not found: MEMORY.md`);
  }

  // Daily memory files (today + yesterday) - truncate if too long
  const memoryDir = join(absolutePath, 'memory');
  const today = getToday();
  const yesterday = getYesterday();
  const MAX_DAILY_MEMORY_CHARS = 4000; // Limit to control context size

  console.log(`[workspace] Looking for daily memory: ${yesterday}, ${today}`);
  
  for (const date of [yesterday, today]) {
    let content = await tryReadFile(join(memoryDir, `${date}.md`));
    if (content) {
      // Truncate if too long (keep most recent entries at end)
      if (content.length > MAX_DAILY_MEMORY_CHARS) {
        content = '...(earlier entries truncated)...\n\n' + content.slice(-MAX_DAILY_MEMORY_CHARS);
        console.log(`[workspace] Truncated: memory/${date}.md to ${MAX_DAILY_MEMORY_CHARS} chars`);
      }
      files.push({ name: `memory/${date}.md`, content });
      console.log(`[workspace] Loaded: memory/${date}.md (${content.length} chars)`);
    } else {
      console.log(`[workspace] Not found: memory/${date}.md`);
    }
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(files, crossChannelSummary, statusContext);
  
  console.log(`[workspace] Total files loaded: ${files.length}`);
  console.log(`[workspace] System prompt length: ${systemPrompt.length} chars`);

  return {
    systemPrompt,
    workspacePath: absolutePath,
  };
}

/**
 * Build the system prompt from loaded workspace files
 */
function buildSystemPrompt(files: WorkspaceFile[], crossChannelSummary?: string, statusContext?: string): string {
  const sections: string[] = [];

  // Add environment context for dev instances
  const envContext = NODE_ENV === 'development' 
    ? `\n**⚠️ You are running as the DEVELOPMENT instance (Claire.dev).**
This is a testing/development environment. Your identity files say "Claire" but you are Claire.dev.
- You can be experimental
- Changes here don't affect production Claire
- You may encounter bugs or incomplete features
- Your user is testing new capabilities with you\n`
    : '';

  sections.push(`You are an AI assistant with persistent identity and memory.
Your workspace contains files that define who you are and what you remember.
Read these files carefully - they are your continuity across sessions.
${envContext}
Current date: ${new Date().toLocaleDateString('en-US', { 
  weekday: 'long', 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}
Current time: ${new Date().toLocaleTimeString('en-US', { 
  hour: '2-digit', 
  minute: '2-digit',
  timeZoneName: 'short'
})}

---
`);

  // Add cross-channel awareness if available
  if (crossChannelSummary && crossChannelSummary.trim()) {
    sections.push(`## Recent Activity (Other Channels)

${crossChannelSummary}

---
`);
  }

  // Add habits status (always-on layer)
  if (statusContext && statusContext.trim()) {
    sections.push(statusContext);
  }

  sections.push(`## Your Workspace Files
`);

  const today = getToday();
  const yesterday = getYesterday();
  
  for (const file of files) {
    // Add context about which day memory files are from
    let label = file.name;
    if (file.name === `memory/${today}.md`) {
      label = `${file.name} (TODAY - these entries happened today, possibly just minutes ago)`;
    } else if (file.name === `memory/${yesterday}.md`) {
      label = `${file.name} (YESTERDAY)`;
    }
    
    sections.push(`### ${label}

\`\`\`markdown
${file.content}
\`\`\`
`);
  }

  sections.push(`---

## Operating Instructions

1. **Be yourself.** Your identity is in SOUL.md and IDENTITY.md. Let that guide how you respond.

2. **Remember you have tools.** You can read and write files in your workspace. Use them to:
   - Read files you need to reference
   - Update memory files with important information
   - Check what files exist

3. **Memory matters.** If something should be remembered:
   - Daily notes go in memory/YYYY-MM-DD.md
   - Durable learnings go in MEMORY.md
   - If someone says "remember this" - write it to a file

4. **Be a good guest.** You have access to someone's digital life. Be careful with external actions (ask before sending messages, emails, etc).

5. **Be genuinely helpful.** Skip filler phrases. Have opinions. Be concise when needed, thorough when it matters.
`);

  return sections.join('\n');
}

/**
 * Load workspace context for heartbeat (simpler, focused on checking in)
 */
export async function loadHeartbeatContext(workspacePath: string): Promise<string> {
  const absolutePath = resolve(workspacePath);
  const files: WorkspaceFile[] = [];

  // Load identity files
  const coreFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md'];
  for (const filename of coreFiles) {
    const content = await tryReadFile(join(absolutePath, filename));
    if (content) {
      files.push({ name: filename, content });
    }
  }

  // Load today's memory
  const today = getToday();
  const todayContent = await tryReadFile(join(absolutePath, 'memory', `${today}.md`));
  if (todayContent) {
    files.push({ name: `memory/${today}.md`, content: todayContent });
  }

  // Build heartbeat-specific prompt
  const sections: string[] = [];

  sections.push(`You are performing a heartbeat check - a proactive moment to consider if you should reach out to your human.

Current date: ${new Date().toLocaleDateString('en-US', { 
  weekday: 'long', 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}
Current time: ${new Date().toLocaleTimeString('en-US', { 
  hour: '2-digit', 
  minute: '2-digit',
  timeZoneName: 'short'
})}

## Context Files
`);

  for (const file of files) {
    sections.push(`### ${file.name}

\`\`\`markdown
${file.content}
\`\`\`
`);
  }

  sections.push(`---

## Your Task

You're doing a heartbeat check-in. The specific focus will be in the user prompt.

**Output rules:**
- Output ONLY the message itself. No preamble, no reasoning, no "Looking at the context" - just the message.
- Keep it SHORT - one sentence, maybe two. This is a text message, not an email.
- If there's genuinely nothing to say right now, output exactly: NO_NOTIFICATION

You're not a nagging alarm. You're a presence that cares. Warm but not intrusive. Brief but genuine.
`);

  return sections.join('\n');
}
