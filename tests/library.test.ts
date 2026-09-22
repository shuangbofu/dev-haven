import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LibraryService } from '../electron/library';
import { MemoryService } from '../electron/memory';
import { metadataSchema, gitRemoteSchema } from '../src/shared/library';
const execFile = promisify(execFileCallback);
async function central(storage: string, kind: 'knowledge' | 'projects', directory: string) {
  const memory = await new MemoryService(storage, path.resolve('dist-electron')).init();
  await memory.saveConfig({ ...memory.config, initialized: true, sources: [{ id: randomUUID(), name: kind, kind, directory, scan: true, excludes: [] }] });
  const source = memory.config.sources[0], store = memory.libraryStore(source.id);
  return { service: new LibraryService({ source, store }), memory, source, store };
}

test('library persists roots, browses real metadata, edits with conflicts and records changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-library-'));
  try {
    const docs = path.join(root, '文档'); await mkdir(docs);
    const { service, memory, source } = await central(root, 'knowledge', docs);
    const folder = await service.create('knowledge', '', 'Guide', true);
    await service.create('knowledge', folder, 'intro.md', false);
    await service.saveMetadata({ kind: 'knowledge', path: folder, revision: (await service.browse('knowledge', folder)).current.metadataRevision, metadata: { schemaVersion: 1, kind: 'collection', name: '指南', description: '参考文档', languages: [], tags: [] } });
    assert.equal((await service.browse('knowledge')).entries.find(e => e.path === folder)?.displayName, '指南');
    const first = await service.read('knowledge', 'Guide/intro.md');
    await writeFile(path.join(docs, 'Guide/intro.md'), 'external edit');
    await assert.rejects(service.saveDocument('knowledge', first.path, 'lost update', first.revision), /其他程序修改/);
    const current = await service.read('knowledge', first.path);
    const saved = await service.saveDocument('knowledge', first.path, '# Saved\n', current.revision);
    assert.equal(saved.content, '# Saved\n');
    assert.equal(memory.events({ sourceId: source.id, path: 'Guide/intro.md' }).total, 2);
    await assert.rejects(readFile(path.join(docs, 'CHANGELOG.md')));
    const reopened = await new MemoryService(root, path.resolve('dist-electron')).init();
    assert.equal(reopened.config.sources[0].directory, await realpath(docs));
    for (const name of ['CON', 'a/b', '../escape', 'trailing.', 'C:bad']) await assert.rejects(service.create('knowledge', '', name, true));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('library confines paths and preserves malformed metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-paths-'));
  try {
    const docs = path.join(root, 'docs'); await mkdir(docs);
    const { service } = await central(root, 'knowledge', docs);
    await writeFile(path.join(root, 'outside.md'), 'outside');
    await symlink(path.join(root, 'outside.md'), path.join(docs, 'link.md'));
    for (const name of ['../outside.md', '/outside.md', 'C:\\outside.md', 'link.md']) await assert.rejects(service.read('knowledge', name));
    await writeFile(path.join(docs, '.devhaven.json'), '{bad');
    assert.equal((await service.browse('knowledge')).current.warning, undefined);
    await service.saveMetadata({ kind: 'knowledge', path: '', revision: '', metadata: { schemaVersion: 1, kind: 'collection', name: 'test', description: '', languages: [], tags: [] } });
    assert.equal(await readFile(path.join(docs, '.devhaven.json'), 'utf8'), '{bad');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('projects find grouped and explicitly described projects while excluding dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-projects-'));
  try {
    const projects = path.join(root, 'projects');
    await mkdir(path.join(projects, 'Personal/app/node_modules/fake'), { recursive: true });
    await writeFile(path.join(projects, 'Personal/app/package.json'), '{"description":"My app"}');
    await writeFile(path.join(projects, 'Personal/app/index.ts'), '');
    await writeFile(path.join(projects, 'Personal/app/node_modules/fake/go.mod'), 'module fake');
    const { service, store } = await central(root, 'projects', projects);
    await store.save(await realpath(path.join(projects, 'Personal/app')), metadataSchema.parse({ schemaVersion: 1, kind: 'project', name: 'My app', description: 'My app' }));
    const result = await service.projects();
    assert.deepEqual(result.entries.map(e => ({ path: e.path, description: e.description, languages: e.languages })), [{ path: 'Personal/app', description: 'My app', languages: ['TypeScript'] }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('projects expose portable git status without treating source files as documents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-git-'));
  try {
    const projects = path.join(root, 'projects'), project = path.join(projects, 'repo'); await mkdir(project, { recursive: true });
    await execFile('git', ['-C', project, 'init', '-q']);
    await execFile('git', ['-C', project, 'config', 'user.email', 'test@example.invalid']);
    await execFile('git', ['-C', project, 'config', 'user.name', 'DevHaven Test']);
    await writeFile(path.join(project, 'README.md'), '# Git project\n');
    await execFile('git', ['-C', project, 'add', '.']); await execFile('git', ['-C', project, 'commit', '-qm', 'initial']); await execFile('git', ['-C', project, 'branch', '-M', 'main']);
    const { service, store } = await central(root, 'projects', projects);
    await store.save(await realpath(project), metadataSchema.parse({ schemaVersion: 1, kind: 'project', name: 'Git project', git: { remote: 'https://github.com/example/repo.git', provider: 'github' } }));
    const entry = (await service.projects()).entries[0];
    assert.equal(entry.git?.provider, 'github'); assert.equal(entry.git?.branch, 'main'); assert.equal(entry.git?.dirty, false); assert.match(entry.git?.commit ?? '', /^[0-9a-f]{40}$/);
    await execFile('git', ['-C', project, 'remote', 'add', 'origin', `https://${['user', 'secret'].join(':')}@github.com/example/repo.git?token=hidden`]);
    const remoteEntry = (await service.projects()).entries[0];
    assert.equal(remoteEntry.git?.remote, 'https://github.com/example/repo.git');
    assert.equal(remoteEntry.git?.webUrl, 'https://github.com/example/repo');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Git import and repeated pulls preserve source files and central history', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'devhaven-git-workflow-'));
  const source = path.join(temp, 'source'), projects = path.join(temp, 'projects'), group = path.join(projects, 'Personal');
  const git = async (directory: string, ...args: string[]) => (await execFile('git', ['-C', directory, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(temp, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
  const server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname).replace(/^\/+/, '');
      if (relative.split('/').includes('..')) throw new Error('Invalid fixture path');
      const content = await readFile(path.join(source, '.git', relative));
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  try {
    await mkdir(source); await mkdir(group, { recursive: true });
    await git(source, 'init', '-q', '-b', 'main');
    await git(source, 'config', 'user.name', 'DevHaven Test'); await git(source, 'config', 'user.email', 'test@example.invalid');
    const metadata = { schemaVersion: 1, kind: 'project', name: 'Portable project', description: 'Preserve this description', tags: ['fixture'], languages: ['TypeScript'], launch: { command: 'npm', args: ['run', 'dev'] } };
    await writeFile(path.join(source, '.devhaven.json'), JSON.stringify(metadata));
    await writeFile(path.join(source, 'README.md'), '# Portable project\n\nProject contents.');
    await writeFile(path.join(source, 'index.ts'), 'export const version = 1;');
    await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'Initial'); await git(source, 'update-server-info');
    await writeFile(path.join(group, '.devhaven.json'), JSON.stringify({ schemaVersion: 1, kind: 'collection', name: 'Personal' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const { service, memory } = await central(temp, 'projects', projects);
    const entry = await service.cloneProject(remote, 'Example', 'Personal');
    const target = path.join(group, 'Example');
    assert.equal(entry.path, 'Personal/Example'); assert.equal(entry.displayName, 'Example');
    assert.equal(entry.metadata?.launch, undefined); assert.equal(entry.git?.branch, 'main');
    assert.match((await service.projectReadme(entry.path))!.content, /Project contents/);
      await assert.rejects(readFile(path.join(target, 'CHANGELOG.md')));
      assert.equal(entry.registration, 'git');
      assert.equal(await git(target, 'status', '--porcelain'), '');
      assert.deepEqual(JSON.parse(await readFile(path.join(target, '.devhaven.json'), 'utf8')), metadata);
      assert.ok(entry.changelog.some(item => item.message.includes('导入')));
    assert.ok(memory.events({}).items.every(event => !event.reportable));
    const listing = await service.projects();
    assert.deepEqual(listing.groups.map(item => item.path), ['', 'Personal']);
    assert.ok(listing.groups.every(item => item.changelog.some(event => event.message.includes('导入'))));
    await assert.rejects(service.cloneProject(remote, 'Example', 'Personal'), /已存在/);
    assert.equal(await readFile(path.join(target, 'index.ts'), 'utf8'), 'export const version = 1;');
    await writeFile(path.join(target, 'keep.txt'), 'local content');
    for (const version of [2, 3]) {
      await writeFile(path.join(source, 'index.ts'), `export const version = ${version};`);
      await git(source, 'add', '.'); await git(source, 'commit', '-qm', `Version ${version}`); await git(source, 'update-server-info');
      const pulled = await service.pullProject(entry.path);
      assert.equal(pulled.git?.commit, await git(source, 'rev-parse', 'HEAD'));
      assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'local content');
      assert.ok(pulled.changelog.some(item => item.message.includes('Git 更新完成')));
    }
    await writeFile(path.join(target, 'index.ts'), 'local uncommitted code');
    await writeFile(path.join(source, 'index.ts'), 'remote conflicting code');
    await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'Conflicting change'); await git(source, 'update-server-info');
    const before = await git(target, 'rev-parse', 'HEAD');
    await assert.rejects(service.pullProject(entry.path), /Git 更新失败/);
    assert.equal(await git(target, 'rev-parse', 'HEAD'), before);
    assert.equal(await readFile(path.join(target, 'index.ts'), 'utf8'), 'local uncommitted code');
    assert.ok((await service.projects()).groups.every(group => group.changelog.some(item => item.message.includes('Git 更新失败'))));
    for (const invalid of ['../escape', 'C:\\escape', '/absolute', 'CON', 'trailing.', 'a/b']) await assert.rejects(service.cloneProject(remote, invalid, 'Personal'));
    await assert.rejects(service.cloneProject(remote, 'Escape', '..'));
    const missing = remote + 'missing';
    await assert.rejects(service.cloneProject(missing, 'Missing', 'Personal'), /导入失败/);
    await assert.rejects(readFile(path.join(group, 'Missing', '.devhaven.json')));
    await git(target, 'config', 'user.email', 'test@example.invalid');
    const initialHistory = await service.gitHistory(entry.path);
    assert.equal(initialHistory.total, 3);
    assert.deepEqual(initialHistory.items.map(item => item.message), ['Version 3', 'Version 2', 'Initial']);
    await git(target, 'config', 'user.name', 'Pagination Test');
    await git(target, 'config', 'user.email', 'test@example.invalid');
    for (let index = 0; index < 22; index++) await git(target, 'commit', '--allow-empty', '-qm', `Page test ${index}`);
    const firstPage = await service.gitHistory(entry.path);
    assert.equal(firstPage.total, 25); assert.equal(firstPage.items.length, 20);
    await git(target, 'commit', '--allow-empty', '-qm', 'Newer commit');
    const secondPage = await service.gitHistory(entry.path, 2, firstPage.revision);
    assert.equal(secondPage.total, 25); assert.equal(secondPage.items.length, 5);
    assert.ok(secondPage.items.every(item => !firstPage.items.some(previous => previous.hash === item.hash)));
    assert.equal((await service.gitHistory(entry.path, 999, firstPage.revision)).page, 2);
    await assert.rejects(service.gitHistory('Personal'), /项目/);
    await assert.rejects(service.gitHistory('../escape'));
    await assert.rejects(service.gitHistory(entry.path, 0));
    await assert.rejects(service.gitHistory(entry.path, 1, '--all'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});

test('Git addresses reject credentials, command protocols and platform-specific paths', () => {
  for (const value of ['https://github.com/org/repo.git', 'git@code.example:team/project.git', 'ssh://git@code.example:2222/team/repo.git']) assert.equal(gitRemoteSchema.safeParse(value).success, true);
  for (const value of ['ext::sh -c command', '--upload-pack=command', 'C:\\repo', '/tmp/repo', 'https://token@github.com/org/repo', 'https://example.org/repo?token=secret', 'ssh://git:secret@code.example/repo']) assert.equal(gitRemoteSchema.safeParse(value).success, false, value);
});

test('destination validation confines creation to configured roots and detects stale selections', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-destination-')));
  try {
    const root = path.join(temp, 'knowledge'), sibling = path.join(temp, 'knowledge-other'), projects = path.join(temp, 'projects');
    await Promise.all([mkdir(root), mkdir(sibling), mkdir(projects)]);
    const configured = await central(path.join(temp, 'settings'), 'knowledge', root);
    let service = configured.service;
    assert.deepEqual(await service.destination('knowledge', root), { root, path: '', absolutePath: root });
    const collection = await service.create('knowledge', '', '中文 集合', true, root);
    const target = await service.destination('knowledge', path.join(root, collection));
    assert.equal(target.path, collection);
    assert.equal((await service.overview()).collections[0].displayName, '中文 集合');
    assert.equal((await service.browse('knowledge', collection)).current.metadata?.kind, 'collection');
    await assert.rejects(service.create('knowledge', '', '中文 集合', true, root), /exist|存在/i);
    for (const name of ['node_modules', 'CON', 'trailing.', '../outside']) await assert.rejects(service.create('knowledge', '', name, true, root));
    await assert.rejects(readFile(path.join(target.absolutePath, '.devhaven.json')));
    await service.create('knowledge', target.path, '笔记.md', false, target.root);
    assert.match(await readFile(path.join(target.absolutePath, '笔记.md'), 'utf8'), /笔记/);
    const htmlPath = await service.create('knowledge', target.path, '页面.html', false, target.root);
    const html = await service.read('knowledge', htmlPath);
    assert.equal(html.format, 'html');
    assert.match(html.content, /<!doctype html>/);
    const savedHTML = await service.saveDocument('knowledge', htmlPath, '<h1>已更新</h1>', html.revision);
    assert.equal(savedHTML.content, '<h1>已更新</h1>');
    assert.ok((await service.overview()).documents.some(entry => entry.path === htmlPath));
    await assert.rejects(service.destination('knowledge', sibling), /必须位于/);
    await assert.rejects(service.destination('knowledge', projects), /必须位于/);
    await assert.rejects(service.destination('knowledge', path.join(target.absolutePath, '笔记.md')), /请选择目录/);
    await symlink(sibling, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.destination('knowledge', path.join(root, 'escape')), /必须位于/);
    await assert.rejects(service.create('knowledge', 'escape', 'bad.md', false, root), /符号链接/);
    await assert.rejects(service.create('knowledge', '../knowledge-other', 'bad.md', false, root), /无效/);
    await configured.memory.saveConfig({ ...configured.memory.config, sources: [{ ...configured.source, directory: sibling }] });
    service = new LibraryService({ source: configured.memory.config.sources[0], store: configured.memory.libraryStore(configured.source.id) });
    await assert.rejects(service.create('knowledge', '', 'wrong-root.md', false, root), /设置已变化/);
    await assert.rejects(readFile(path.join(sibling, 'wrong-root.md')));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('destination folders stay inside the selected root and create in an ordinary nested folder', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-roots-')));
  try {
    const first = path.join(temp, 'first'), second = path.join(temp, 'second');
    await mkdir(first); await mkdir(path.join(second, '分组', '子目录'), { recursive: true });
    await mkdir(path.join(second, '.hidden')); await mkdir(path.join(second, 'node_modules')); await mkdir(path.join(second, 'excluded'));
    await symlink(first, path.join(second, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const { memory, source } = await central(path.join(temp, 'storage'), 'knowledge', first);
    const other = { ...source, id: randomUUID(), name: '第二根目录', directory: second, excludes: ['excluded'] };
    await memory.saveConfig({ ...memory.config, sources: [source, other] });
    const selected = new LibraryService({ source: other, store: memory.libraryStore(other.id) });
    const listing = await selected.destinationFolders('knowledge', '');
    assert.equal(listing.current.root, second);
    assert.deepEqual(listing.folders.map(item => item.path), ['分组']);
    const nested = await selected.destinationFolders('knowledge', '分组/子目录');
    assert.equal(nested.current.absolutePath, path.join(second, '分组', '子目录'));
    const created = await selected.create('knowledge', nested.current.path, '新知识库', true, nested.current.root);
    assert.equal(created, '分组/子目录/新知识库');
    assert.equal((await selected.browse('knowledge', created)).current.metadata?.kind, 'collection');
    await assert.rejects(readFile(path.join(first, '新知识库')));
    for (const invalid of ['../first', 'link', 'excluded']) await assert.rejects(selected.destinationFolders('knowledge', invalid));
    await assert.rejects(selected.create('knowledge', '', 'wrong', true, first), /设置已变化/);
    const projectSource = { ...other, id: randomUUID(), kind: 'projects' as const, directory: first, excludes: [] };
    await memory.saveConfig({ ...memory.config, sources: [other, projectSource] });
    await mkdir(path.join(first, 'existing'));
    const store = memory.libraryStore(projectSource.id);
    await store.save(path.join(first, 'existing'), metadataSchema.parse({ schemaVersion: 1, kind: 'project', name: '已有项目' }));
    const projects = new LibraryService({ source: projectSource, store });
    assert.deepEqual((await projects.destinationFolders('projects', '')).folders, []);
    await assert.rejects(projects.destinationFolders('projects', 'existing'), /已有项目/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('source documents read and save safely with explicit languages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-source-files-'));
  try {
    const docs = path.join(root, 'docs'); await mkdir(docs);
    const { service } = await central(root, 'knowledge', docs);
    for (const [extension, language, content] of [
      ['json', 'json', '{"enabled":true}'], ['css', 'css', 'body { color:red }'],
      ['js', 'javascript', 'const x = 1;'], ['ts', 'typescript', 'const x: number = 1;'],
      ['java', 'java', 'class Main {}'], ['go', 'go', 'package main'],
      ['rs', 'rust', 'fn main() {}'], ['py', 'python', '# Heading\nprint("hello")'],
    ]) {
      const file = `example.${extension}`;
      await writeFile(path.join(docs, file), content);
      const document = await service.read('knowledge', file);
      assert.equal(document.format, 'code'); assert.equal(document.language, language);
      assert.equal(document.content, content);
      const saved = await service.saveDocument('knowledge', file, content + '\n', document.revision);
      assert.equal(saved.language, language); assert.equal(await readFile(path.join(docs, file), 'utf8'), content + '\n');
    }
    assert.equal((await service.browse('knowledge')).entries.find(e => e.name === 'example.py')?.documentTitle, undefined);
    await writeFile(path.join(docs, 'binary.ts'), Buffer.from([0, 1, 2]));
    await assert.rejects(service.read('knowledge', 'binary.ts'), /二进制/);
    await writeFile(path.join(docs, 'large.py'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(service.read('knowledge', 'large.py'), /文件过大/);
    await symlink(path.join(root, 'outside.py'), path.join(docs, 'link.py'));
    await writeFile(path.join(root, 'outside.py'), 'secret');
    await assert.rejects(service.read('knowledge', 'link.py'));
    await assert.rejects(service.resolve('knowledge', '../outside.py'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
