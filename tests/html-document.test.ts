import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { safeHTMLDocument } from '../src/lib/html-document';

test('HTML reading preserves interactive controls and scripts inside an isolated document', () => {
  const window = new JSDOM('').window;
  Object.assign(globalThis, { DOMParser: window.DOMParser });
  try {
    const html = safeHTMLDocument('<!doctype html><html lang="zh"><head><style>h1{color:red}</style><meta http-equiv="refresh" content="0;url=https://example.com"><base href="file:///"></head><body><h1 id="title">指南</h1><script>window.demo=1</script><button onclick="this.textContent=2" data-action="count">1</button><a href="#title">返回标题</a><iframe src="file:///etc/passwd"></iframe><script src="https://example.com/library.js"></script><form onsubmit="event.preventDefault()"><input><select><option>一</option></select></form></body></html>', false);
    const result = new JSDOM(html).window.document;
    assert.equal(result.querySelector('h1')?.textContent, '指南');
    assert.equal(result.documentElement.lang, 'zh');
    assert.ok([...result.querySelectorAll('script')].some(script => script.textContent === 'window.demo=1'));
    assert.equal(result.querySelector('button')?.getAttribute('onclick'), 'this.textContent=2');
    assert.equal(result.querySelector('button')?.dataset.action, 'count');
    assert.equal(result.querySelector('a')?.getAttribute('href'), '#title');
    assert.equal(result.querySelectorAll('form,input,select').length, 3);
    assert.equal(result.querySelectorAll('iframe,base,script[src],meta[http-equiv="refresh"]').length, 0);
    assert.equal(result.head.firstElementChild?.getAttribute('http-equiv'), 'Content-Security-Policy');
    const csp = result.head.firstElementChild!.getAttribute('content')!;
    for (const rule of ["default-src 'none'", "script-src 'unsafe-inline'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'"]) assert.ok(csp.includes(rule));
    assert.match(result.querySelector('style')!.textContent!, /color-scheme:light/);
    assert.match(html, /h1\{color:red\}/);
    assert.equal(result.querySelectorAll('html').length, 1);
  } finally { window.close(); }
});
