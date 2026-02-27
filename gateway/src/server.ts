/**
 * WebSocket Server — v2
 *
 * Handles CLI client connections. Uses the unified conversation state
 * and streaming chat for real-time text deltas.
 */

import { WebSocketServer, WebSocket } from 'ws';
import {
  Request,
  Response,
  Event,
  ConnectPayload,
  AgentPayload,
  HealthPayload,
  StatusPayload,
  createResponse,
  createErrorResponse,
  createEvent,
  isRequest,
  parseMessage,
  generateId,
} from './protocol.js';
import { chatStreaming } from './claude.js';
import {
  appendUserMessage,
  enqueueTurn,
} from './conversation-state.js';
import { addMessage } from './conversation.js';

const VERSION = '0.2.0';

interface Session {
  id: string;
  ws: WebSocket;
  connected: boolean;
  lastActivity: Date;
}

const sessions = new Map<WebSocket, Session>();
let startTime = Date.now();

export function createServer(port: number, workspacePath: string): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (data) => {
      const message = parseMessage(data.toString());

      if (!isRequest(message)) {
        const errorResponse = createErrorResponse(
          'unknown',
          'INVALID_REQUEST',
          'Invalid request format'
        );
        ws.send(JSON.stringify(errorResponse));
        return;
      }

      try {
        await handleRequest(ws, message, workspacePath);
      } catch (err) {
        console.error('Error handling request:', err);
        const errorResponse = createErrorResponse(
          message.id,
          'INTERNAL_ERROR',
          err instanceof Error ? err.message : 'Unknown error'
        );
        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
      sessions.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      sessions.delete(ws);
    });
  });

  wss.on('listening', () => {
    startTime = Date.now();
    console.log(`WebSocket server listening on port ${port}`);
  });

  return wss;
}

async function handleRequest(
  ws: WebSocket,
  request: Request,
  workspacePath: string
): Promise<void> {
  switch (request.method) {
    case 'connect':
      handleConnect(ws, request.id);
      break;
    case 'agent':
      await handleAgent(ws, request.id, request.params.message, workspacePath);
      break;
    case 'health':
      handleHealth(ws, request.id);
      break;
    case 'status':
      handleStatus(ws, request.id);
      break;
    default: {
      const unknownRequest = request as { id: string; method: string };
      const response = createErrorResponse(
        unknownRequest.id,
        'UNKNOWN_METHOD',
        `Unknown method: ${unknownRequest.method}`
      );
      ws.send(JSON.stringify(response));
    }
  }
}

function handleConnect(ws: WebSocket, requestId: string): void {
  const sessionId = generateId();

  sessions.set(ws, {
    id: sessionId,
    ws,
    connected: true,
    lastActivity: new Date(),
  });

  const response = createResponse<ConnectPayload>(requestId, {
    sessionId,
    serverVersion: VERSION,
  });

  ws.send(JSON.stringify(response));
  console.log(`Session created: ${sessionId}`);
}

async function handleAgent(
  ws: WebSocket,
  requestId: string,
  message: string,
  workspacePath: string
): Promise<void> {
  const session = sessions.get(ws);
  if (!session?.connected) {
    const response = createErrorResponse(
      requestId,
      'NOT_CONNECTED',
      'Must call connect first'
    );
    ws.send(JSON.stringify(response));
    return;
  }

  session.lastActivity = new Date();
  const runId = generateId();

  const ackResponse = createResponse<AgentPayload>(requestId, {
    runId,
    status: 'accepted',
  });
  ws.send(JSON.stringify(ackResponse));

  try {
    const result = await enqueueTurn(async () => {
      appendUserMessage(message);

      return await chatStreaming(workspacePath, (delta) => {
        const event = createEvent('agent', { runId, delta });
        ws.send(JSON.stringify(event));
      });
    });

    // Log to messages.json for heartbeat and history
    await addMessage(workspacePath, 'cli', 'user', message);
    await addMessage(workspacePath, 'cli', 'assistant', result.text);

    const doneEvent = createEvent('agent', {
      runId,
      content: result.text,
      done: true,
    });
    ws.send(JSON.stringify(doneEvent));

  } catch (err) {
    console.error('Agent error:', err);
    const errorEvent = createEvent('agent', {
      runId,
      content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      done: true,
    });
    ws.send(JSON.stringify(errorEvent));
  }
}

function handleHealth(ws: WebSocket, requestId: string): void {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const response = createResponse<HealthPayload>(requestId, {
    status: 'ok',
    uptime,
    version: VERSION,
  });

  ws.send(JSON.stringify(response));
}

function handleStatus(ws: WebSocket, requestId: string): void {
  const session = sessions.get(ws);

  const response = createResponse<StatusPayload>(requestId, {
    connected: session?.connected ?? false,
    sessionId: session?.id ?? null,
    lastActivity: session?.lastActivity?.toISOString() ?? null,
  });

  ws.send(JSON.stringify(response));
}

export function broadcast(event: Event): void {
  const message = JSON.stringify(event);
  sessions.forEach((session) => {
    if (session.connected && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(message);
    }
  });
}
