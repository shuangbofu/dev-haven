import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreWindowState } from '../electron/window-state';

const primary = { x: 0, y: 25, width: 1440, height: 875 };
test('restores normal window size and position independently of maximization', () => {
  const saved = { bounds: { x: 50, y: 60, width: 960, height: 700 }, maximized: true };
  const state = restoreWindowState(saved, [primary], primary);
  assert.deepEqual(state.bounds, saved.bounds);
  assert.equal(state.maximized, true);
});
test('keeps negative coordinates on a connected secondary monitor', () => {
  const secondary = { x: -1920, y: 0, width: 1920, height: 1080 };
  const bounds = { x: -1800, y: 50, width: 1000, height: 720 };
  assert.deepEqual(restoreWindowState({ bounds, maximized: false }, [primary, secondary], primary).bounds, bounds);
});
test('recovers a disconnected display and clamps dimensions to a smaller work area', () => {
  const small = { x: 0, y: 25, width: 800, height: 575 };
  const state = restoreWindowState({ bounds: { x: -1800, y: 50, width: 1380, height: 960 }, maximized: false }, [small], small);
  assert.deepEqual(state.bounds, small);
  assert.equal(state.minWidth, 800);
  assert.equal(state.minHeight, 575);
});
test('invalid saved state falls back to a centered usable window', () => {
  for (const saved of [undefined, {}, { bounds: { x: 0, y: 0, width: -1, height: 2 }, maximized: true }]) {
    const state = restoreWindowState(saved, [primary], primary);
    assert.equal(state.bounds.width, 1100);
    assert.equal(state.bounds.height, 780);
    assert.equal(state.maximized, false);
  }
});
