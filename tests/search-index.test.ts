import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LocalSearchIndex } from '../electron/search-index';
import { memoryConfigSchema } from '../src/shared/memory';

test('persistent search supports body substrings, offline reuse, refresh, exclusions and invalidated paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-index-'));
  try {
    const docs = path.join(root, 'docs'); await mkdir(docs);
    const config = memoryConfigSchema.parse({ version: 1, initialized: true, agent: { executable: 'codex', model: '' }, autoScan: false, scanIntervalMinutes: 30, directory: path.join(root, 'memory'), reportsDirectory: path.join(root, 'reports'), sources: [{ id: randomUUID(), kind: 'knowledge', name: '资料', directory: docs, scan: true, excludes: [] }] });
    await writeFile(path.join(docs, 'guide.md'), '# 中文指南\n支持增量全文检索和知识管理');
    await writeFile(path.join(docs, 'page.html'), '<style>.cssNoise{color:red}</style><h1>HTML</h1><p>页面关键词</p><script>scriptNoise</script>');
    const index = new LocalSearchIndex(); await index.rebuild(config, []);
    assert.equal((await index.search({ query: '全文检索' }, config)).total, 1);
    assert.equal((await index.search({ query: '页面关键词' }, config)).items[0].path, 'page.html');
    assert.equal((await index.search({ query: 'cssNoise' }, config)).total, 0);
    assert.equal((await index.search({ query: 'scriptNoise' }, config)).total, 0);
    const reused = new LocalSearchIndex(); await reused.load(config);
    assert.equal(reused.status().documents, 2);
    await writeFile(path.join(docs, 'guide.md'), '更新后的关键字');
    assert.equal((await reused.search({ query: '全文检索' }, config)).total, 1, 'queries use the indexed snapshot rather than rereading content');
    await index.rebuild(config, []);
    assert.equal((await reused.search({ query: '全文检索' }, config)).total, 0);
    assert.equal((await reused.search({ query: '关键字' }, config)).total, 1);
    const restricted = structuredClone(config); restricted.sources[0].excludes = ['guide.md'];
    assert.equal((await reused.search({ query: '关键字' }, restricted)).items.length, 0, 'changed scope never reuses an incompatible disk index');
    await rm(path.join(docs, 'guide.md'));
    const result = await index.search({ query: '关键字' }, config);
    assert.equal(result.items.length, 0); assert.ok(result.warnings.length);
    await writeFile(path.join(root, 'outside.md'), 'private');
    await symlink(path.join(root, 'outside.md'), path.join(docs, 'guide.md'));
    assert.equal((await index.search({ query: '关键字' }, config)).items.length, 0);
    assert.ok((await readFile(path.join(config.directory, 'search-index.json'), 'utf8')).includes('indexedAt'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
