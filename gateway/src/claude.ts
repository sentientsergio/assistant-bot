/**
 * Claude API Client
 * 
 * Handles communication with Anthropic's API, including tool calling.
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  fileRead, 
  fileWrite, 
  fileList, 
  getToolDefinitions,
  scheduleHeartbeat,
  listHeartbeats,
  cancelHeartbeat,
} from './tools/files.js';
import { webFetch, getWebToolDefinitions } from './tools/web.js';
import { 
  listEvents, 
  createEvent, 
  getCalendarToolDefinitions, 
  isCalendarConfigured 
} from './tools/calendar.js';

// Lazy initialization - client created on first use (after dotenv loads)
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// Model configuration
const SONNET_MODEL = 'claude-sonnet-4-5';
const OPUS_MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 4096;
const OPUS_MAX_TOKENS = 8192;
const THINKING_BUDGET = 2048; // tokens for extended thinking

// Result type that includes both thinking and text
export interface ChatResult {
  thinking: string;
  text: string;
}

// Triage prompt for thinking decisions
const TRIAGE_PROMPT = `You are a routing assistant. Given a user message, determine if it requires extended thinking.

NEEDS THINKING:
- Multi-step analysis or planning
- Nuanced judgment calls
- Complex code review or architecture
- Philosophical or ethical reasoning
- Ambiguous situations requiring careful thought

NO THINKING NEEDED:
- Greetings, status updates, casual chat
- File operations (read, write, list)
- Straightforward questions with clear answers
- Fetching URLs or looking things up
- Accountability check-ins
- Following clear instructions

Reply with exactly one word: THINKING or SIMPLE`;

/**
 * Triage a message to determine whether extended thinking should be enabled
 */
async function triageThinking(userMessage: string): Promise<boolean> {
  try {
    const response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: 10,
      system: TRIAGE_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0]?.type === 'text' 
      ? response.content[0].text.trim().toUpperCase() 
      : '';
    
    return text.includes('THINKING');
  } catch (err) {
    console.error('[triage] Error, defaulting to no thinking:', err);
    return false;
  }
}

export interface WorkspaceContext {
  systemPrompt: string;
  workspacePath: string;
}

type StreamCallback = (delta: string) => void;

interface ToolInput {
  path?: string;
  directory?: string;
  content?: string;
  purpose?: string;
  scheduled_for?: string;
  recurring_schedule?: string;
  id?: string;
  url?: string;
  // Calendar inputs
  max_results?: number;
  summary?: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  location?: string;
}

/**
 * Execute a tool call and return the result string
 */
async function executeTool(name: string, toolInput: ToolInput, workspacePath: string): Promise<string> {
  switch (name) {
    case 'file_read':
      return await fileRead(workspacePath, toolInput.path || '');
    case 'file_write':
      return await fileWrite(workspacePath, toolInput.path || '', toolInput.content || '');
    case 'file_list':
      return await fileList(workspacePath, toolInput.directory || '.');
    case 'schedule_heartbeat':
      return await scheduleHeartbeat(toolInput.purpose || '', toolInput.scheduled_for, toolInput.recurring_schedule);
    case 'list_scheduled_heartbeats':
      return await listHeartbeats();
    case 'cancel_scheduled_heartbeat':
      return await cancelHeartbeat(toolInput.id || '');
    case 'web_fetch':
      return await webFetch(toolInput.url || '');
    case 'calendar_list_events':
      return await listEvents(toolInput.max_results || 10);
    case 'calendar_create_event':
      return await createEvent(
        toolInput.summary || '', toolInput.start_time || '', toolInput.end_time || '',
        toolInput.description, toolInput.location
      );
    default:
      return `Unknown tool: ${name}`;
  }
}

function getAllTools() {
  return [
    ...getToolDefinitions(),
    ...getWebToolDefinitions(),
    ...(isCalendarConfigured() ? getCalendarToolDefinitions() : []),
  ];
}

export async function chat(
  userMessage: string,
  context: WorkspaceContext,
  workspacePath: string,
  onDelta: StreamCallback
): Promise<string> {
  console.log(`[chat] Using sonnet (${SONNET_MODEL})`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let lastNonEmptyText = ''; // Fallback: keep last non-empty text in case final turn is empty

  // Loop to handle tool calls
  while (true) {
    const response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: context.systemPrompt,
      messages,
      tools: getAllTools(),
      stream: true,
    });

    let currentText = '';
    const toolUses: Array<{ id: string; name: string; input: string }> = [];
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let inputJson = '';

    for await (const event of response) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          if (currentToolUse) {
            currentToolUse.input = inputJson;
            toolUses.push(currentToolUse);
          }
          currentToolUse = { id: event.content_block.id, name: event.content_block.name, input: '' };
          inputJson = '';
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentText += event.delta.text;
          if (toolUses.length === 0 && !currentToolUse) {
            onDelta(event.delta.text);
          }
        } else if (event.delta.type === 'input_json_delta') {
          inputJson += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse && inputJson) {
          currentToolUse.input = inputJson;
        }
      } else if (event.type === 'message_stop') {
        if (currentToolUse) {
          toolUses.push(currentToolUse);
          currentToolUse = null;
        }
      }
    }

    if (currentText.trim()) {
      lastNonEmptyText = currentText;
    }

    if (toolUses.length === 0) {
      return currentText.trim() ? currentText : lastNonEmptyText;
    }

    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    const assistantToolBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: unknown }> = [];
    
    for (const toolUse of toolUses) {
      let toolInput: ToolInput;
      try {
        toolInput = JSON.parse(toolUse.input || '{}') as ToolInput;
      } catch {
        console.error('Failed to parse tool input JSON:', toolUse.input);
        toolResults.push({ tool_use_id: toolUse.id, content: 'Error: Failed to parse tool input' });
        assistantToolBlocks.push({ type: 'tool_use' as const, id: toolUse.id, name: toolUse.name, input: {} });
        continue;
      }
      
      let toolResult: string;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      
      toolResults.push({ tool_use_id: toolUse.id, content: toolResult });
      assistantToolBlocks.push({
        type: 'tool_use' as const, id: toolUse.id, name: toolUse.name,
        input: JSON.parse(toolUse.input || '{}'),
      });
      console.log(`[chat] Tool ${toolUse.name} executed`);
    }

    messages.push({
      role: 'assistant',
      content: [
        ...(currentText ? [{ type: 'text' as const, text: currentText }] : []),
        ...assistantToolBlocks,
      ],
    });

    messages.push({
      role: 'user',
      content: toolResults.map(result => ({
        type: 'tool_result' as const, tool_use_id: result.tool_use_id, content: result.content,
      })),
    });
  }
}

/**
 * Simple non-streaming chat for heartbeat checks
 */
export async function simpleChat(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const response = await getClient().messages.create({
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/**
 * Chat with extended thinking enabled for complex tasks
 * Returns both thinking process and final text separately
 * Uses triage: Sonnet gets extended thinking, Haiku stays fast
 */
export async function chatWithThinking(
  userMessage: string,
  context: WorkspaceContext,
  workspacePath: string
): Promise<ChatResult> {
  const useThinking = await triageThinking(userMessage);
  
  console.log(`[chat] Using sonnet (${SONNET_MODEL})${useThinking ? ` with extended thinking (budget: ${THINKING_BUDGET})` : ''}`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let thinkingContent = '';
  let lastNonEmptyText = ''; // Fallback if final turn has no text

  // Non-streaming for simpler thinking block handling
  while (true) {
    const response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: context.systemPrompt,
      messages,
      tools: getAllTools(),
      ...(useThinking && {
        thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET },
      }),
    });

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    const assistantContent: Anthropic.ContentBlock[] = [];
    let turnText = '';

    for (const block of response.content) {
      if (block.type === 'thinking') {
        thinkingContent += (thinkingContent ? '\n\n' : '') + block.thinking;
      } else if (block.type === 'text') {
        turnText += block.text;
        assistantContent.push(block);
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
        assistantContent.push(block);
      }
    }

    if (toolUses.length === 0) {
      if (thinkingContent) {
        console.log(`[chat] Thinking: ${thinkingContent.slice(0, 100)}...`);
      }
      return { thinking: thinkingContent, text: turnText || lastNonEmptyText };
    }
    
    if (turnText) {
      lastNonEmptyText = turnText;
    }

    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: string;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ tool_use_id: toolUse.id, content: toolResult });
      console.log(`[chat] Tool ${toolUse.name} executed`);
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: toolResults.map(result => ({
        type: 'tool_result' as const, tool_use_id: result.tool_use_id, content: result.content,
      })),
    });
  }
}

/**
 * Non-streaming Opus chat with tool access for nightly reflective tasks.
 * No triage, no thinking mode — Opus reasons internally.
 */
export async function opusChat(
  userMessage: string,
  context: WorkspaceContext,
  workspacePath: string
): Promise<string> {
  console.log(`[chat] Using opus (${OPUS_MODEL})`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let lastNonEmptyText = '';

  while (true) {
    const response = await getClient().messages.create({
      model: OPUS_MODEL,
      max_tokens: OPUS_MAX_TOKENS,
      system: context.systemPrompt,
      messages,
      tools: getAllTools(),
    });

    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    const assistantContent: Anthropic.ContentBlock[] = [];
    let turnText = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        turnText += block.text;
        assistantContent.push(block);
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
        assistantContent.push(block);
      }
    }

    if (turnText.trim()) {
      lastNonEmptyText = turnText;
    }

    if (toolUses.length === 0) {
      return turnText.trim() ? turnText : lastNonEmptyText;
    }

    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    for (const toolUse of toolUses) {
      const toolInput = toolUse.input as ToolInput;
      let toolResult: string;
      try {
        toolResult = await executeTool(toolUse.name, toolInput, workspacePath);
      } catch (err) {
        toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      toolResults.push({ tool_use_id: toolUse.id, content: toolResult });
      console.log(`[opus] Tool ${toolUse.name} executed`);
    }

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const, tool_use_id: r.tool_use_id, content: r.content,
      })),
    });
  }
}
