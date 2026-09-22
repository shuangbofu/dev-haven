import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installIcons, loadIcons, validateIcon } from '../electron/local-icons';
import { downloadIcon } from '../electron/icon-download';
import { MemoryService } from '../electron/memory';
import { findIcon, type IconImport } from '../src/shared/technology-icons';
import { TechnologyIcons, LanguageLogo } from '../src/components/technology-icons';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#e6526f" d="M0 0h24v24H0z"/></svg>');
const icon = (fields: Partial<IconImport> = {}): IconImport => ({ type: 'icon', version: 1, id: randomUUID(), name: 'Example Engine', aliases: ['Example'], sourceUrl: 'https://example.org/logo.svg', data: svg.toString('base64'), ...fields });
const exec = promisify(execFile);

test('local icons persist aliases, render offline and survive copying the memory directory', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-icons-')));
  try {
    const memory = await new MemoryService(path.join(temp, 'storage'), path.resolve('dist-electron')).init();
    assert.ok(findIcon(memory.snapshot().icons, 'TypeScript'));
    const payload = icon();
    await memory.acceptIcon(payload); await memory.acceptIcon(payload);
    assert.equal(memory.snapshot().icons.filter(item => item.name === payload.name).length, 1);
    assert.equal(memory.events({}).total, 0);
    const cached = findIcon(memory.snapshot().icons, 'example')!;
    assert.equal(cached.name, 'Example Engine');
    assert.ok(cached.dataUrl.startsWith('data:image/svg+xml;base64,'));
    const html = renderToStaticMarkup(React.createElement(TechnologyIcons.Provider, { value: memory.snapshot().icons }, React.createElement(LanguageLogo, { language: 'Example' })));
    assert.match(html, /src="data:image\/svg\+xml;base64,/);
    assert.ok(!html.includes('https://example.org'));
    await memory.saveConfig({ ...memory.config, directory: path.join(temp, 'moved') });
    const reopened = await new MemoryService(memory.storage, path.resolve('dist-electron')).init();
    assert.deepEqual(findIcon(reopened.snapshot().icons, 'Example'), cached);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('icon imports reject active SVG, oversized payloads, alias conflicts and file symlinks', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'devhaven-icon-validation-'));
  try {
    for (const content of ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>', '<svg><image href="https://example.org/x"/></svg>', '<svg><path style="fill:url(https://example.org/x)"/></svg>', '<!DOCTYPE svg><svg></svg>', '<html>not an icon</html>']) assert.throws(() => validateIcon(Buffer.from(content)));
    assert.throws(() => validateIcon(Buffer.alloc(513 * 1024)));
    await installIcons(temp, [icon()]);
    await assert.rejects(installIcons(temp, [icon({ name: 'Unrelated', aliases: ['example'] })]), /别名/);
    const file = (await readdir(path.join(temp, 'icons'))).find(name => name.endsWith('.svg'))!;
    await rm(path.join(temp, 'icons', file)); await writeFile(path.join(temp, 'outside.svg'), svg);
    await symlink(path.join(temp, 'outside.svg'), path.join(temp, 'icons', file));
    await assert.rejects(loadIcons(temp), /无效/);
    await assert.rejects(installIcons(temp, [icon()]), /冲突/);
    for (const url of ['http://example.org/logo.svg', 'https://127.0.0.1/logo.svg', 'https://[::1]/logo.svg', 'https://192.168.1.1/logo.svg']) await assert.rejects(downloadIcon(url));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('CLI queues downloaded icons and the application accepts a receipt without work events', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-icon-client-')));
  try {
    const memory = await new MemoryService(path.join(temp, 'storage'), path.resolve('dist-electron')).init();
    const file = path.join(temp, 'logo.svg'); await writeFile(file, svg);
    const context = JSON.parse((await exec(process.execPath, ['dist-electron/memory-client.cjs', 'context', '--memory-dir', memory.config.directory])).stdout);
    assert.equal(context.iconsDirectory, path.join(memory.config.directory, 'icons'));
    const queued = JSON.parse((await exec(process.execPath, ['dist-electron/memory-client.cjs', 'icon', '--name', 'New Engine', '--aliases', 'Engine', '--source', 'https://example.org/logo.svg', '--file', file, '--memory-dir', memory.config.directory])).stdout);
    await memory.consumeInbox();
    assert.deepEqual(JSON.parse(await readFile(queued.receipt, 'utf8')), { accepted: true });
    assert.ok(findIcon(memory.snapshot().icons, 'engine'));
    assert.equal(memory.events({}).total, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('scans discover missing technology icons separately and reuse the downloaded file', async () => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-icon-scan-')));
  let searches = 0, downloads = 0, unavailable = false;
  try {
    const projects = path.join(temp, 'projects'); await mkdir(path.join(projects, 'Game'), { recursive: true });
    await writeFile(path.join(projects, 'Game/package.json'), '{"name":"game"}');
    const memory = await new MemoryService(path.join(temp, 'storage'), path.resolve('dist-electron'), async request => {
      const input = JSON.parse(await readFile(path.join(request.directory, 'input.json'), 'utf8'));
      if (request.webSearch) { searches++; assert.deepEqual(Object.keys(input), ['technologies']); return { icons: [{ name: input.technologies[0], aliases: [], sourceUrl: 'https://example.org/logo.svg' }] }; }
      return { entities: [{ path: 'Game', kind: 'project', name: '测试游戏', description: '用于验证游戏工程登记', languages: ['Example Engine'], tags: [], evidence: ['Game/package.json'] }], changes: [] };
    }, async () => { downloads++; if (unavailable) throw new Error('Unavailable'); return svg; }).init();
    const source = { id: randomUUID(), name: 'Projects', kind: 'projects' as const, directory: projects, scan: true, excludes: [] };
    await memory.saveConfig({ ...memory.config, initialized: true, sources: [source] });
    let id = memory.scan(source.id); await memory.idle();
    assert.equal(memory.snapshot().tasks.find(task => task.id === id)?.status, 'success');
    assert.ok(findIcon(memory.snapshot().icons, 'Example Engine'));
    id = memory.scan(source.id); await memory.idle();
    assert.equal(searches, 1); assert.equal(downloads, 1);
    assert.equal(memory.events({}).total, 0);
    const entity = memory.snapshot().entities.find(item => item.path === 'Game')!;
    await memory.libraryStore(source.id).save(path.join(projects, 'Game'), { ...entity.metadata, languages: ['Unavailable Engine'] });
    unavailable = true; id = memory.scan(source.id); await memory.idle();
    assert.equal(memory.snapshot().tasks.find(task => task.id === id)?.status, 'success');
    assert.ok(memory.snapshot().tasks.find(task => task.id === id)?.logs.some(log => log.includes('图标未保存')));
    assert.equal(memory.snapshot().entities.find(item => item.path === 'Game')?.metadata.name, '测试游戏');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
