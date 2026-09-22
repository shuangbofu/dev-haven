import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownHeadings } from '../src/lib/markdown';
import { MarkdownReader } from '../src/components/markdown-reader';

const render = (content: string) => renderToStaticMarkup(createElement(MarkdownReader, { content, title: 'Guide.md', onLink: () => {} }));

test('outline and rendered heading IDs agree for CJK, GFM, duplicate and setext headings', () => {
  const source = '# 安装 `Node.js`\n\n## ~~旧版~~ **指南**\n\n## 安装 `Node.js`\n\n另一个标题\n---\n\n```md\n# Not a heading\n```';
  const headings = markdownHeadings(source);
  assert.deepEqual(headings.map(item => [item.id, item.depth]), [
    ['md-安装-nodejs', 1], ['md-旧版-指南', 2], ['md-安装-nodejs-1', 2], ['md-另一个标题', 2],
  ]);
  const html = render(source);
  for (const heading of headings) assert.ok(html.includes(`id="${heading.id}"`));
  assert.ok(!html.includes('id="md-not-a-heading"'));
});

test('code is highlighted, unknown fences remain readable and raw HTML never executes', () => {
  const html = render('```typescript\nconst count: number = 42;\n```\n\n```unknown-language\n<script>alert(1)</script>\n```\n\n<script>alert(2)</script>\n\n[x](javascript:alert(3))');
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-number/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /复制代码/);
});

test('Mermaid fences use the diagram renderer and preserve ordinary code fences', () => {
  const html = render('```mermaid\nflowchart TD\n A[Start] --> B[End]\n```\n\n```text\nflowchart TD\n```');
  assert.match(html, /reader-diagram/);
  assert.match(html, /正在渲染图表/);
  assert.match(html, /reader-code/);
  assert.match(html, /全屏阅读/);
  assert.match(html, /文档目录/);
});
