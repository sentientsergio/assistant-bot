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

const client = new Anthropic();

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

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
}

export async function chat(
  userMessage: string,
  context: WorkspaceContext,
  workspacePath: string,
  onDelta: StreamCallback
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let fullResponse = '';

  // Loop to handle tool calls
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: context.systemPrompt,
      messages,
      tools: [...getToolDefinitions(), ...getWebToolDefinitions()],
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
      toolInput = JSON.parse(toolUse.input) as ToolInput;
    } catch (parseErr) {
      console.error('Failed to parse tool input JSON:', toolUse.input);
      throw new Error(`Tool call failed: incomplete or malformed JSON input for ${toolUse.name}`);
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
 */
export async function simpleChat(
  userMessage: string,
  systemPrompt: string
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}
