/**
 * Telegram Channel
 * 
 * Connects the gateway to Telegram via grammY.
 * Only responds to messages from the configured owner user ID.
 */

import { Bot, Context } from 'grammy';
import { chat } from '../claude.js';
import { loadWorkspaceContext } from '../workspace.js';

let bot: Bot | null = null;
let ownerChatId: number | null = null;

interface TelegramConfig {
  token: string;
  ownerId: number;
  workspacePath: string;
}

/**
 * Start the Telegram bot
 */
export async function startTelegram(config: TelegramConfig): Promise<Bot> {
  const { token, ownerId, workspacePath } = config;
  
  bot = new Bot(token);
  ownerChatId = ownerId;

  // Middleware: only respond to owner
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== ownerId) {
      console.log(`[telegram] Ignoring message from non-owner: ${ctx.from?.id}`);
      return; // Silently ignore
    }
    await next();
  });

  // Handle text messages
  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    console.log(`[telegram] Received: "${userMessage.substring(0, 50)}..."`);

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    try {
      // Load workspace context
      const workspaceContext = await loadWorkspaceContext(workspacePath);
      
      // Collect full response (Telegram doesn't support true streaming)
      let fullResponse = '';
      
      await chat(userMessage, workspaceContext, workspacePath, (delta) => {
        fullResponse += delta;
      });

      // Send response (split if too long)
      await sendLongMessage(ctx, fullResponse);
      
      console.log(`[telegram] Sent response (${fullResponse.length} chars)`);
      
    } catch (err) {
      console.error('[telegram] Error:', err);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  });

  // Handle /start command
  bot.command('start', async (ctx) => {
    await ctx.reply(
      "Hey! I'm your assistant. Just send me a message and I'll respond.\n\n" +
      "I have access to my workspace files, so I know who I am and who you are."
    );
  });

  // Handle /status command
  bot.command('status', async (ctx) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    await ctx.reply(
      `🟢 Online\n` +
      `⏱ Uptime: ${hours}h ${minutes}m\n` +
      `📁 Workspace: connected`
    );
  });

  // Start the bot
  console.log('[telegram] Starting bot...');
  
  // Use long polling
  bot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Bot started: @${botInfo.username}`);
    },
  });

  return bot;
}

/**
 * Send a message that might be longer than Telegram's 4096 char limit
 */
async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  const MAX_LENGTH = 4000; // Leave some buffer
  
  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  // Split on paragraph boundaries if possible
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point
    let splitAt = remaining.lastIndexOf('\n\n', MAX_LENGTH);
    if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
    }
    if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
    }
    if (splitAt === -1) {
      splitAt = MAX_LENGTH;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

/**
 * Send a proactive message to the owner (for heartbeats)
 */
export async function sendToOwner(message: string): Promise<boolean> {
  if (!bot || !ownerChatId) {
    console.error('[telegram] Bot not initialized or owner ID not set');
    return false;
  }

  try {
    await bot.api.sendMessage(ownerChatId, message);
    console.log(`[telegram] Sent proactive message to owner`);
    return true;
  } catch (err) {
    console.error('[telegram] Failed to send to owner:', err);
    return false;
  }
}

/**
 * Stop the Telegram bot
 */
export function stopTelegram(): void {
  if (bot) {
    bot.stop();
    bot = null;
    console.log('[telegram] Bot stopped');
  }
}

/**
 * Check if bot is running
 */
export function isTelegramRunning(): boolean {
  return bot !== null;
}
