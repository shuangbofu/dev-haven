import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { manifestSchema, planImport, versionSchema } from '../src/shared/manifest';
import type { Installation, Manifest } from '../src/shared/types';
import { checksumFor, Engine, enginePaths } from '../electron/engine';

const manifest = (tools: Manifest['tools']): Manifest => ({ format: 'devhaven', schemaVersion: 1, name: 'Development', exportedAt: '2026-09-17T08:00:00.000Z', source: { platform: 'darwin', arch: 'arm64' }, tools });
test('rejects commands, traversal, aliases and unsupported schema data', () => {
  for (const value of ['latest', 'lts', '../22', '22; rm -rf /', '--help', '22$(id)', '22\nfoo', 'node@22']) assert.equal(versionSchema.safeParse(value).success, false, value);
  assert.equal(manifestSchema.safeParse({ ...manifest([]), secrets: { token: 'do not export' } }).success, false);
  assert.equal(manifestSchema.safeParse({ ...manifest([]), schemaVersion: 2 }).success, false);
  assert.equal(versionSchema.safeParse('temurin-21.0.6+7').success, true);
});
test('rejects duplicate versions and ambiguous defaults', () => {
  const node = { id: 'node' as const, version: '22.14.0', default: true };
  assert.equal(manifestSchema.safeParse(manifest([node, node])).success, false);
  assert.equal(manifestSchema.safeParse(manifest([node, { ...node, version: '20.19.0' }])).success, false);
});
test('migration sorts dependencies, skips installed versions and warns across platforms', () => {
  const installed = [{ id: 'existing', tool: 'node', version: '22.14.0', path: '/managed/node', binPaths: [], installedAt: '', isDefault: true }] satisfies Installation[];
  const plan = planImport(manifest([{ id: 'pnpm', version: '10.6.0', default: true }, { id: 'node', version: '22.14.0', default: true }]), installed, 'win32');
  assert.deepEqual(plan.items.map(i => [i.tool, i.action]), [['node', 'installed'], ['pnpm', 'install']]);
  assert.equal(plan.warnings.length, 1);
});
test('migration requires the declared default of a dependency', () => {
  assert.throws(() => planImport(manifest([{ id: 'yarn', version: '4.7.0', default: true }]), [], 'darwin'), /需要默认/);
  assert.throws(() => planImport(manifest([{ id: 'maven', version: '3.9.9', default: true }, { id: 'java', version: 'temurin-21.0.6+7', default: false }]), [], 'darwin'), /需要默认/);
});
test('Gradle migration orders Java first and uv can be migrated independently', () => {
  assert.throws(() => planImport(manifest([{ id: 'gradle', version: '9.4.0', default: true }]), [], 'win32'), /需要默认 Java/);
  const plan = planImport(manifest([{ id: 'gradle', version: '9.4.0', default: true }, { id: 'java', version: 'temurin-21.0.6+7', default: true }, { id: 'uv', version: '0.10.0', default: true }]), [], 'win32');
  assert.deepEqual(plan.items.map(item => item.tool), ['java', 'gradle', 'uv']);
  assert.equal(planImport(manifest([{ id: 'uv', version: '0.10.0', default: true }]), [], 'win32').items.length, 1);
});
test('checksum parsing supports release-relative filenames and fails closed', () => {
  const hash = 'a'.repeat(64);
  for (const prefix of ['', './', '*', '*./']) assert.equal(checksumFor(`${hash}  ${prefix}mise.exe\n`, 'mise.exe'), hash);
  assert.throws(() => checksumFor(`${hash}  ./other-file`, 'mise.exe'), /校验/);
  assert.throws(() => checksumFor('invalid  ./mise.exe', 'mise.exe'), /校验/);
});
test('managed engine paths do not inherit a removed Go installation', () => {
  const oldRoot = process.env.GOROOT;
  const oldToolDir = process.env.GOTOOLDIR;
  process.env.GOROOT = '/old/toolchain'; process.env.GOTOOLDIR = '/old/toolchain/pkg/tool';
  try {
    const root = path.join(os.tmpdir(), 'devhaven-engine-paths');
    const engine = new Engine(root);
    assert.equal(engine.env.GOROOT, undefined);
    assert.equal(engine.env.GOTOOLDIR, undefined);
    assert.equal(engine.env.GOPATH, path.join(root, 'go'));
    assert.equal(engine.env.GOMODCACHE, path.join(root, 'cache', 'go', 'mod'));
    assert.equal(engine.env.GOCACHE, path.join(root, 'cache', 'go', 'build'));
    assert.equal(engine.env.GOENV, path.join(root, 'config', 'go', 'env'));
    assert.equal(enginePaths(root).GOPATH, path.join(root, 'go'));
  } finally {
    if (oldRoot === undefined) delete process.env.GOROOT; else process.env.GOROOT = oldRoot;
    if (oldToolDir === undefined) delete process.env.GOTOOLDIR; else process.env.GOTOOLDIR = oldToolDir;
  }
});
