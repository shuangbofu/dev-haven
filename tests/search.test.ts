import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GlobalSearch } from '../electron/search';
import { memoryConfigSchema, type MemoryEntity } from '../src/shared/memory';
import { metadataSchema } from '../src/shared/library';

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-search-')));
  const docs = path.join(root, 'docs'), projects = path.join(root, 'projects');
  await Promise.all([mkdir(docs), mkdir(projects)]);
  const sourceId = randomUUID(), projectSource = randomUUID();
  const config = memoryConfigSchema.parse({ version: 1, initialized: true, directory: path.join(root, 'memory'), reportsDirectory: path.join(docs, 'Reports'), sources: [
    { id: sourceId, name: '文档', kind: 'knowledge', directory: docs, scan: true, excludes: ['Excluded'] },
    { id: projectSource, name: '项目', kind: 'projects', directory: projects, scan: true, excludes: [] },
  ], agent: { executable: 'codex', model: '' }, autoScan: false, scanIntervalMinutes: 30 });
  const entities: MemoryEntity[] = [{ id: randomUUID(), sourceId: projectSource, path: 'demo', metadata: metadataSchema.parse({ schemaVersion: 1, kind: 'project', name: '个人阅读工具', description: '离线阅读和知识整理', tags: ['学习'], languages: ['TypeScript'] }), updatedAt: new Date().toISOString(), revision: 'revision' }];
  const put = async (base: string, relative: string, content: string) => { const file = path.join(base, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return file; };
  await mkdir(path.join(projects, 'demo'));
  return { root, docs, projects, config, sourceId, projectSource, entities, put, search: new GlobalSearch(), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('global search finds deep document body and project metadata/README across all sources', async () => {
  const f = await fixture();
  try {
    await f.put(f.docs, 'unregistered/deep/guide.md', '# 使用指南\n\n' + '其他内容 '.repeat(100) + '向量检索 支持离线。');
    await f.put(f.projects, 'demo/README.md', '# 阅读器\n支持向量检索与全文搜索。');
    await f.put(f.projects, 'demo/docs/manual.md', '# 配置指南\n键盘导航功能。');
    const result = await f.search.search({ query: '向量检索' }, f.config, f.entities);
    assert.equal(result.total, 3);
    assert.ok(result.items.some(item => item.kind === 'document' && item.sourceId === f.sourceId));
    assert.ok(result.items.some(item => item.kind === 'project' && item.path === 'demo' && item.matchedIn === 'README'));
    assert.ok(result.items.every(item => item.snippet.includes('向量检索')));
    const meta = await f.search.search({ query: '学习 typescript', kind: 'project' }, f.config, f.entities);
    assert.equal(meta.total, 1); assert.equal(meta.items[0].title, '个人阅读工具');
    const deep = await f.search.search({ query: '键盘导航', kind: 'document' }, f.config, f.entities);
    assert.equal(deep.items[0].projectPath, 'demo');
    assert.equal((await f.search.search({ query: '向量检索 缺失词' }, f.config, f.entities)).total, 0);
  } finally { await f.cleanup(); }
});

test('search skips symlinks, hidden/secrets, dependencies, reports, excluded paths and source changelogs', async () => {
  const f = await fixture();
  try {
    for (const file of ['Excluded/a.md', '.hidden/a.md', 'node_modules/a.md', 'Reports/a.md', 'CHANGELOG.md', 'secrets.json', 'safe.md']) await f.put(f.docs, file, 'needle');
    await f.put(f.root, 'outside.md', 'needle');
    await symlink(path.join(f.root, 'outside.md'), path.join(f.docs, 'linked.md'));
    await symlink(path.join(f.root), path.join(f.docs, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await f.search.search({ query: 'needle' }, f.config, f.entities);
    assert.deepEqual(result.items.map(item => item.path), ['safe.md']);
    assert.equal(result.partial, false);
    f.config.sources[0].excludes.push('safe.md');
    assert.equal((await f.search.search({ query: 'needle' }, f.config, f.entities)).total, 0);
  } finally { await f.cleanup(); }
});

test('cached text refreshes after edits and deletes, paginates stably, and handles oversized files', async () => {
  const f = await fixture();
  try {
    const file = await f.put(f.docs, 'one.md', 'old content');
    assert.equal((await f.search.search({ query: 'old' }, f.config, f.entities)).total, 1);
    await writeFile(file, 'new content with more words');
    assert.equal((await f.search.search({ query: 'old' }, f.config, f.entities)).total, 0);
    assert.equal((await f.search.search({ query: 'new' }, f.config, f.entities)).total, 1);
    await rm(file);
    assert.equal((await f.search.search({ query: 'new' }, f.config, f.entities)).total, 0);
    for (let index = 0; index < 35; index++) await f.put(f.docs, `${String(index).padStart(2, '0')}.md`, '分页关键词');
    const first = await f.search.search({ query: '分页关键词' }, f.config, f.entities);
    const second = await f.search.search({ query: '分页关键词', page: 2 }, f.config, f.entities);
    assert.equal(first.total, 35); assert.equal(first.items.length, 30); assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 35);
    await f.put(f.docs, 'large.md', 'X'.repeat(2 * 1024 * 1024 + 1));
    const large = await f.search.search({ query: 'XXXXXXXX' }, f.config, f.entities);
    assert.equal(large.total, 0); assert.ok(large.warnings.some(warning => warning.includes('2 MB')));
  } finally { await f.cleanup(); }
});

test('a newer search cancels stale work and validates query input', async () => {
  const f = await fixture();
  try {
    await f.put(f.docs, 'one.md', 'current');
    const results = await Promise.allSettled([f.search.search({ query: 'old' }, f.config, f.entities), f.search.search({ query: 'current' }, f.config, f.entities)]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    if (results[1].status === 'fulfilled') assert.equal(results[1].value.total, 1);
    await assert.rejects(f.search.search({ query: 'x'.repeat(301) }, f.config, f.entities));
  } finally { await f.cleanup(); }
});
