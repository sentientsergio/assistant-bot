import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('../workspace-dev/memory.lance');
  const table = await db.openTable('chunks');
  
  // Delete test chunks
  await table.delete("content LIKE '%weather in New York%'");
  await table.delete("content LIKE '%coffee shops%'");
  await table.delete("content LIKE '%meeting with John%'");
  
  console.log('Cleaned up test chunks');
  const count = await table.countRows();
  console.log('Remaining chunks:', count);
}

main().catch(console.error);
