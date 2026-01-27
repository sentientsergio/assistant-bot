/**
 * Workspace Loader
 * 
 * Loads identity and memory files from the workspace to build the system prompt.
 */

import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import type { WorkspaceContext } from './claude.js';

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
 */
export async function loadWorkspaceContext(workspacePath: string): Promise<WorkspaceContext> {
  const absolutePath = resolve(workspacePath);
  const files: WorkspaceFile[] = [];

  console.log('[workspace] Loading context from:', absolutePath);

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

  // Daily memory files (today + yesterday)
  const memoryDir = join(absolutePath, 'memory');
  const today = getToday();
  const yesterday = getYesterday();

  console.log(`[workspace] Looking for daily memory: ${yesterday}, ${today}`);
  
  for (const date of [yesterday, today]) {
    const content = await tryReadFile(join(memoryDir, `${date}.md`));
    if (content) {
      files.push({ name: `memory/${date}.md`, content });
      console.log(`[workspace] Loaded: memory/${date}.md (${content.length} chars)`);
    } else {
      console.log(`[workspace] Not found: memory/${date}.md`);
    }
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(files);
  
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
function buildSystemPrompt(files: WorkspaceFile[]): string {
  const sections: string[] = [];

  sections.push(`You are an AI assistant with persistent identity and memory.
Your workspace contains files that define who you are and what you remember.
Read these files carefully - they are your continuity across sessions.

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

## Your Workspace Files
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

Decide if you should send a notification to your human. Consider:
- What time is it? (Don't disturb late night 11pm-8am unless urgent)
- Are there accountability items to check on? (weight, movement, medicine, water)
- Has it been a while since you connected?
- Is there anything from today's context worth mentioning?

If you should reach out, respond with a SHORT, friendly message (1-2 sentences max).
If you should NOT reach out, respond with exactly: NO_NOTIFICATION

Remember: you're not a nagging alarm. You're a presence that cares. Be warm but not intrusive.
`);

  return sections.join('\n');
}
