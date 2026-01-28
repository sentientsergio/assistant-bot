/**
 * Google Calendar Tools
 * 
 * Provides calendar read/write capabilities and webhook handling.
 * 
 * Setup required:
 * 1. Create Google Cloud project
 * 2. Enable Google Calendar API
 * 3. Create OAuth 2.0 credentials (Desktop app)
 * 4. Set environment variables:
 *    - GOOGLE_CLIENT_ID
 *    - GOOGLE_CLIENT_SECRET
 *    - GOOGLE_REFRESH_TOKEN (obtained via OAuth flow)
 */

import { registerWebhookHandler, WebhookEvent } from '../webhook.js';
import { sendToOwner } from '../channels/telegram.js';

// Environment config
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

// Cached access token
let accessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get a valid access token, refreshing if needed
 */
async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  }
  
  // Return cached token if still valid
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }
  
  // Refresh the token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status}`);
  }
  
  const data = await response.json() as TokenResponse;
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  
  return accessToken;
}

/**
 * List upcoming calendar events
 */
export async function listEvents(
  maxResults: number = 10,
  timeMin?: string
): Promise<string> {
  const token = await getAccessToken();
  
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    orderBy: 'startTime',
    singleEvents: 'true',
    timeMin: timeMin || new Date().toISOString(),
  });
  
  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  if (!response.ok) {
    throw new Error(`Calendar API error: ${response.status}`);
  }
  
  const data = await response.json() as { items: CalendarEvent[] };
  const events = data.items || [];
  
  if (events.length === 0) {
    return 'No upcoming events found.';
  }
  
  return events.map((event) => {
    const start = event.start.dateTime || event.start.date || 'unknown';
    const time = new Date(start).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `- ${time}: ${event.summary}${event.location ? ` (${event.location})` : ''}`;
  }).join('\n');
}

/**
 * Get details for a specific event
 */
export async function getEvent(eventId: string): Promise<string> {
  const token = await getAccessToken();
  
  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  if (!response.ok) {
    throw new Error(`Calendar API error: ${response.status}`);
  }
  
  const event = await response.json() as CalendarEvent;
  const start = event.start.dateTime || event.start.date || 'unknown';
  const end = event.end.dateTime || event.end.date || 'unknown';
  
  return `Event: ${event.summary}
Start: ${new Date(start).toLocaleString()}
End: ${new Date(end).toLocaleString()}
${event.location ? `Location: ${event.location}` : ''}
${event.description ? `Description: ${event.description}` : ''}`.trim();
}

/**
 * Create a new calendar event
 */
export async function createEvent(
  summary: string,
  startTime: string,
  endTime: string,
  description?: string,
  location?: string
): Promise<string> {
  const token = await getAccessToken();
  
  const event = {
    summary,
    description,
    location,
    start: { dateTime: startTime, timeZone: 'America/New_York' },
    end: { dateTime: endTime, timeZone: 'America/New_York' },
  };
  
  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );
  
  if (!response.ok) {
    throw new Error(`Calendar API error: ${response.status}`);
  }
  
  const created = await response.json() as CalendarEvent;
  return `Created event: ${created.summary} (ID: ${created.id})`;
}

/**
 * Tool definitions for Claude
 */
export function getCalendarToolDefinitions() {
  return [
    {
      name: 'calendar_list_events',
      description: 'List upcoming events from Google Calendar. Returns the next N events starting from now.',
      input_schema: {
        type: 'object' as const,
        properties: {
          max_results: {
            type: 'number',
            description: 'Maximum number of events to return (default: 10)',
          },
        },
        required: [],
      },
    },
    {
      name: 'calendar_create_event',
      description: 'Create a new event on Google Calendar.',
      input_schema: {
        type: 'object' as const,
        properties: {
          summary: {
            type: 'string',
            description: 'Event title',
          },
          start_time: {
            type: 'string',
            description: 'Start time in ISO 8601 format (e.g., 2026-01-28T14:00:00)',
          },
          end_time: {
            type: 'string',
            description: 'End time in ISO 8601 format',
          },
          description: {
            type: 'string',
            description: 'Event description (optional)',
          },
          location: {
            type: 'string',
            description: 'Event location (optional)',
          },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  ];
}

/**
 * Check if calendar is configured
 */
export function isCalendarConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

/**
 * Handle calendar webhook events (push notifications from Google)
 */
export function registerCalendarWebhookHandler(): void {
  registerWebhookHandler('calendar', async (event: WebhookEvent) => {
    // Google Calendar sends a sync token and resource state
    const payload = event.payload as Record<string, unknown>;
    const resourceState = payload['X-Goog-Resource-State'] || payload.resourceState;
    
    console.log(`[calendar] Webhook received: ${resourceState}`);
    
    // On change, fetch upcoming events and notify if something is soon
    if (resourceState === 'exists' || resourceState === 'update') {
      try {
        // Check for events in the next hour
        const soon = new Date();
        soon.setHours(soon.getHours() + 1);
        
        const events = await listEvents(3);
        
        // For now, just log - we could parse and send targeted notifications
        console.log(`[calendar] Upcoming events:\n${events}`);
        
        // Optionally notify about imminent events
        // await sendToOwner(`📅 Calendar update:\n${events}`);
      } catch (err) {
        console.error('[calendar] Failed to fetch events after webhook:', err);
      }
    }
  });
}
