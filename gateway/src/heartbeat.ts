/**
 * Heartbeat Scheduler
 * 
 * Triggers periodic checks where the assistant decides if it should reach out.
 * Uses Telegram if available, falls back to macOS notifications.
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { simpleChat } from './claude.js';
import { loadHeartbeatContext } from './workspace.js';
import { sendToOwner, isTelegramRunning } from './channels/telegram.js';

const execAsync = promisify(exec);

// Default schedule: every hour from 8am to 10pm (Sergio wakes at 8, bed at 11)
const DEFAULT_SCHEDULE = '0 8-22 * * *';

// Notification settings
const NOTIFICATION_TITLE = 'Assistant';
const NOTIFICATION_SOUND = 'default';

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
async function performHeartbeat(workspacePath: string): Promise<void> {
  console.log(`[${new Date().toISOString()}] Heartbeat triggered`);

  // Skip during quiet hours
  if (isQuietHours()) {
    console.log('  Quiet hours - skipping');
    return;
  }

  try {
    // Load context and ask Claude if we should reach out
    const systemPrompt = await loadHeartbeatContext(workspacePath);
    
    const response = await simpleChat(
      'Should you reach out to Sergio right now? Consider the time, his accountability goals, and whether there\'s anything worth mentioning.',
      systemPrompt
    );

    const trimmedResponse = response.trim();

    // Check if Claude decided not to send a notification
    if (trimmedResponse === 'NO_NOTIFICATION' || trimmedResponse.includes('NO_NOTIFICATION')) {
      console.log('  Decision: no notification');
      return;
    }

    // Send via Telegram if available, otherwise Mac notification
    console.log(`  Sending: ${trimmedResponse.substring(0, 50)}...`);
    
    if (isTelegramRunning()) {
      const sent = await sendToOwner(trimmedResponse);
      if (sent) {
        console.log('  Delivered via Telegram');
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
 * Start the heartbeat scheduler
 */
export function startHeartbeat(
  workspacePath: string,
  schedule: string = DEFAULT_SCHEDULE
): cron.ScheduledTask {
  console.log(`Starting heartbeat scheduler with schedule: ${schedule}`);

  const task = cron.schedule(schedule, () => {
    performHeartbeat(workspacePath).catch((err) => {
      console.error('Heartbeat failed:', err);
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
 * Manually trigger a heartbeat (useful for testing)
 */
export async function triggerHeartbeat(workspacePath: string): Promise<void> {
  await performHeartbeat(workspacePath);
}
