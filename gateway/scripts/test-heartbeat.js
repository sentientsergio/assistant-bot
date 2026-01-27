#!/usr/bin/env node
/**
 * Test the full heartbeat flow: trigger Claude to decide whether to notify
 * This version forces the prompt to encourage a notification for testing
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

const execAsync = promisify(exec);
const client = new Anthropic();

const WORKSPACE_PATH = resolve('../workspace');

async function tryReadFile(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function sendNotification(message) {
  const title = 'Assistant';
  const escapedForAS = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  try {
    await execAsync(`terminal-notifier -title "${title}" -message "${message}" -sound default`);
    console.log('Notification sent via terminal-notifier');
    return;
  } catch {
    // Fall back to osascript
  }
  
  try {
    const cmd = `osascript -e "display notification \\"${escapedForAS}\\" with title \\"${title}\\""`;
    await execAsync(cmd);
    console.log('Notification sent via osascript');
  } catch (err) {
    console.error('Failed to send notification:', err.message);
  }
}

async function main() {
  console.log('Testing full heartbeat flow...\n');
  
  // Load some context
  const soul = await tryReadFile(join(WORKSPACE_PATH, 'SOUL.md'));
  const identity = await tryReadFile(join(WORKSPACE_PATH, 'IDENTITY.md'));
  const user = await tryReadFile(join(WORKSPACE_PATH, 'USER.md'));
  
  console.log('Loaded workspace context:');
  console.log(`  SOUL.md: ${soul ? soul.length + ' chars' : 'not found'}`);
  console.log(`  IDENTITY.md: ${identity ? identity.length + ' chars' : 'not found'}`);
  console.log(`  USER.md: ${user ? user.length + ' chars' : 'not found'}`);
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  // Build a test prompt that encourages notification for demo purposes
  const systemPrompt = `You are performing a heartbeat check. Your context:

### SOUL.md
${soul || '(not loaded)'}

### IDENTITY.md  
${identity || '(not loaded)'}

### USER.md
${user || '(not loaded)'}

Current time: ${timeStr}

FOR THIS TEST: Please send a brief, friendly check-in message. This is a demo to show the notification system works.

Respond with a SHORT (1-2 sentence) friendly check-in message.`;

  console.log('\nAsking Claude to generate a check-in message...\n');
  
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generate a heartbeat check-in message.' }],
  });
  
  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';
  
  console.log('Claude says:', messageText);
  console.log('\nSending notification...\n');
  
  await sendNotification(messageText.trim());
  
  console.log('\nDone! Check your notification center.');
}

main().catch(console.error);
