#!/usr/bin/env node
/**
 * Test macOS notifications directly
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function sendNotification(message) {
  const title = 'Assistant';
  
  // For osascript, we need to escape for AppleScript string literals
  const escapedForAS = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  // For terminal-notifier, escape shell
  const escapedForShell = message.replace(/"/g, '\\"').replace(/\n/g, ' ');
  
  // Try terminal-notifier first
  try {
    await execAsync(`terminal-notifier -title "${title}" -message "${escapedForShell}" -sound default`);
    console.log('Sent via terminal-notifier');
    return;
  } catch {
    console.log('terminal-notifier not found, trying osascript...');
  }
  
  // Fall back to osascript - use double quotes for the shell, escaped quotes for AppleScript
  try {
    const cmd = `osascript -e "display notification \\"${escapedForAS}\\" with title \\"${title}\\""`;
    await execAsync(cmd);
    console.log('Sent via osascript');
  } catch (err) {
    console.error('Failed to send notification:', err.message);
  }
}

console.log('Sending test notification...\n');
await sendNotification("Hey Sergio! This is a test of the heartbeat notification system. If you can see this, it's working.");
console.log('\nCheck your Mac notification center!');
