import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentContent } from '../src/components/agent-event-content';

test('scan result is rendered as named entries and labelled metadata, not a JSON dump', () => {
  const html = renderToStaticMarkup(<AgentContent section={{ label: '消息', format: 'data', content: JSON.stringify({ entities: [{ name: '个人阅读器', path: 'apps/reader', kind: 'project', description: '支持 **离线阅读**', languages: ['TypeScript'] }], changes: [] }) }} />);
  assert.match(html, /<h4>个人阅读器<\/h4>/);
  assert.match(html, /识别到 1 个项目与知识集合/); assert.match(html, /技术栈/);
  assert.match(html, /<strong>离线阅读<\/strong>/);
  assert.doesNotMatch(html, /&quot;entities&quot;|&quot;description&quot;/);
});

test('personal report renders summaries and details without exposing evidence IDs as prose', () => {
  const html = renderToStaticMarkup(<AgentContent section={{ label: '消息', format: 'markdown', content: JSON.stringify({ items: [{ summary: '完善阅读体验', details: [{ text: '新增目录导航和代码高亮。', evidenceIds: ['internal-evidence-hash'] }] }] }) }} />);
  assert.match(html, /<h4>完善阅读体验<\/h4>/); assert.match(html, /新增目录导航和代码高亮/);
  assert.match(html, /1 条引用/); assert.doesNotMatch(html, /internal-evidence-hash/);
});

test('Markdown messages render formatting and code output remains escaped', () => {
  const html = renderToStaticMarkup(<AgentContent section={{ label: '消息', format: 'markdown', content: '## 扫描进度\n\n- 已读取文档\n- 正在整理' }} />);
  assert.match(html, /<h2>扫描进度<\/h2>/); assert.match(html, /<li>已读取文档<\/li>/);
  const output = renderToStaticMarkup(<AgentContent section={{ label: '输出', format: 'code', content: '<script>alert(1)</script>' }} />);
  assert.doesNotMatch(output, /<script>/); assert.match(output, /&lt;script&gt;/);
});

test('tool results render rows and nested-data controls instead of nested JSON', () => {
  const html = renderToStaticMarkup(<AgentContent section={{ label: '结果', format: 'code', content: JSON.stringify([{ name: '使用指南', path: 'guide.md', metadata: { internal: 'nested-value' } }]) }} />);
  assert.match(html, /<table>/); assert.match(html, /使用指南/); assert.match(html, /1 个字段/);
  assert.doesNotMatch(html, /nested-value|&quot;metadata&quot;|<details/);
});
