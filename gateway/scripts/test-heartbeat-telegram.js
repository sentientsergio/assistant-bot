#!/usr/bin/env node
/**
 * Test heartbeat via Telegram
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { Bot } from 'grammy';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

const client = new Anthropic();
const WORKSPACE_PATH = resolve('../workspace');

async function tryReadFile(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;
  
  if (!token || !ownerId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID');
    process.exit(1);
  }

  console.log('Testing heartbeat via Telegram...\n');
  
  // Load context
  const soul = await tryReadFile(join(WORKSPACE_PATH, 'SOUL.md'));
  const identity = await tryReadFile(join(WORKSPACE_PATH, 'IDENTITY.md'));
  const user = await tryReadFile(join(WORKSPACE_PATH, 'USER.md'));
  const todayMemory = await tryReadFile(join(WORKSPACE_PATH, 'memory/2026-01-27.md'));
  
  console.log('Loaded workspace context');
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  const systemPrompt = `You are performing a heartbeat check - a proactive moment to reach out to your human.

Current time: ${timeStr}

### SOUL.md
${soul || '(not loaded)'}

### IDENTITY.md  
${identity || '(not loaded)'}

### USER.md
${user || '(not loaded)'}

### Today's Memory
${todayMemory || '(none yet)'}

You just got Telegram working! This is exciting - you can now reach Sergio on his phone. 
Send a brief, warm message acknowledging this milestone and maybe check in on something from his accountability goals.

Keep it SHORT (1-3 sentences). Be genuine, not performative.`;

  console.log('Asking Claude to generate check-in message...\n');
  
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Generate a heartbeat check-in message for Telegram.' }],
  });
  
  const messageText = response.content[0].type === 'text' ? response.content[0].text : '';
  
  console.log('Claude says:', messageText);
  console.log('\nSending to Telegram...\n');
  
  // Send via Telegram
  const bot = new Bot(token);
  await bot.api.sendMessage(parseInt(ownerId), messageText.trim());
  
  console.log('Sent! Check your Telegram.');
}

main().catch(console.error);
