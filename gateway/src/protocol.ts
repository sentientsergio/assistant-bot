/**
 * Wire Protocol Types
 * 
 * Transport: WebSocket, text frames with JSON payloads
 * 
 * Message types:
 * - req: Client request
 * - res: Server response to a request
 * - event: Server-initiated event (streaming, presence, etc.)
 */

// ============================================================================
// Base Types
// ============================================================================

export interface BaseRequest {
  type: 'req';
  id: string;
  method: string;
}

export interface BaseResponse {
  type: 'res';
  id: string;
  ok: boolean;
}

export interface SuccessResponse<T = unknown> extends BaseResponse {
  ok: true;
  payload: T;
}

export interface ErrorResponse extends BaseResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type Response<T = unknown> = SuccessResponse<T> | ErrorResponse;

export interface BaseEvent {
  type: 'event';
  event: string;
}

// ============================================================================
// Connect
// ============================================================================

export interface ConnectRequest extends BaseRequest {
  method: 'connect';
  params?: {
    clientId?: string;
    clientVersion?: string;
  };
}

export interface ConnectPayload {
  sessionId: string;
  serverVersion: string;
}

// ============================================================================
// Agent (Chat)
// ============================================================================

export interface AgentRequest extends BaseRequest {
  method: 'agent';
  params: {
    message: string;
  };
}

export interface AgentPayload {
  runId: string;
  status: 'accepted' | 'completed' | 'error';
  content?: string;
}

export interface AgentEvent extends BaseEvent {
  event: 'agent';
  payload: {
    runId: string;
    delta?: string;      // Streaming text chunk
    content?: string;    // Full content (on completion)
    done?: boolean;      // True when streaming is complete
  };
}

// ============================================================================
// Health Check
// ============================================================================

export interface HealthRequest extends BaseRequest {
  method: 'health';
}

export interface HealthPayload {
  status: 'ok' | 'degraded';
  uptime: number;
  version: string;
}

// ============================================================================
// Status
// ============================================================================

export interface StatusRequest extends BaseRequest {
  method: 'status';
}

export interface StatusPayload {
  connected: boolean;
  sessionId: string | null;
  lastActivity: string | null;
}

// ============================================================================
// Presence Event
// ============================================================================

export interface PresenceEvent extends BaseEvent {
  event: 'presence';
  payload: {
    status: 'online' | 'busy' | 'away';
  };
}

// ============================================================================
// Tick Event (Heartbeat)
// ============================================================================

export interface TickEvent extends BaseEvent {
  event: 'tick';
  payload: {
    timestamp: string;
  };
}

// ============================================================================
// Union Types
// ============================================================================

export type Request = ConnectRequest | AgentRequest | HealthRequest | StatusRequest;
export type Event = AgentEvent | PresenceEvent | TickEvent;

// ============================================================================
// Helpers
// ============================================================================

export function createResponse<T>(id: string, payload: T): SuccessResponse<T> {
  return {
    type: 'res',
    id,
    ok: true,
    payload,
  };
}

export function createErrorResponse(id: string, code: string, message: string): ErrorResponse {
  return {
    type: 'res',
    id,
    ok: false,
    error: { code, message },
  };
}

export function createEvent<E extends Event['event']>(
  event: E,
  payload: Extract<Event, { event: E }>['payload']
): Extract<Event, { event: E }> {
  return {
    type: 'event',
    event,
    payload,
  } as Extract<Event, { event: E }>;
}

export function isRequest(msg: unknown): msg is Request {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === 'req'
  );
}

export function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
