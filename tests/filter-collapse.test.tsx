import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Segments } from '../src/components/list-controls';

test('overflow filters fold after the first row, expand accessibly and adapt to available width', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  let width = 300;
  let notify = () => {};
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return width; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { width: 90 } as DOMRect; };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetTop', { configurable: true, get() {
    const parent = this.parentElement;
    if (!parent?.classList.contains('filter-segments')) return 0;
    const available = width - (parent.classList.contains('has-overflow') ? 86 : 0);
    return Math.floor(Array.from(parent.children).indexOf(this) / Math.max(1, Math.floor((available + 3) / 93))) * 33;
  } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<Segments label="语言" value="0" options={['0','1','2','3'].map(value => ({ value, label: value }))} onChange={() => {}} />));
    const toggle = () => dom.window.document.querySelector<HTMLButtonElement>('.filter-expand')!;
    assert.equal(toggle().textContent, '展开全部');
    assert.equal(dom.window.document.querySelectorAll('.filter-segments button[tabindex="-1"]').length, 2);
    await act(async () => toggle().click());
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.equal(dom.window.document.querySelectorAll('.filter-segments button[tabindex="-1"]').length, 0);
    await act(async () => toggle().click());
    assert.equal(dom.window.document.querySelectorAll('.filter-segments button[aria-hidden="true"]').length, 2);
    await act(async () => { width = 500; notify(); });
    assert.equal(dom.window.document.querySelector('.filter-expand'), null);
    assert.equal(dom.window.document.querySelectorAll('.filter-segments button[tabindex="-1"]').length, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
