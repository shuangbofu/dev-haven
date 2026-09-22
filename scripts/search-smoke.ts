import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { memoryConfigSchema } from '../src/shared/memory';
import { SearchWorkerClient } from '../electron/search-worker-client';
import { GlobalSearch } from '../electron/search';
async function main() {
const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-search-smoke-'));
const worker = new SearchWorkerClient(path.resolve('dist-electron'));
const mcp = new Client({ name: 'devhaven-verification', version: '1.0.0' });
try {
  const docs = path.join(root, 'docs'), memory = path.join(root, 'memory'); await mkdir(docs); await mkdir(memory);
  const config = memoryConfigSchema.parse({ version: 1, initialized: true, directory: memory, reportsDirectory: path.join(root, 'reports'), sources: [{ id: randomUUID(), kind: 'knowledge', name: '测试资料', directory: docs, scan: true, excludes: [] }], agent: { executable: 'codex', model: '' }, autoScan: false, scanIntervalMinutes: 30 });
  await Promise.all(Array.from({ length: 400 }, (_, index) => writeFile(path.join(docs, `guide-${index}.md`), `# 文档 ${index}\n${'背景信息 '.repeat(800)}\n${index === 215 ? '目标关键词' : '普通内容'}`)));
  await writeFile(path.join(memory, 'config.json'), JSON.stringify(config)); await writeFile(path.join(memory, 'state.json'), JSON.stringify({ entities: [] }));
  const old = new GlobalSearch(); const start = performance.now();
  assert.equal((await old.search({ query: '目标关键词' }, config, [])).total, 1);
  const crawlMs = performance.now() - start;
  await worker.rebuild(config, []);
  const times = [];
  for (let i = 0; i < 10; i++) { const start = performance.now(); assert.equal((await worker.search({ query: '目标关键词' }, config)).total, 1); times.push(performance.now() - start); }
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist-electron/memory-client.cjs'), 'mcp', '--memory-dir', memory] }));
  const tools = await mcp.listTools(); assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['devhaven_context', 'devhaven_search', 'devhaven_search_status']);
  const response = await mcp.callTool({ name: 'devhaven_search', arguments: { query: '目标关键词' } });
  assert.equal(response.isError, undefined);
  const results = JSON.parse((response.content as { text: string }[])[0].text);
  assert.equal(results.total, 1); assert.equal(results.items[0].path, 'guide-215.md');
  assert.ok(results.indexedAt);
  console.log(JSON.stringify({ documents: 400, crawlMs: Math.round(crawlMs), indexedMedianMs: Number(times.sort((a, b) => a - b)[5].toFixed(2)), mcp: 'initialize/listTools/callTool passed' }));
} finally { await mcp.close(); worker.dispose(); await rm(root, { recursive: true, force: true }); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
