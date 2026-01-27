#!/usr/bin/env node
/**
 * Quick test to verify WebSocket connection to gateway
 */

import WebSocket from 'ws';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

async function test() {
  console.log(`Connecting to ${GATEWAY_URL}...`);
  
  const ws = new WebSocket(GATEWAY_URL);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 5000);
    
    ws.on('open', () => {
      console.log('Connected!');
      
      // Send connect request
      const request = {
        type: 'req',
        id: 'test-1',
        method: 'connect',
        params: {}
      };
      
      console.log('Sending connect request...');
      ws.send(JSON.stringify(request));
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      console.log('Received:', JSON.stringify(message, null, 2));
      
      if (message.type === 'res' && message.id === 'test-1') {
        clearTimeout(timeout);
        
        if (message.ok) {
          console.log('\n✓ Connection successful!');
          console.log(`  Session ID: ${message.payload.sessionId}`);
          console.log(`  Server Version: ${message.payload.serverVersion}`);
          
          // Test health endpoint
          const healthRequest = {
            type: 'req',
            id: 'test-2',
            method: 'health'
          };
          ws.send(JSON.stringify(healthRequest));
        } else {
          console.log('\n✗ Connection failed:', message.error);
          ws.close();
          resolve(false);
        }
      } else if (message.type === 'res' && message.id === 'test-2') {
        console.log('\n✓ Health check passed!');
        console.log(`  Status: ${message.payload.status}`);
        console.log(`  Uptime: ${message.payload.uptime}s`);
        ws.close();
        resolve(true);
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', err.message);
      reject(err);
    });
    
    ws.on('close', () => {
      console.log('Connection closed');
    });
  });
}

test()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });
