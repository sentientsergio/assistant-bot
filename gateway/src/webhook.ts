/**
 * Webhook Server
 * 
 * HTTP server for receiving webhook events from external services
 * (Google Calendar, GitHub, etc.)
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { sendToOwner } from './channels/telegram.js';

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '18790', 10);

export interface WebhookEvent {
  source: string;      // 'calendar', 'github', etc.
  type: string;        // event type specific to source
  payload: unknown;    // raw payload from source
  timestamp: string;   // ISO timestamp
}

type WebhookHandler = (event: WebhookEvent) => Promise<void>;

// Registry of webhook handlers by source
const handlers = new Map<string, WebhookHandler>();

/**
 * Register a handler for a webhook source
 */
export function registerWebhookHandler(source: string, handler: WebhookHandler): void {
  handlers.set(source, handler);
  console.log(`[webhook] Registered handler for: ${source}`);
}

/**
 * Parse request body as JSON
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Handle incoming webhook request
 */
async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Extract source from URL: /webhook/calendar, /webhook/github, etc.
  const url = new URL(req.url || '/', `http://localhost`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  if (pathParts.length < 2 || pathParts[0] !== 'webhook') {
    sendJson(res, 400, { error: 'Invalid webhook path. Use /webhook/{source}' });
    return;
  }
  
  const source = pathParts[1];
  const payload = await parseBody(req);
  
  const event: WebhookEvent = {
    source,
    type: (payload as Record<string, unknown>)?.type as string || 'unknown',
    payload,
    timestamp: new Date().toISOString(),
  };
  
  console.log(`[webhook] Received from ${source}:`, JSON.stringify(event, null, 2));
  
  // Find and execute handler
  const handler = handlers.get(source);
  if (handler) {
    try {
      await handler(event);
      sendJson(res, 200, { status: 'processed', source, type: event.type });
    } catch (err) {
      console.error(`[webhook] Handler error for ${source}:`, err);
      sendJson(res, 500, { error: 'Handler failed', message: err instanceof Error ? err.message : 'Unknown' });
    }
  } else {
    // No handler, but still acknowledge receipt
    console.log(`[webhook] No handler for source: ${source}`);
    sendJson(res, 200, { status: 'received', source, type: event.type, note: 'No handler registered' });
  }
}

/**
 * Start the webhook HTTP server
 */
export function startWebhookServer(): void {
  const server = createHttpServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';
    
    console.log(`[webhook] ${method} ${url}`);
    
    // CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    try {
      // Health check
      if (url === '/health' && method === 'GET') {
        sendJson(res, 200, { status: 'ok', service: 'webhook-server' });
        return;
      }
      
      // Webhook endpoint
      if (url.startsWith('/webhook') && method === 'POST') {
        await handleWebhook(req, res);
        return;
      }
      
      // Not found
      sendJson(res, 404, { error: 'Not found' });
      
    } catch (err) {
      console.error('[webhook] Request error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
  
  server.listen(WEBHOOK_PORT, () => {
    console.log(`Webhook server listening on port ${WEBHOOK_PORT}`);
  });
}

/**
 * Default handler that sends webhook events to Telegram
 * Useful for testing and as a fallback
 */
export function registerDefaultHandler(): void {
  registerWebhookHandler('test', async (event) => {
    const message = `📨 Webhook received:\nSource: ${event.source}\nType: ${event.type}\nTime: ${event.timestamp}`;
    await sendToOwner(message);
  });
}
