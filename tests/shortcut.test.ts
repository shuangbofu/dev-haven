import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationSettings } from '../electron/application';
import { defaultSearchShortcut, matchesShortcut, searchShortcutSchema, shortcutLabel } from '../src/shared/shortcut';

test('search shortcuts match exact platform modifiers without repeat or composition', () => {
  const key = { code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false };
  assert.ok(matchesShortcut(key, defaultSearchShortcut, true));
  assert.ok(!matchesShortcut(key, defaultSearchShortcut, false));
  assert.ok(!matchesShortcut({ ...key, repeat: true }, defaultSearchShortcut, true));
  assert.ok(!matchesShortcut({ ...key, isComposing: true }, defaultSearchShortcut, true));
  assert.ok(!matchesShortcut({ ...key, shiftKey: true }, defaultSearchShortcut, true));
  assert.ok(matchesShortcut({ ...key, metaKey: false, ctrlKey: true }, defaultSearchShortcut, false));
  assert.equal(shortcutLabel(defaultSearchShortcut, true), '⌘K');
  assert.equal(shortcutLabel(defaultSearchShortcut, false), 'Ctrl+K');
});
test('search shortcut rejects destructive/editing bindings and persists a custom binding', async () => {
  for (const code of ['KeyQ','KeyW','KeyC','KeyV']) assert.equal(searchShortcutSchema.safeParse({ code, modifiers: ['primary'] }).success, false);
  assert.equal(searchShortcutSchema.safeParse({ code: 'KeyK', modifiers: [] }).success, false);
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-shortcut-'));
  try {
    const settings = await new ApplicationSettings(root, '0.1.0-beta.1').init();
    const shortcut = searchShortcutSchema.parse({ code: 'KeyP', modifiers: ['primary', 'shift'] });
    await settings.save({ ...settings.snapshot().preferences, searchShortcut: shortcut });
    const reopened = await new ApplicationSettings(root, '0.1.0-beta.1').init();
    assert.deepEqual(reopened.snapshot().preferences.searchShortcut, shortcut);
  } finally { await rm(root, { recursive: true, force: true }); }
});
