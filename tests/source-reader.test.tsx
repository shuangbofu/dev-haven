import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceReader } from '../src/components/source-reader';
import { documentType } from '../src/shared/document-format';
import { highlightSource } from '../src/lib/highlight-source';

test('source viewer highlights code without executing or interpreting its markup', () => {
  const source = 'const message = "<script>alert(1)</script>";';
  const html = renderToStaticMarkup(<SourceReader content={source} language="javascript" />);
  assert.match(html, /hljs-keyword/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const plain = renderToStaticMarkup(<SourceReader content="<img src=x onerror=alert(1)>" language="unknown" />);
  assert.doesNotMatch(plain, /<img/); assert.match(plain, /&lt;img/);
  assert.equal(highlightSource('x'.repeat(100_001), 'javascript'), undefined);
});

test('file types are case insensitive and work with Windows and POSIX paths', () => {
  assert.deepEqual(documentType('C:\\docs\\Example.TSX'), { format: 'code', language: 'typescript' });
  assert.deepEqual(documentType('/docs/example.RS'), { format: 'code', language: 'rust' });
  assert.equal(documentType('/docs/intro.MD').format, 'markdown');
  assert.equal(documentType('/docs/index.HTML').format, 'html');
  assert.equal(documentType('/docs/photo.png').format, 'unsupported');
});
