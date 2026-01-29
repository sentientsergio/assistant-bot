/**
 * Telegram Channel
 * 
 * Connects the gateway to Telegram via grammY.
 * Only responds to messages from the configured owner user ID.
 */

import { Bot, Context } from 'grammy';
import { chatWithThinking, ChatResult } from '../claude.js';
import { loadWorkspaceContext } from '../workspace.js';
import { 
  loadConversation, 
  addMessage, 
  formatHistoryForPrompt,
  hasRecentActivity,
  getMinutesSinceLastActivity,
} from '../conversation.js';
import { storeExchange, getRelevantMemories, isInitialized as isMemoryInitialized } from '../memory/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

let bot: Bot | null = null;
let ownerChatId: number | null = null;

interface TelegramConfig {
  token: string;
  ownerId: number;
  workspacePath: string;
}

/**
 * Get the show_thinking preference from status.json
 */
async function getShowThinking(workspacePath: string): Promise<boolean> {
  try {
    const statusPath = path.join(workspacePath, 'status.json');
    const content = await fs.readFile(statusPath, 'utf-8');
    const status = JSON.parse(content);
    return status.preferences?.show_thinking ?? false;
  } catch {
    return false;
  }
}

/**
 * Set the show_thinking preference in status.json
 */
async function setShowThinking(workspacePath: string, value: boolean): Promise<void> {
  const statusPath = path.join(workspacePath, 'status.json');
  const content = await fs.readFile(statusPath, 'utf-8');
  const status = JSON.parse(content);
  
  if (!status.preferences) {
    status.preferences = {};
  }
  status.preferences.show_thinking = value;
  
  await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
  console.log(`[telegram] Set show_thinking to ${value}`);
}

/**
 * Check if a message is a thinking toggle command
 * Returns: 'show', 'hide', or null
 */
function parseThinkingCommand(message: string): 'show' | 'hide' | null {
  const lower = message.toLowerCase().trim();
  
  // Natural language patterns
  if (lower.match(/\b(show|enable|turn on)\b.*thinking/i)) {
    return 'show';
  }
  if (lower.match(/\b(hide|disable|turn off)\b.*thinking/i)) {
    return 'hide';
  }
  
  return null;
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

    // Check for thinking toggle commands first
    const thinkingCommand = parseThinkingCommand(userMessage);
    if (thinkingCommand) {
      const newValue = thinkingCommand === 'show';
      await setShowThinking(workspacePath, newValue);
      await ctx.reply(
        newValue 
          ? "🧠 Thinking mode enabled. I'll show you my reasoning process."
          : "🧠 Thinking mode disabled. I'll just show you my responses."
      );
      return;
    }

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    try {
      // Load workspace context (pass channel for cross-channel awareness)
      const workspaceContext = await loadWorkspaceContext(workspacePath, 'telegram');
      
      // Load conversation history and add to context
      const history = await loadConversation(workspacePath, 'telegram');
      const historyPrompt = formatHistoryForPrompt(history);
      
      if (historyPrompt) {
        workspaceContext.systemPrompt += '\n\n' + historyPrompt;
        console.log(`[telegram] Loaded ${history.messages.length} messages from conversation history`);
      }
      
      // Retrieve relevant memories from vector store (WARM tier)
      if (isMemoryInitialized()) {
        const hotContent = history.messages.map(m => m.content);
        const memories = await getRelevantMemories(userMessage, hotContent);
        if (memories) {
          workspaceContext.systemPrompt += '\n\n' + memories;
          console.log(`[telegram] Added memories to context`);
        }
      }
      
      // Save user message to history
      await addMessage(workspacePath, 'telegram', 'user', userMessage);
      
      // Get response with extended thinking
      const result: ChatResult = await chatWithThinking(
        userMessage, 
        workspaceContext, 
        workspacePath
      );
      
      // Check if we should show thinking
      const showThinking = await getShowThinking(workspacePath);
      
      // Format response based on preference
      let fullResponse: string;
      if (showThinking && result.thinking) {
        fullResponse = `<thinking>\n${result.thinking}\n</thinking>\n\n${result.text}`;
      } else {
        fullResponse = result.text;
      }
      
      // Save assistant response to history (just the text, not thinking)
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);
      
      // Store exchange in memory (for future retrieval)
      if (isMemoryInitialized()) {
        storeExchange(userMessage, result.text, 'telegram').catch(err => {
          console.error('[telegram] Failed to store exchange in memory:', err);
        });
      }

      // Send response (split if too long)
      await sendLongMessage(ctx, fullResponse);
      
      console.log(`[telegram] Sent response (${fullResponse.length} chars, thinking: ${showThinking})`);
      
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

  // Handle document attachments
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const caption = ctx.message.caption || '';
    
    console.log(`[telegram] Received document: ${doc.file_name} (${doc.mime_type})`);
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    try {
      // Load workspace context
      const workspaceContext = await loadWorkspaceContext(workspacePath, 'telegram');
      const history = await loadConversation(workspacePath, 'telegram');
      const historyPrompt = formatHistoryForPrompt(history);
      
      if (historyPrompt) {
        workspaceContext.systemPrompt += '\n\n' + historyPrompt;
      }
      
      // Build message describing the attachment
      const userMessage = caption 
        ? `[Attached document: ${doc.file_name} (${doc.mime_type})]\n\n${caption}`
        : `[Attached document: ${doc.file_name} (${doc.mime_type})]\n\n(User shared this document without additional text. Acknowledge receipt and ask if they want to discuss it, or note that you cannot yet read document contents directly.)`;
      
      // Save to history
      await addMessage(workspacePath, 'telegram', 'user', userMessage);
      
      // Get response
      const result: ChatResult = await chatWithThinking(
        userMessage, 
        workspaceContext, 
        workspacePath
      );
      
      // Save response and send
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);
      
      const showThinking = await getShowThinking(workspacePath);
      const fullResponse = showThinking && result.thinking 
        ? `<thinking>\n${result.thinking}\n</thinking>\n\n${result.text}`
        : result.text;
      
      await sendLongMessage(ctx, fullResponse);
      console.log(`[telegram] Responded to document (${fullResponse.length} chars)`);
      
    } catch (err) {
      console.error('[telegram] Error handling document:', err);
      await ctx.reply('Sorry, I encountered an error processing that document. Please try again.');
    }
  });

  // Handle photo attachments
  bot.on('message:photo', async (ctx) => {
    const caption = ctx.message.caption || '';
    
    console.log(`[telegram] Received photo`);
    
    await ctx.replyWithChatAction('typing');
    
    try {
      const workspaceContext = await loadWorkspaceContext(workspacePath, 'telegram');
      const history = await loadConversation(workspacePath, 'telegram');
      const historyPrompt = formatHistoryForPrompt(history);
      
      if (historyPrompt) {
        workspaceContext.systemPrompt += '\n\n' + historyPrompt;
      }
      
      const userMessage = caption 
        ? `[Attached photo]\n\n${caption}`
        : `[Attached photo]\n\n(User shared a photo without additional text. Acknowledge receipt. Note that you cannot yet see image contents directly.)`;
      
      await addMessage(workspacePath, 'telegram', 'user', userMessage);
      
      const result: ChatResult = await chatWithThinking(
        userMessage, 
        workspaceContext, 
        workspacePath
      );
      
      await addMessage(workspacePath, 'telegram', 'assistant', result.text);
      
      const showThinking = await getShowThinking(workspacePath);
      const fullResponse = showThinking && result.thinking 
        ? `<thinking>\n${result.thinking}\n</thinking>\n\n${result.text}`
        : result.text;
      
      await sendLongMessage(ctx, fullResponse);
      console.log(`[telegram] Responded to photo (${fullResponse.length} chars)`);
      
    } catch (err) {
      console.error('[telegram] Error handling photo:', err);
      await ctx.reply('Sorry, I encountered an error processing that photo. Please try again.');
    }
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
