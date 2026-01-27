#!/usr/bin/env node
/**
 * Test the full chat loop: CLI -> Gateway -> Claude -> response
 */

import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

async function test() {
  console.log('Testing full chat loop...\n');
  console.log(`Connecting to ${GATEWAY_URL}...`);
  
  const ws = new WebSocket(GATEWAY_URL);
  let sessionId = null;
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Test timeout'));
    }, 60000); // 60 second timeout for Claude response
    
    ws.on('open', () => {
      console.log('Connected!\n');
      
      // Send connect request
      const connectRequest = {
        type: 'req',
        id: 'connect-1',
        method: 'connect',
        params: {}
      };
      ws.send(JSON.stringify(connectRequest));
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      // Handle connect response
      if (message.type === 'res' && message.id === 'connect-1') {
        if (message.ok) {
          sessionId = message.payload.sessionId;
          console.log(`Session: ${sessionId}\n`);
          
          // Send a test message
          const testMessage = "Hello! Can you tell me who you are and who I am, based on what you know from your workspace files?";
          console.log(`Sending: "${testMessage}"\n`);
          console.log('Response:');
          console.log('─'.repeat(50));
          
          const agentRequest = {
            type: 'req',
            id: 'agent-1',
            method: 'agent',
            params: { message: testMessage }
          };
          ws.send(JSON.stringify(agentRequest));
        } else {
          clearTimeout(timeout);
          console.error('Connect failed:', message.error);
          ws.close();
          reject(new Error('Connect failed'));
        }
      }
      
      // Handle agent response (acknowledgment)
      if (message.type === 'res' && message.id === 'agent-1') {
        // Just an ack, streaming will come via events
      }
      
      // Handle streaming events
      if (message.type === 'event' && message.event === 'agent') {
        if (message.payload.delta) {
          process.stdout.write(message.payload.delta);
        }
        
        if (message.payload.done) {
          clearTimeout(timeout);
          console.log('\n' + '─'.repeat(50));
          console.log('\n✓ Full chat loop successful!');
          ws.close();
          resolve(true);
        }
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', err.message);
      reject(err);
    });
    
    ws.on('close', () => {
      console.log('\nConnection closed');
    });
  });
}

test()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nTest failed:', err.message);
    process.exit(1);
  });
