#!/usr/bin/env node
/**
 * Dry-run self-awareness pass
 * 
 * Runs the self-awareness prompt with Opus in read-only mode.
 * Reads all workspace files and conversation history, reflects,
 * but does NOT write anything. Shows what tonight's pass would produce.
 * 
 * Usage: node scripts/test-self-awareness.js
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.prod') });

const { triggerSelfAwarenessDryRun } = await import('../dist/heartbeat.js');

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';

console.log('');
console.log('Self-Awareness Dry Run');
console.log('======================');
console.log(`Workspace: ${WORKSPACE_PATH}`);
console.log('Model: Opus (read-only)');
console.log('');
console.log('Running...');
console.log('');

const result = await triggerSelfAwarenessDryRun(WORKSPACE_PATH);

console.log('');
console.log('--- REFLECTION ---');
console.log('');
console.log(result);
console.log('');
console.log('--- END ---');
console.log('');
console.log('(No files were written. This was a dry run.)');
