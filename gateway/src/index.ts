/**
 * Gateway entry point
 * Starts the WebSocket server, Telegram bot, and heartbeat scheduler
 */

import 'dotenv/config';
import { createServer } from './server.js';
import { startHeartbeat } from './heartbeat.js';
import { startTelegram, stopTelegram } from './channels/telegram.js';
import { initScheduledHeartbeats } from './scheduled-heartbeats.js';
import { startWebhookServer, registerDefaultHandler } from './webhook.js';
import { initMemoryStore } from './memory/index.js';

const PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

async function main() {
  console.log('Starting assistant-bot gateway...');
  console.log(`  Port: ${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_PATH}`);

  // Initialize memory store
  try {
    await initMemoryStore(WORKSPACE_PATH);
    console.log('  Memory: initialized');
  } catch (err) {
    console.error('  Memory: failed to initialize', err);
    // Continue without memory - graceful degradation
  }

  // Start WebSocket server
  const server = createServer(PORT, WORKSPACE_PATH);

  // Start webhook HTTP server
  startWebhookServer();
  registerDefaultHandler(); // Enable test webhook → Telegram

  // Start Telegram bot if configured
  if (TELEGRAM_TOKEN && TELEGRAM_OWNER_ID) {
    console.log(`  Telegram: enabled (owner: ${TELEGRAM_OWNER_ID})`);
    await startTelegram({
      token: TELEGRAM_TOKEN,
      ownerId: parseInt(TELEGRAM_OWNER_ID, 10),
      workspacePath: WORKSPACE_PATH,
    });
  } else {
    console.log('  Telegram: disabled (no token or owner ID)');
  }

  // Initialize scheduled heartbeats (one-off and recurring)
  await initScheduledHeartbeats(WORKSPACE_PATH);

  // Start heartbeat scheduler (regular cadence)
  startHeartbeat(WORKSPACE_PATH);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopTelegram();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopTelegram();
    server.close();
    process.exit(0);
  });

  console.log('Gateway running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
