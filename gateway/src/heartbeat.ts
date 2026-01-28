/**
 * Heartbeat Scheduler
 * 
 * Triggers periodic checks where the assistant decides if it should reach out.
 * Uses Telegram if available, falls back to macOS notifications.
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { chat } from './claude.js';
import { loadHeartbeatContext, loadWorkspaceContext } from './workspace.js';
import { sendToOwner, isTelegramRunning } from './channels/telegram.js';
import { 
  loadConversation, 
  addMessage, 
  hasRecentActivity,
  getMinutesSinceLastActivity,
} from './conversation.js';

const execAsync = promisify(exec);

// Default schedule: every hour from 8am to 10pm
const DEFAULT_SCHEDULE = '0 8-22 * * *';

// Notification settings
const NOTIFICATION_TITLE = 'Assistant';
const NOTIFICATION_SOUND = 'default';

// Timing jitter range (minutes)
const JITTER_MIN = 0;
const JITTER_MAX = 25;

// Skip heartbeat if conversation happened within this many minutes
const RECENT_CONVERSATION_THRESHOLD = 30;

// Heartbeat types with different purposes
type HeartbeatType = 'accountability' | 'presence' | 'reflection' | 'maintenance';

interface HeartbeatPrompt {
  type: HeartbeatType;
  prompt: string;
  weight: number; // Higher = more likely to be selected
  useTools: boolean; // Whether this heartbeat needs file access
  silent: boolean; // Whether to send a message to user
}

const HEARTBEAT_PROMPTS: HeartbeatPrompt[] = [
  {
    type: 'accountability',
    prompt: 'Check in on Sergio\'s accountability goals. Pick ONE focus: water intake, movement, or how he\'s feeling. Keep it brief - one short sentence.',
    weight: 3, // Most common
    useTools: false,
    silent: false,
  },
  {
    type: 'presence',
    prompt: 'Send a brief presence ping - just letting Sergio know you\'re thinking of him. No asks, no questions about goals. Just a moment of connection. One sentence max.',
    weight: 1,
    useTools: false,
    silent: false,
  },
  {
    type: 'reflection',
    prompt: 'Share a brief thought or observation based on recent context - something you noticed, an insight, or just checking the vibe. Keep it light and short.',
    weight: 1,
    useTools: false,
    silent: false,
  },
];

// Maintenance heartbeat - runs once daily, curates memory
const MAINTENANCE_PROMPT: HeartbeatPrompt = {
  type: 'maintenance',
  prompt: `Perform daily memory maintenance:

1. Read today's daily memory file (memory/YYYY-MM-DD.md where YYYY-MM-DD is today's date)
2. Identify durable learnings that should persist: patterns, preferences, decisions, important context
3. Read MEMORY.md to see what's already curated
4. Update MEMORY.md with new durable learnings (append to appropriate sections, don't duplicate)
5. Be selective - only promote things that matter long-term, not daily details

After maintenance, send a brief summary to Sergio listing what you promoted. Example:
"Memory curation: added IF protocol details, noted sprint discipline preference, updated project context."

Keep it to one short message. If nothing new to curate, just say "Memory check: nothing new to promote today."`,
  weight: 0, // Not randomly selected
  useTools: true,
  silent: false,
};

/**
 * Select a heartbeat type using weighted random selection
 */
function selectHeartbeatType(): HeartbeatPrompt {
  const totalWeight = HEARTBEAT_PROMPTS.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const prompt of HEARTBEAT_PROMPTS) {
    random -= prompt.weight;
    if (random <= 0) {
      return prompt;
    }
  }
  
  return HEARTBEAT_PROMPTS[0]; // Fallback
}

/**
 * Send a macOS notification using terminal-notifier or osascript
 */
async function sendNotification(message: string): Promise<void> {
  // Escape for shell/AppleScript
  const escapedForShell = message.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const escapedForAS = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  // Try terminal-notifier first (better UX), fall back to osascript
  try {
    await execAsync(
      `terminal-notifier -title "${NOTIFICATION_TITLE}" -message "${escapedForShell}" -sound ${NOTIFICATION_SOUND}`
    );
    console.log('  Notification sent via terminal-notifier');
    return;
  } catch {
    // terminal-notifier not installed, try osascript
  }

  try {
    const cmd = `osascript -e "display notification \\"${escapedForAS}\\" with title \\"${NOTIFICATION_TITLE}\\""`;
    await execAsync(cmd);
    console.log('  Notification sent via osascript');
  } catch (err) {
    console.error('  Failed to send notification:', err);
  }
}

/**
 * Check if we're in quiet hours (11pm - 8am)
 */
function isQuietHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 8;
}

/**
 * Perform a heartbeat check
 */
async function performHeartbeat(
  workspacePath: string, 
  forceType?: HeartbeatPrompt
): Promise<void> {
  console.log(`[${new Date().toISOString()}] Heartbeat triggered`);

  // Skip during quiet hours (unless it's maintenance)
  if (isQuietHours() && !forceType) {
    console.log('  Quiet hours - skipping');
    return;
  }

  try {
    // Check for recent conversation (skip for maintenance)
    if (!forceType) {
      const history = await loadConversation(workspacePath, 'telegram');
      const minutesSince = getMinutesSinceLastActivity(history);
      
      if (hasRecentActivity(history, RECENT_CONVERSATION_THRESHOLD)) {
        console.log(`  Recent conversation (${minutesSince}m ago) - skipping heartbeat`);
        return;
      }
      
      console.log(`  Last conversation: ${minutesSince}m ago`);
    }
    
    // Select heartbeat type
    const heartbeatType = forceType || selectHeartbeatType();
    console.log(`  Heartbeat type: ${heartbeatType.type}`);
    
    let response: string;
    
    if (heartbeatType.useTools) {
      // Use full chat with tool access
      const workspaceContext = await loadWorkspaceContext(workspacePath, 'heartbeat');
      let fullResponse = '';
      
      response = await chat(
        heartbeatType.prompt,
        workspaceContext,
        workspacePath,
        (delta) => { fullResponse += delta; }
      );
    } else {
      // Use lightweight heartbeat context (no tools needed)
      const systemPrompt = await loadHeartbeatContext(workspacePath);
      const workspaceContext = { systemPrompt, workspacePath };
      let fullResponse = '';
      
      response = await chat(
        heartbeatType.prompt,
        workspaceContext,
        workspacePath,
        (delta) => { fullResponse += delta; }
      );
    }

    const trimmedResponse = response.trim();

    // Check if Claude decided not to send a notification
    if (trimmedResponse === 'NO_NOTIFICATION' || trimmedResponse.includes('NO_NOTIFICATION')) {
      console.log('  Decision: no notification');
      return;
    }

    // Silent heartbeats don't send messages
    if (heartbeatType.silent) {
      console.log('  Silent heartbeat completed');
      return;
    }

    // Send via Telegram if available, otherwise Mac notification
    console.log(`  Sending: ${trimmedResponse.substring(0, 50)}...`);
    
    if (isTelegramRunning()) {
      const sent = await sendToOwner(trimmedResponse);
      if (sent) {
        console.log('  Delivered via Telegram');
        // Record heartbeat in conversation history so it has context
        await addMessage(workspacePath, 'telegram', 'assistant', trimmedResponse);
      } else {
        console.log('  Telegram failed, falling back to Mac notification');
        await sendNotification(trimmedResponse);
      }
    } else {
      await sendNotification(trimmedResponse);
    }
    
  } catch (err) {
    console.error('  Heartbeat error:', err);
  }
}

/**
 * Perform daily maintenance (memory curation)
 */
async function performMaintenance(workspacePath: string): Promise<void> {
  console.log(`[${new Date().toISOString()}] Daily maintenance triggered`);
  await performHeartbeat(workspacePath, MAINTENANCE_PROMPT);
}

/**
 * Get random jitter in milliseconds
 */
function getJitterMs(): number {
  const jitterMinutes = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);
  return Math.floor(jitterMinutes * 60 * 1000);
}

// Daily maintenance schedule (9pm)
const MAINTENANCE_SCHEDULE = '0 21 * * *';

/**
 * Start the heartbeat scheduler
 */
export function startHeartbeat(
  workspacePath: string,
  schedule: string = DEFAULT_SCHEDULE
): cron.ScheduledTask {
  console.log(`Starting heartbeat scheduler with schedule: ${schedule}`);
  console.log(`  Jitter range: ${JITTER_MIN}-${JITTER_MAX} minutes`);

  const task = cron.schedule(schedule, () => {
    // Add jitter so heartbeats don't feel like clockwork
    const jitterMs = getJitterMs();
    const jitterMinutes = Math.round(jitterMs / 60000);
    console.log(`[${new Date().toISOString()}] Heartbeat scheduled, jitter: +${jitterMinutes}m`);
    
    setTimeout(() => {
      performHeartbeat(workspacePath).catch((err) => {
        console.error('Heartbeat failed:', err);
      });
    }, jitterMs);
  });

  // Schedule daily maintenance (memory curation) at 9pm
  console.log(`Starting maintenance scheduler with schedule: ${MAINTENANCE_SCHEDULE}`);
  cron.schedule(MAINTENANCE_SCHEDULE, () => {
    performMaintenance(workspacePath).catch((err) => {
      console.error('Maintenance failed:', err);
    });
  });

  // Run an immediate check on startup (unless quiet hours)
  if (!isQuietHours()) {
    console.log('Running initial heartbeat check...');
    setTimeout(() => {
      performHeartbeat(workspacePath).catch((err) => {
        console.error('Initial heartbeat failed:', err);
      });
    }, 5000); // Wait 5 seconds for everything to initialize
  }

  return task;
}

/**
 * Manually trigger maintenance (useful for testing)
 */
export async function triggerMaintenance(workspacePath: string): Promise<void> {
  await performMaintenance(workspacePath);
}

/**
 * Manually trigger a heartbeat (useful for testing)
 */
export async function triggerHeartbeat(workspacePath: string): Promise<void> {
  await performHeartbeat(workspacePath);
}
