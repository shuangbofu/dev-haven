import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('HTML reading keeps headings and CSS while removing active content, navigation and refresh', async () => {
  const window = new JSDOM('').window;
  Object.assign(globalThis, { window });
  const { safeHTMLDocument } = await import('../src/lib/html-document');
  const html = safeHTMLDocument('<!doctype html><html><head><style>h1{color:red}</style><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><h1>指南</h1><script>window.bad=1</script><img src="https://example.com/tracker" onerror="alert(1)"><a href="javascript:alert(1)">跳转</a><iframe src="file:///etc/passwd"></iframe><form action="https://example.com"><input></form></body></html>', false);
  const result = new JSDOM(html).window.document;
  assert.equal(result.querySelector('h1')?.textContent, '指南');
  assert.match(result.querySelector('style')!.textContent!, /color-scheme:light/);
  assert.equal(result.querySelectorAll('script,iframe,form,input,[onerror],[href],meta[http-equiv="refresh"]').length, 0);
  assert.match(result.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!, /default-src 'none'/);
  assert.match(html, /h1\{color:red\}/);
  window.close();
});
