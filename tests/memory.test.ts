import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryService } from '../electron/memory';
import { LibraryService } from '../electron/library';
import { scanInventory } from '../electron/memory-scan';
import type { AgentRunner } from '../electron/codex-runner';
import { localDate, reportRange, type MemoryRecord } from '../src/shared/memory';
import { metadataSchema } from '../src/shared/library';

const metadata = (name: string, kind: 'project' | 'collection' = 'collection') => metadataSchema.parse({ schemaVersion: 1, kind, name });
async function fixture(runner: AgentRunner = async () => { throw new Error('Unexpected agent invocation'); }) {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-memory-')));
  const storage = path.join(temp, 'storage'), docs = path.join(temp, 'docs'), projects = path.join(temp, 'projects');
  await Promise.all([mkdir(storage), mkdir(docs), mkdir(projects)]);
  const service = await new MemoryService(storage, path.resolve('dist-electron'), runner).init();
  await service.saveConfig({ ...service.config, initialized: true, reportsDirectory: path.join(docs, 'DayReport'), sources: [
    { id: randomUUID(), name: 'Docs', kind: 'knowledge', directory: docs, scan: true, excludes: [] },
    { id: randomUUID(), name: 'Projects', kind: 'projects', directory: projects, scan: true, excludes: [] },
  ] });
  const source = service.config.sources[0], projectSource = service.config.sources[1];
  const library = new LibraryService({ source, store: service.libraryStore(source.id) });
  const record = (fields: Partial<MemoryRecord> = {}): MemoryRecord => ({ version: 1, id: randomUUID(), sourceId: source.id, path: '', occurredAt: new Date().toISOString(), message: 'Recorded change', evidence: [], ...fields });
  return { temp, storage, docs, projects, service, source, projectSource, library, record, cleanup: async () => { service.stop(); await service.idle(); await rm(temp, { recursive: true, force: true }); } };
}
function success(service: MemoryService, id: string) { const task = service.snapshot().tasks.find(task => task.id === id); assert.equal(task?.status, 'success', task?.error); }

test('central metadata persists without reading source markers or changelogs', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.docs, 'Guide'));
    await writeFile(path.join(f.docs, 'Guide/.devhaven.json'), '{broken');
    await writeFile(path.join(f.docs, 'Guide/CHANGELOG.md'), '- Unverified historical work');
    assert.equal((await f.library.overview()).collections.length, 0);
    await f.library.saveMetadata({ kind: 'knowledge', path: 'Guide', revision: '', metadata: metadata('指南') });
    assert.deepEqual((await f.library.overview()).collections.map(item => item.displayName), ['指南']);
    assert.equal(f.service.snapshot().events.length, 1);
    assert.equal(await readFile(path.join(f.docs, 'Guide/.devhaven.json'), 'utf8'), '{broken');
    await assert.rejects(f.library.browse('knowledge', 'DayReport'), /排除/);
    const reopened = await new MemoryService(f.storage, path.resolve('dist-electron')).init();
    assert.equal(reopened.snapshot().entities.find(entity => entity.path === 'Guide')?.metadata.name, '指南');
  } finally { await f.cleanup(); }
});

test('history filters ownership and real origins with stable pagination beyond the snapshot limit', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.docs, 'Guide'));
    const store = f.service.libraryStore(f.source.id);
    await store.save(path.join(f.docs, 'Guide'), metadata('中文指南'));
    for (let index = 0; index < 525; index++) await f.service.acceptRecord(f.record({ path: 'Guide', message: `Recorded ${String(index).padStart(3, '0')}`, occurredAt: '2026-09-01T10:00:00Z' }));
    await store.record(path.join(f.docs, 'Guide'), 'Local edit');
    assert.equal(f.service.events({ sourceId: f.source.id }).total, 526);
    assert.equal(f.service.events({ sourceId: f.source.id, origin: 'app' }).total, 1);
    const first = f.service.events({ origin: 'agent' });
    const second = f.service.events({ origin: 'agent', page: 2 });
    assert.equal(first.total, 525); assert.equal(first.items.length, 20);
    assert.ok(second.items.every(item => !first.items.some(previous => previous.id === item.id)));
    const last = f.service.events({ origin: 'agent', page: 1000 });
    assert.equal(last.page, 27); assert.equal(last.items.length, 5);
    assert.equal(f.service.events({ origin: 'agent', query: 'Recorded 524' }).total, 1);
    assert.equal(f.service.events({ kind: 'projects' }).total, 0);
    assert.equal(f.service.events({ kind: 'knowledge', query: '中文指南' }).total, 526);
    assert.equal(f.service.events({ path: 'Guid' }).total, 0);
    assert.equal(f.service.events({ path: 'Guide' }).total, 526);
    assert.equal((await store.history(path.join(f.docs, 'Guide')))[0].message, 'Local edit');
    assert.throws(() => f.service.events({ pageSize: 1000 }));
  } finally { await f.cleanup(); }
});

test('central library creates and edits without source bookkeeping; sources remain isolated', async () => {
  const f = await fixture();
  try {
    await f.library.create('knowledge', '', 'Notes', true, f.docs);
    await f.library.create('knowledge', 'Notes', 'intro.md', false, f.docs);
    const doc = await f.library.read('knowledge', 'Notes/intro.md');
    await f.library.saveDocument('knowledge', doc.path, '# Updated', doc.revision);
    assert.deepEqual((await readdir(path.join(f.docs, 'Notes'))).sort(), ['intro.md']);
    assert.equal((await f.library.browse('knowledge', 'Notes')).current.changelog.length, 3);
    assert.equal((await f.service.libraryStore(f.projectSource.id).history(f.projects)).length, 0);
    assert.equal(f.service.snapshot().events.length, 3);
    const edit = f.service.events({ path: 'Notes/intro.md', origin: 'app' });
    assert.equal(edit.total, 2);
    assert.equal(edit.items[0].path, 'Notes/intro.md');
    const collection = (await f.library.browse('knowledge', 'Notes')).current;
    await assert.rejects(f.library.saveMetadata({ kind: 'knowledge', path: 'Notes', revision: collection.metadataRevision, metadata: metadata('Wrong', 'project') }), /知识集合/);
    await assert.rejects(f.library.create('knowledge', '', 'wrong', true, f.projects), /设置已变化/);
    await assert.rejects(f.library.destination('knowledge', f.projects), /必须位于/);
  } finally { await f.cleanup(); }
});

test('project groups derive from directories without agent instructions and remain editable', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.projects, 'Team/Tools/App/src'), { recursive: true });
    const library = new LibraryService({ source: f.projectSource, store: f.service.libraryStore(f.projectSource.id) });
    assert.equal((await library.destination('projects', path.join(f.projects, 'Team/Tools'))).path, 'Team/Tools');
    await f.service.acceptRecord(f.record({ sourceId: f.projectSource.id, path: 'Team/Tools/App', metadata: metadata('工具项目', 'project') }));
    let listing = await library.projects();
    assert.deepEqual(listing.groups.map(group => group.path), ['', 'Team', 'Team/Tools']);
    assert.equal(listing.groups.find(group => group.path === 'Team')?.displayName, 'Team');
    const group = listing.groups.find(group => group.path === 'Team')!;
    await library.saveMetadata({ kind: 'projects', path: group.path, revision: group.metadataRevision, metadata: { ...group.metadata!, name: '团队研发', description: '自定义分组描述' } });
    await mkdir(path.join(f.projects, 'Team/Other'));
    await f.service.acceptRecord(f.record({ sourceId: f.projectSource.id, path: 'Team/Other', metadata: metadata('其他项目', 'project') }));
    listing = await library.projects();
    assert.equal(listing.groups.find(group => group.path === 'Team')?.displayName, '团队研发');
    assert.equal(listing.groups.find(group => group.path === 'Team')?.description, '自定义分组描述');
    await assert.rejects(library.destination('projects', path.join(f.projects, 'Team/Tools/App/src')), /已有项目内部/);
    await assert.rejects(readFile(path.join(f.projects, 'Team/.devhaven.json')));
    assert.ok(f.service.events({ sourceId: f.projectSource.id, path: 'Team', origin: 'app' }).total > 0);
  } finally { await f.cleanup(); }
});

test('records are idempotent and reject escaped paths, symlinks, wrong kinds and excluded reports', async () => {
  const f = await fixture();
  try {
    const record = f.record({ metadata: metadata('Docs') });
    await f.service.acceptRecord(record); await f.service.acceptRecord(record);
    assert.equal(f.service.snapshot().events.length, 1);
    await symlink(f.projects, path.join(f.docs, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const relative of ['../projects', '/etc', 'C:\\outside', 'linked', 'DayReport']) await assert.rejects(f.service.acceptRecord(f.record({ path: relative })));
    await assert.rejects(f.service.acceptRecord(f.record({ metadata: metadata('Project', 'project') })), /类型/);
    await assert.rejects(f.service.acceptRecord(f.record({ evidence: ['missing.md'] })));
    await assert.rejects(f.service.acceptRecord(f.record({ sourceId: randomUUID() })), /来源不存在/);
    await writeFile(path.join(f.service.config.directory, 'inbox', `${record.id}.json`), JSON.stringify(record));
    await f.service.consumeInbox();
    assert.equal(JSON.parse(await readFile(path.join(f.service.config.directory, 'receipts', `${record.id}.json.status`), 'utf8')).accepted, true);
    assert.equal(f.service.snapshot().events.length, 1);
  } finally { await f.cleanup(); }
});

test('metadata maintenance updates the entity without recording user work', async () => {
  const f = await fixture();
  try {
    const record = f.record({ metadataOnly: true, metadata: metadata('资料'), message: 'Correct a placeholder label' });
    await f.service.acceptRecord(record); await f.service.acceptRecord(record);
    assert.equal(f.service.snapshot().entities[0].metadata.name, '资料');
    assert.equal(f.service.events({}).total, 0);
    await assert.rejects(f.service.acceptRecord(f.record({ metadataOnly: true })));
  } finally { await f.cleanup(); }
});

test('scan establishes a baseline, skips unchanged input, validates evidence and preserves launch', async () => {
  let calls = 0, invalid = false;
  const f = await fixture(async request => {
    calls++; const input = JSON.parse(await readFile(path.join(request.directory, 'input.json'), 'utf8'));
    return { entities: input.candidates.map((candidate: { path: string; suggestedKind: string; samples: { path: string }[] }) => ({ path: candidate.path, kind: candidate.suggestedKind, name: '测试应用', description: '根据项目清单登记的测试应用', languages: ['TypeScript'], tags: [], evidence: [candidate.samples[0].path] })), changes: [{ path: 'App', message: 'Manifest changed', evidence: [invalid ? 'outside.md' : 'App/package.json'] }] };
  });
  try {
    await mkdir(path.join(f.projects, 'App'));
    await writeFile(path.join(f.projects, 'App/package.json'), '{"name":"app"}');
    const launch = { command: 'npm', args: ['run', 'dev'] };
    await f.service.libraryStore(f.projectSource.id).save(path.join(f.projects, 'App'), { ...metadata('App', 'project'), launch });
    let id = f.service.scan(f.projectSource.id); await f.service.idle(); success(f.service, id);
    assert.equal(f.service.snapshot().events.length, 0);
    f.service.scan(f.projectSource.id); await f.service.idle(); assert.equal(calls, 1);
    await writeFile(path.join(f.projects, 'App/package.json'), '{"name":"app","version":"2"}');
    invalid = true; id = f.service.scan(f.projectSource.id); await f.service.idle();
    assert.equal(f.service.snapshot().tasks.find(task => task.id === id)?.status, 'failed');
    assert.equal(f.service.snapshot().events.length, 0);
    invalid = false; id = f.service.scan(f.projectSource.id); await f.service.idle(); success(f.service, id);
    assert.equal(f.service.snapshot().events.length, 1);
    assert.equal(f.service.snapshot().events[0].reportable, false);
    assert.equal(f.service.snapshot().events[0].occurredAt, undefined);
    assert.deepEqual(f.service.snapshot().entities.find(entity => entity.path === 'App')?.metadata.launch, launch);
    assert.equal(f.service.snapshot().entities.find(entity => entity.path === 'App')?.metadata.name, '测试应用');
    assert.equal(f.service.snapshot().entities.find(entity => entity.path === 'App')?.registration, 'manual');
  } finally { await f.cleanup(); }
});

test('scan rejects English or unread evidence, preserves provenance, and does not import repository changelogs', async () => {
  let mode = 'english', calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { entities: [{ path: 'App', kind: 'project', name: mode === 'english' ? 'Install using npm' : '测试应用', description: '用于验证的本地测试项目', languages: [], tags: [], evidence: [mode === 'unread' ? 'App/unread.txt' : 'App/README.md'] }], changes: [] };
  });
  try {
    await mkdir(path.join(f.projects, 'App'));
    await writeFile(path.join(f.projects, 'App/package.json'), '{"name":"app"}');
    await writeFile(path.join(f.projects, 'App/README.md'), '# 测试应用\n用于验证的本地测试项目');
    await writeFile(path.join(f.projects, 'App/CHANGELOG.md'), '## 2026-09-18\n- Must not be imported');
    await writeFile(path.join(f.projects, 'App/unread.txt'), 'Not sampled');
    for (const invalidMode of ['english', 'unread']) {
      mode = invalidMode;
      const id = f.service.scan(f.projectSource.id); await f.service.idle();
      assert.equal(f.service.snapshot().tasks.find(task => task.id === id)?.status, 'failed');
      assert.equal(f.service.snapshot().entities.length, 0);
    }
    mode = 'valid';
    const id = f.service.scan(f.projectSource.id); await f.service.idle(); success(f.service, id);
    let entity = f.service.snapshot().entities.find(entity => entity.path === 'App')!;
    assert.equal(entity.registration, 'scan');
    assert.deepEqual(entity.metadataEvidence, ['App/README.md']);
    assert.equal(f.service.snapshot().events.length, 0);
    await f.service.libraryStore(f.projectSource.id).save(path.join(f.projects, 'App'), { ...entity.metadata, name: 'Old English Name', description: 'Old description' });
    const rescan = f.service.scan(f.projectSource.id); await f.service.idle(); success(f.service, rescan);
    entity = f.service.snapshot().entities.find(entity => entity.path === 'App')!;
    assert.equal(calls, 4); assert.equal(entity.metadata.name, '测试应用'); assert.equal(entity.registration, 'scan');
    const reopened = await new MemoryService(f.storage, path.resolve('dist-electron')).init();
    assert.equal(reopened.snapshot().entities.find(entity => entity.path === 'App')?.registration, 'scan');
  } finally { await f.cleanup(); }
});

test('inventory prioritizes README and manifests over other root files', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.projects, 'App'));
    for (const file of ['AGENTS.md', 'A.md', 'B.md', 'C.md', 'README.md', 'package.json', 'main.ts']) await writeFile(path.join(f.projects, 'App', file), file);
    const result = await scanInventory(f.projectSource, [], new AbortController().signal);
    assert.deepEqual(result.candidates[0].samples.slice(0, 2).map(sample => sample.path), ['App/README.md', 'App/package.json']);
    assert.ok(!result.candidates[0].samples.some(sample => sample.path.endsWith('AGENTS.md')));
  } finally { await f.cleanup(); }
});

test('inventory ignores report directories, symlinks, secrets and dependencies', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.docs, 'Guide/node_modules/Fake'), { recursive: true });
    await writeFile(path.join(f.docs, 'Guide/readme.md'), '# Guide');
    await writeFile(path.join(f.docs, 'Guide/.env'), 'SECRET=not-in-input');
    await writeFile(path.join(f.docs, 'Guide/node_modules/Fake/readme.md'), '# Fake');
    await writeFile(path.join(f.docs, 'DayReport/report.md'), '# Private report');
    await symlink(f.projects, path.join(f.docs, 'Alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await scanInventory(f.source, [f.service.config.directory, f.service.config.reportsDirectory], new AbortController().signal);
    assert.deepEqual(result.candidates.map(candidate => candidate.path), ['Guide']);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|Private report|Fake/);
  } finally { await f.cleanup(); }
});

test('daily reports use dated evidence, version edits, reject stale writes and protect symlinks', async () => {
  let badEvidence = false;
  const f = await fixture(async request => {
    const input = JSON.parse(await readFile(path.join(request.directory, 'input.json'), 'utf8'));
    return { items: [{ summary: '整理个人知识', details: [{ text: 'Recorded change', evidenceIds: [badEvidence ? 'missing' : input.events[0].id] }] }] };
  });
  try {
    const today = localDate(); await f.service.acceptRecord(f.record());
    let id = f.service.report(today); await f.service.idle(); success(f.service, id);
    const report = f.service.snapshot().reports[0]; assert.match(report.content, /Recorded change/);
    assert.match(report.content, /个人日报/);
    assert.match(report.content, /## 内容概览\n\n1\. 整理个人知识/);
    assert.match(report.content, /## 详细内容\n\n### 1\. 整理个人知识/);
    assert.equal(report.evidenceIds.length, 1);
    assert.ok(!report.content.includes(report.evidenceIds[0]));
    assert.match(report.content, /依据：Docs：Recorded change/);
    await f.service.saveReport(report.id, '# Edited', report.revision);
    assert.equal(f.service.snapshot().reports.length, 2);
    await assert.rejects(f.service.saveReport(report.id, '# Stale', report.revision), /最新/);
    badEvidence = true; id = f.service.report(today); await f.service.idle();
    assert.equal(f.service.snapshot().tasks.find(task => task.id === id)?.status, 'failed');
    assert.equal(await readFile(report.file, 'utf8'), '# Edited');
    const latest = f.service.snapshot().reports[0];
    await rm(report.file); await writeFile(path.join(f.temp, 'outside.md'), '# Outside'); await symlink(path.join(f.temp, 'outside.md'), report.file);
    await assert.rejects(f.service.saveReport(latest.id, '# Bad', latest.revision), /符号链接/);
    assert.throws(() => f.service.report('2026-02-30'), /日期/);
  } finally { await f.cleanup(); }
});

test('report calendar ranges handle week/year boundaries and leap months', () => {
  assert.deepEqual(reportRange('2026-01-01', 'weekly'), { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(reportRange('2026-01-04', 'weekly'), { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(reportRange('2024-02-29', 'monthly'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(reportRange('2025-02-10', 'monthly'), { start: '2025-02-01', end: '2025-02-28' });
  assert.throws(() => reportRange('2025-02-29', 'monthly'), /日期/);
});

test('personal report periods isolate evidence, task deduplication, files and latest editable versions', async () => {
  const inputs: { period: string; events: { id: string; message: string }[] }[] = [];
  const f = await fixture(async request => {
    const input = JSON.parse(await readFile(path.join(request.directory, 'input.json'), 'utf8'));
    inputs.push(input);
    assert.match(request.prompt, /Personal reports/);
    assert.match(request.prompt, /内容概览/);
    return { items: [{ summary: '个人学习与项目进展', details: input.events.map((event: { id: string; message: string }) => ({ text: event.message, evidenceIds: [event.id] })) }] };
  });
  try {
    const records = ['2024-01-31', '2024-02-01', '2024-02-26', '2024-02-29', '2024-03-03', '2024-03-04'].map(date => f.record({ occurredAt: new Date(`${date}T12:00:00`).toISOString(), message: `活动 ${date}` }));
    for (const record of records) await f.service.acceptRecord(record);
    const daily = f.service.report('2024-02-26');
    const weekly = f.service.report('2024-02-26', 'weekly');
    assert.equal(f.service.report('2024-03-03', 'weekly'), weekly);
    const monthly = f.service.report('2024-02-01', 'monthly');
    assert.equal(f.service.report('2024-02-29', 'monthly'), monthly);
    assert.notEqual(daily, weekly);
    await f.service.idle();
    for (const id of [daily, weekly, monthly]) success(f.service, id);
    for (const [period, dates] of [['daily', ['2024-02-26']], ['weekly', ['2024-02-26', '2024-02-29', '2024-03-03']], ['monthly', ['2024-02-01', '2024-02-26', '2024-02-29']]] as const) {
      assert.deepEqual(inputs.find(input => input.period === period)?.events.map(event => event.message), dates.map(date => `活动 ${date}`));
    }
    const reports = f.service.snapshot().reports;
    assert.equal(new Set(reports.map(report => report.file)).size, 3);
    const day = reports.find(report => report.period === 'daily')!;
    const week = reports.find(report => report.period === 'weekly')!;
    const month = reports.find(report => report.period === 'monthly')!;
    assert.match(week.content, /^# 2024-02-26 ~ 2024-03-03 个人周报/);
    assert.match(month.content, /^# 2024-02-01 ~ 2024-02-29 个人月报/);
    await f.service.saveReport(day.id, '# 个人日记修订', day.revision);
    assert.equal(await readFile(week.file, 'utf8'), week.content);
    const next = f.service.report('2024-03-01', 'weekly'); await f.service.idle(); success(f.service, next);
    assert.equal(f.service.snapshot().reports[0].file, week.file);
    await assert.rejects(f.service.saveReport(week.id, '# stale', week.revision), /最新/);
  } finally { await f.cleanup(); }
});

test('empty days need no agent; memory relocation preserves records and excludes nested sources', async () => {
  const f = await fixture();
  try {
    const id = f.service.report('2000-01-01'); await f.service.idle(); success(f.service, id);
    await f.service.acceptRecord(f.record());
    const next = path.join(f.temp, 'relocated');
    await f.service.saveConfig({ ...f.service.config, directory: next });
    const reopened = await new MemoryService(f.storage, path.resolve('dist-electron')).init();
    assert.equal(reopened.config.directory, next); assert.equal(reopened.snapshot().events.length, 1);
    await assert.rejects(f.service.saveConfig({ ...f.service.config, sources: [...f.service.config.sources, { ...f.source, id: randomUUID() }] }), /重复/);
    await assert.rejects(f.service.saveConfig({ ...f.service.config, reportsDirectory: f.docs }), /报告目录不能登记/);
  } finally { await f.cleanup(); }
});

test('cancellation leaves no scan baseline or fabricated events', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture(request => new Promise((_resolve, reject) => { request.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); started(); }));
  try {
    await mkdir(path.join(f.docs, 'Guide')); await writeFile(path.join(f.docs, 'Guide/readme.md'), '# Guide');
    const id = f.service.scan(f.source.id); await ready; f.service.cancel(id); await f.service.idle();
    assert.equal(f.service.snapshot().tasks.find(task => task.id === id)?.status, 'cancelled');
    assert.equal(f.service.snapshot().events.length, 0);
  } finally { await f.cleanup(); }
});
