import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexEvents } from '../electron/codex-events';
import { mergeAgentEvent, type AgentEvent } from '../src/shared/agent-event';
import { runCodex } from '../electron/codex-runner';

test('call lifecycle updates one entry, keeps command/arguments, and distinguishes failure and messages', () => {
  const events: AgentEvent[] = [];
  const stream = new CodexEvents(event => mergeAgentEvent(events, event));
  stream.accept({ type: 'item.started', item: { id: '1', type: 'command_execution', command: 'node check.js', status: 'in_progress' } });
  const startedAt = events[0].startedAt;
  stream.accept({ type: 'item.updated', item: { id: '1', aggregated_output: '检查中' } });
  stream.accept({ type: 'item.completed', item: { id: '1', aggregated_output: '缺少文件', exit_code: 1 } });
  assert.equal(events.length, 1);
  assert.equal(events[0].startedAt, startedAt);
  assert.equal(events[0].status, 'failed');
  assert.match(events[0].detail, /node check.js/);
  assert.match(events[0].detail, /缺少文件/);
  stream.accept({ type: 'item.completed', item: { id: '2', type: 'agent_message', text: '需要补齐配置' } });
  assert.equal(events[1].kind, 'message');
  assert.equal(events[1].detail, '需要补齐配置');
  const secondRun = new CodexEvents(event => mergeAgentEvent(events, event));
  secondRun.accept({ type: 'item.completed', item: { id: '1', type: 'web_search', query: '官方图标' } });
  assert.equal(events.length, 3);
});

test('MCP calls show arguments, results, errors and redact credentials before persistence', () => {
  const events: AgentEvent[] = [];
  const stream = new CodexEvents(event => mergeAgentEvent(events, event));
  stream.accept({ type: 'item.started', item: { id: 'm', type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: { query: '索引', api_key: 'sensitive-value' } } });
  stream.accept({ type: 'item.completed', item: { id: 'm', result: { content: [{ type: 'text', text: '匹配结果' }] }, error: { message: 'Bearer secret-token' } } });
  assert.equal(events[0].title, 'docs / search');
  assert.equal(events[0].status, 'failed');
  assert.match(events[0].detail, /索引/); assert.match(events[0].detail, /匹配结果/);
  assert.doesNotMatch(events[0].detail, /sensitive-value|secret-token/);
  const args = events[0].sections!.find(section => section.label === '调用参数')!;
  assert.deepEqual(JSON.parse(args.content), { query: '索引', api_key: '[redacted]' });
  assert.equal(events[0].sections!.find(section => section.label === '执行结果')!.content, '匹配结果');
  assert.doesNotMatch(JSON.stringify(events[0].sections), /sensitive-value|secret-token/);
});

test('runner consumes fragmented UTF-8 JSONL, final frame without newline, stderr, and structured result', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-cli-'));
  try {
    const script = path.join(directory, 'fake-codex.cjs');
    await writeFile(script, `#!/usr/bin/env node\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ ok: true }));
const line = Buffer.from(JSON.stringify({type:'item.completed',item:{id:'m',type:'agent_message',text:'正在阅读中文文档'}})+'\\n');
const cut = line.indexOf(Buffer.from('中')) + 1;
process.stdout.write(line.subarray(0, cut));
setTimeout(() => {process.stdout.write(line.subarray(cut)); process.stderr.write('diagnostic: api_key=secret-value'); process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'c',type:'command_execution',command:'read input.json',aggregated_output:'读取完成',exit_code:0}}));}, 10);
`);
    await chmod(script, 0o755);
    let executable = script;
    if (process.platform === 'win32') { executable = path.join(directory, 'fake-codex.cmd'); await writeFile(executable, `@"${process.execPath}" "${script}" %*\r\n`); }
    const events: AgentEvent[] = [], logs: string[] = [];
    const result = await runCodex({ directory, executable, model: '', prompt: 'test', schema: { type: 'object' }, signal: new AbortController().signal, event: event => events.push(event), log: line => logs.push(line) });
    assert.deepEqual(result, { ok: true });
    assert.equal(events[0].detail, '正在阅读中文文档');
    assert.equal(events[1].kind, 'call'); assert.match(events[1].detail, /读取完成/);
    assert.match(logs.join('\n'), /diagnostic/); assert.doesNotMatch(logs.join('\n'), /secret-value/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
