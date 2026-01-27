/**
 * Gateway entry point
 * Starts the WebSocket server, Telegram bot, and heartbeat scheduler
 */

import 'dotenv/config';
import { createServer } from './server.js';
import { startHeartbeat } from './heartbeat.js';
import { startTelegram, stopTelegram } from './channels/telegram.js';

const PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

async function main() {
  console.log('Starting assistant-bot gateway...');
  console.log(`  Port: ${PORT}`);
  console.log(`  Workspace: ${WORKSPACE_PATH}`);

  // Start WebSocket server
  const server = createServer(PORT, WORKSPACE_PATH);

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

  // Start heartbeat scheduler
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
