#!/usr/bin/env npx ts-node
/**
 * Migration Script: Markdown Memories → Vector Store
 * 
 * One-time migration of existing markdown memories into WARM tier.
 * Run after merging feature branch, before going live.
 * 
 * Usage: npx ts-node scripts/migrate-markdown-to-vector.ts
 */

import 'dotenv/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { initMemoryStore, addChunk, getChunkCounts } from '../src/memory/store.js';

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || '../workspace';

interface Section {
  title: string;
  content: string;
  source: string;
}

/**
 * Parse MEMORY.md into sections by ## headings
 */
async function parseMemoryMd(workspacePath: string): Promise<Section[]> {
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  const content = await fs.readFile(memoryPath, 'utf-8');
  
  const sections: Section[] = [];
  const lines = content.split('\n');
  
  let currentTitle = '';
  let currentContent: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Save previous section
      if (currentTitle && currentContent.length > 0) {
        const text = currentContent.join('\n').trim();
        if (text.length > 50) { // Skip very short sections
          sections.push({
            title: currentTitle,
            content: `[${currentTitle}]\n${text}`,
            source: 'MEMORY.md',
          });
        }
      }
      
      currentTitle = line.replace('## ', '').trim();
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }
  
  // Save last section
  if (currentTitle && currentContent.length > 0) {
    const text = currentContent.join('\n').trim();
    if (text.length > 50) {
      sections.push({
        title: currentTitle,
        content: `[${currentTitle}]\n${text}`,
        source: 'MEMORY.md',
      });
    }
  }
  
  return sections;
}

/**
 * Parse daily memory files into chunks
 */
async function parseDailyMemories(workspacePath: string): Promise<Section[]> {
  const memoryDir = path.join(workspacePath, 'memory');
  const sections: Section[] = [];
  
  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== '.gitkeep');
    
    for (const file of mdFiles) {
      const filePath = path.join(memoryDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Skip if too short
      if (content.length < 100) continue;
      
      // Extract date from filename (YYYY-MM-DD.md)
      const date = file.replace('.md', '');
      
      sections.push({
        title: `Daily Memory: ${date}`,
        content: `[Daily notes from ${date}]\n${content}`,
        source: `memory/${file}`,
      });
    }
  } catch (err) {
    console.log('No daily memory files found');
  }
  
  return sections;
}

async function main() {
  console.log('=== Markdown → Vector Migration ===\n');
  console.log(`Workspace: ${WORKSPACE_PATH}\n`);
  
  // Initialize memory store
  console.log('Initializing memory store...');
  await initMemoryStore(WORKSPACE_PATH);
  
  const beforeCounts = await getChunkCounts();
  console.log(`Current chunks: ${beforeCounts.warm} warm, ${beforeCounts.cold} cold\n`);
  
  // Parse MEMORY.md
  console.log('Parsing MEMORY.md...');
  const memorySections = await parseMemoryMd(WORKSPACE_PATH);
  console.log(`  Found ${memorySections.length} sections\n`);
  
  // Parse daily memories
  console.log('Parsing daily memory files...');
  const dailySections = await parseDailyMemories(WORKSPACE_PATH);
  console.log(`  Found ${dailySections.length} daily files\n`);
  
  // Combine all sections
  const allSections = [...memorySections, ...dailySections];
  console.log(`Total sections to migrate: ${allSections.length}\n`);
  
  if (allSections.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }
  
  // Migrate each section
  console.log('Migrating sections...');
  let migrated = 0;
  let failed = 0;
  
  for (const section of allSections) {
    try {
      process.stdout.write(`  ${section.source}: ${section.title.slice(0, 40)}...`);
      await addChunk(section.content, 'markdown-migration', 1, 'warm');
      console.log(' ✓');
      migrated++;
    } catch (err) {
      console.log(' ✗');
      console.error(`    Error: ${err}`);
      failed++;
    }
  }
  
  console.log(`\nMigration complete!`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Failed: ${failed}`);
  
  const afterCounts = await getChunkCounts();
  console.log(`  Total chunks now: ${afterCounts.warm} warm, ${afterCounts.cold} cold`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
