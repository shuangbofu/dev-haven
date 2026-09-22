import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ownGitHistory } from '../electron/git-history';
import { MemoryService } from '../electron/memory';
import { metadataSchema } from '../src/shared/library';
import { eventContext, localDate, type MemoryEvent } from '../src/shared/memory';

const exec = promisify(execFile);
test('only exact configured authors enter Git memory and reports with real dates and stable IDs', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-own-git-')));
  const projects = path.join(temp, 'projects'), repository = path.join(projects, 'App');
  const email = 'me+work@example.invalid';
  const git = async (args: string[], env: Partial<NodeJS.ProcessEnv> = {}) => (await exec('git', ['-C', repository, ...args], { env: { ...process.env, ...env } })).stdout.trim();
  let reportEvents: MemoryEvent[] = [];
  try {
    await mkdir(repository, { recursive: true });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Me']); await git(['config', 'user.email', email]);
    const commit = async (message: string, author: string, date: string) => {
      await git(['commit', '--allow-empty', '-qm', message], { GIT_AUTHOR_NAME: 'Shared name', GIT_AUTHOR_EMAIL: author, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: '2026-09-01T11:00:00+08:00' });
      return git(['rev-parse', 'HEAD']);
    };
    const first = await commit('My first change', email, '2020-01-02T10:11:12+08:00');
    await commit('Coworker change committed by me', 'other@example.invalid', '2020-01-02T11:00:00+08:00');
    await commit('Email substring must not match', `not-${email}`, '2020-01-02T12:00:00+08:00');
    const second = await commit('My second change', email, '2020-01-02T13:14:15+08:00');
    await git(['checkout', '-qb', 'colleague']);
    await commit('Colleague branch', 'other@example.invalid', '2020-01-02T14:00:00+08:00');
    await git(['checkout', '-q', 'main']);
    await git(['merge', '--no-ff', '-qm', 'Merge colleague branch', 'colleague']);
    const page1 = await ownGitHistory(repository, 1, 1);
    const page2 = await ownGitHistory(repository, 2, 1, page1.revision);
    assert.equal(page1.total, 2);
    assert.deepEqual([page1.items[0].hash, page2.items[0].hash], [second, first]);
    assert.equal(page1.items[0].date, '2020-01-02T13:14:15+08:00');
    await writeFile(path.join(repository, 'CHANGELOG.md'), '- Coworker release note without a date');

    const memory = await new MemoryService(path.join(temp, 'storage'), path.resolve('dist-electron'), async request => {
      const input = JSON.parse(await readFile(path.join(request.directory, 'input.json'), 'utf8'));
      reportEvents = input.events;
      return { items: [{ summary: '个人项目进展', details: input.events.map((event: MemoryEvent) => ({ text: event.message, evidenceIds: [event.id] })) }] };
    }).init();
    const source = { id: randomUUID(), kind: 'projects' as const, name: 'Projects', directory: projects, scan: true, excludes: [] };
    await memory.saveConfig({ ...memory.config, initialized: true, sources: [source] });
    const store = memory.libraryStore(source.id);
    await store.save(repository, metadataSchema.parse({ schemaVersion: 1, kind: 'project', name: '中文项目' }));
    await store.record(repository, 'Git pull completed', 'app', false);
    const date = localDate(new Date('2020-01-02T13:14:15+08:00'));
    let taskId = memory.report(date); await memory.idle();
    assert.equal(memory.snapshot().tasks.find(task => task.id === taskId)?.status, 'success');
    assert.equal(reportEvents.length, 2);
    assert.ok(reportEvents.every(event => event.origin === 'git' && event.git?.email === email));
    assert.deepEqual(new Set(reportEvents.map(event => event.occurredAt)), new Set(['2020-01-02T10:11:12+08:00', '2020-01-02T13:14:15+08:00']));
    const ids = memory.events({ origin: 'git' }).items.map(event => event.id);
    taskId = memory.report(date); await memory.idle();
    assert.deepEqual(memory.events({ origin: 'git' }).items.map(event => event.id), ids);
    assert.equal(memory.events({ origin: 'git', kind: 'projects', query: '中文项目' }).total, 2);
    const context = eventContext({ ...reportEvents[0], path: 'App/docs/guide.md' }, [source], memory.snapshot().entities);
    assert.equal(context.name, '中文项目'); assert.equal(context.target, 'docs/guide.md');
    await git(['config', 'user.email', '']);
    await assert.rejects(ownGitHistory(repository), /user.email/);
    const aliases = await ownGitHistory(repository, 1, 20, undefined, undefined, [email, 'other@example.invalid']);
    assert.equal(aliases.total, 4);
    assert.ok(aliases.items.every(item => [email, 'other@example.invalid'].includes(item.email)));
    taskId = memory.report(date); await memory.idle();
    assert.equal(memory.snapshot().tasks.find(task => task.id === taskId)?.status, 'failed');
    await git(['config', 'user.email', 'other@example.invalid']);
    taskId = memory.report(date); await memory.idle();
    assert.equal(memory.snapshot().tasks.find(task => task.id === taskId)?.status, 'success');
    assert.ok(memory.events({ origin: 'git' }).items.every(event => event.git?.email === 'other@example.invalid'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
