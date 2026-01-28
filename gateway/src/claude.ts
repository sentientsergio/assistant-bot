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

const client = new Anthropic();

// Model configuration
const HAIKU_MODEL = 'claude-haiku-4-5';
const SONNET_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 4096;

// Triage prompt for routing decisions
const TRIAGE_PROMPT = `You are a routing assistant. Given a user message, determine if it requires deep reasoning or is straightforward.

COMPLEX (use Sonnet):
- Multi-step analysis or planning
- Nuanced judgment calls
- Complex code review or architecture
- Philosophical or ethical reasoning
- Ambiguous situations requiring careful thought

SIMPLE (use Haiku):
- Greetings, status updates, casual chat
- File operations (read, write, list)
- Straightforward questions with clear answers
- Fetching URLs or looking things up
- Accountability check-ins
- Following clear instructions

Reply with exactly one word: SIMPLE or COMPLEX`;

/**
 * Triage a message to determine which model should handle it
 */
async function triageMessage(userMessage: string): Promise<'haiku' | 'sonnet'> {
  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 10,
      system: TRIAGE_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0]?.type === 'text' 
      ? response.content[0].text.trim().toUpperCase() 
      : '';
    
    return text.includes('COMPLEX') ? 'sonnet' : 'haiku';
  } catch (err) {
    // On triage failure, default to haiku (cheaper, usually sufficient)
    console.error('[triage] Error, defaulting to haiku:', err);
    return 'haiku';
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

export async function chat(
  userMessage: string,
  context: WorkspaceContext,
  workspacePath: string,
  onDelta: StreamCallback
): Promise<string> {
  // Triage to determine which model to use
  const modelChoice = await triageMessage(userMessage);
  const model = modelChoice === 'sonnet' ? SONNET_MODEL : HAIKU_MODEL;
  console.log(`[chat] Routed to ${modelChoice} (${model})`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let fullResponse = '';

  // Loop to handle tool calls
  while (true) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: context.systemPrompt,
      messages,
      tools: [
        ...getToolDefinitions(), 
        ...getWebToolDefinitions(),
        ...(isCalendarConfigured() ? getCalendarToolDefinitions() : []),
      ],
      stream: true,
    });

    let currentText = '';
    let toolUse: { id: string; name: string; input: string } | null = null;
    let inputJson = '';

    for await (const event of response) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          // Starting a text block
        } else if (event.content_block.type === 'tool_use') {
          toolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: '',
          };
          inputJson = '';
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          currentText += event.delta.text;
          fullResponse += event.delta.text;
          onDelta(event.delta.text);
        } else if (event.delta.type === 'input_json_delta') {
          inputJson += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (toolUse) {
          toolUse.input = inputJson;
        }
      } else if (event.type === 'message_stop') {
        // Message complete
      }
    }

    // If no tool was called, we're done
    if (!toolUse) {
      return fullResponse;
    }

    // Execute the tool
    let toolInput: ToolInput;
    try {
      toolInput = JSON.parse(toolUse.input || '{}') as ToolInput;
    } catch (parseErr) {
      // Tool JSON was incomplete/malformed - likely context limit hit
      // Return what we have so far instead of crashing
      console.error('Failed to parse tool input JSON, returning partial response:', toolUse.input);
      if (fullResponse.trim()) {
        return fullResponse;
      }
      return "I tried to do something but hit a limit. Could you try a shorter message or ask again?";
    }
    let toolResult: string;

    try {
      switch (toolUse.name) {
        case 'file_read':
          toolResult = await fileRead(workspacePath, toolInput.path || '');
          break;
        case 'file_write':
          toolResult = await fileWrite(
            workspacePath,
            toolInput.path || '',
            toolInput.content || ''
          );
          break;
        case 'file_list':
          toolResult = await fileList(workspacePath, toolInput.directory || '.');
          break;
        case 'schedule_heartbeat':
          toolResult = await scheduleHeartbeat(
            toolInput.purpose || '',
            toolInput.scheduled_for,
            toolInput.recurring_schedule
          );
          break;
        case 'list_scheduled_heartbeats':
          toolResult = await listHeartbeats();
          break;
        case 'cancel_scheduled_heartbeat':
          toolResult = await cancelHeartbeat(toolInput.id || '');
          break;
        case 'web_fetch':
          toolResult = await webFetch(toolInput.url || '');
          break;
        case 'calendar_list_events':
          toolResult = await listEvents(toolInput.max_results || 10);
          break;
        case 'calendar_create_event':
          toolResult = await createEvent(
            toolInput.summary || '',
            toolInput.start_time || '',
            toolInput.end_time || '',
            toolInput.description,
            toolInput.location
          );
          break;
        default:
          toolResult = `Unknown tool: ${toolUse.name}`;
      }
    } catch (err) {
      toolResult = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }

    // Add assistant's response with tool use to messages
    messages.push({
      role: 'assistant',
      content: [
        ...(currentText ? [{ type: 'text' as const, text: currentText }] : []),
        {
          type: 'tool_use' as const,
          id: toolUse.id,
          name: toolUse.name,
          input: JSON.parse(toolUse.input),
        },
      ],
    });

    // Add tool result
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: toolResult,
        },
      ],
    });

    // Continue the loop to let Claude respond to the tool result
  }
}

/**
 * Simple non-streaming chat for heartbeat checks
 * Uses Haiku by default (heartbeats are simple, cost-sensitive)
 */
export async function simpleChat(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}
