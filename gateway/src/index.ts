/**
 * Gateway entry point
 * Starts the WebSocket server, Telegram bot, and heartbeat scheduler
 * 
 * Environment:
 *   NODE_ENV=development  → loads .env.dev (Claire.dev)
 *   NODE_ENV=production   → loads .env.prod (Claire.prod)
 *   (unset)               → loads .env (legacy, defaults to prod-like)
 */

// IMPORTANT: env.ts must be imported FIRST to load environment variables
// before any other modules read from process.env
import { NODE_ENV, ENV_LABEL } from './env.js';

import { createServer } from './server.js';
import { startHeartbeat } from './heartbeat.js';
import { startTelegram, stopTelegram } from './channels/telegram.js';
import { initScheduledHeartbeats } from './scheduled-heartbeats.js';
import { startWebhookServer, registerDefaultHandler } from './webhook.js';
import { initMemoryStore, initFactsStore } from './memory/index.js';

const PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

async function main() {
  console.log(`Starting assistant-bot gateway [${ENV_LABEL}]...`);
  console.log(`  Environment: ${NODE_ENV}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_PATH}`);

  // Initialize memory store (vector chunks)
  try {
    await initMemoryStore(WORKSPACE_PATH);
    console.log('  Memory: initialized');
  } catch (err) {
    console.error('  Memory: failed to initialize', err);
    // Continue without memory - graceful degradation
  }

  // Initialize facts store
  try {
    await initFactsStore(WORKSPACE_PATH);
    console.log('  Facts: initialized');
  } catch (err) {
    console.error('  Facts: failed to initialize', err);
    // Continue without facts - graceful degradation
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
