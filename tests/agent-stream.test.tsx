import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTaskStream } from '../src/components/agent-task-stream';

test('main timeline keeps diagnostics and raw payloads behind the diagnostic entry', () => {
  const html = renderToStaticMarkup(<AgentTaskStream task={{ id: 'task', kind: 'scan', status: 'success', createdAt: new Date().toISOString(), logs: ['private-diagnostic-content'], events: [{ id: 'call', kind: 'call', title: '阅读文件', summary: 'input.json', status: 'completed', detail: 'raw-event-payload', sections: [{ label: '输出', format: 'code', content: 'tool-result-body' }], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }} />);
  assert.match(html, /诊断/); assert.match(html, /阅读文件/); assert.match(html, /input.json/);
  assert.doesNotMatch(html, /private-diagnostic-content|raw-event-payload|tool-result-body|<details|任务日志与诊断/);
});
