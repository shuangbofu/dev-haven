declare const __DEVHAVEN_RELEASE_SOURCE__: import('../src/shared/application').ReleaseSource | null;
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { editorURL } from './editor-url';
import { restrictDocumentNavigation } from './document-security';
import { z } from 'zod';
import { EnvironmentService } from './service';
import { clearOldTerminalScripts, TerminalManager } from './terminal';
import { toolIdSchema, versionSchema } from '../src/shared/manifest';
import { ShellIntegration } from './shell-integration';
import { readWindowState, restoreWindowState, trackWindowState } from './window-state';
import { LibraryService } from './library';
import { metadataSchema } from '../src/shared/library';
import { MemoryService } from './memory';
import { SearchWorkerClient } from './search-worker-client';
import { ApplicationSettings } from './application';
import { preferencesSchema } from '../src/shared/application';
import { searchQuerySchema } from '../src/shared/search';
import { eventQuerySchema, memoryConfigSchema, reportPeriodSchema } from '../src/shared/memory';

let window: BrowserWindow | undefined;
let service: EnvironmentService;
let terminals: TerminalManager;
let globalShell: ShellIntegration;
let memory: MemoryService;
const globalSearch = new SearchWorkerClient(__dirname);
let application: ApplicationSettings;
let indexTimer: ReturnType<typeof setInterval> | undefined;
let indexDebounce: ReturnType<typeof setTimeout> | undefined;
let updateTimer: ReturnType<typeof setInterval> | undefined;
let indexedEntities = '';
const refreshIndex = () => globalSearch.rebuild(memory.config, memory.snapshot().entities).catch(error => console.error('Search index:', String(error)));
const scheduleIndex = () => { if (indexDebounce) clearTimeout(indexDebounce); indexDebounce = setTimeout(() => { void refreshIndex(); }, 1000); };
const libraries = new Map<string, LibraryService>();
nativeTheme.themeSource = 'system';
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#09090b' : '#ffffff';
nativeTheme.on('updated', () => { if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground()); });
const devURL = !app.isPackaged ? process.env.DEVHAVEN_DEV_URL : undefined;
const pagePath = path.join(__dirname, '../out/index.html');
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    const root = !app.isPackaged && process.env.DEVHAVEN_TEST_HOME ? path.resolve(process.env.DEVHAVEN_TEST_HOME) : path.join(app.getPath('home'), '.devHaven');
    service = await new EnvironmentService(root).init();
    memory = await new MemoryService(root, __dirname).init();
    application = await new ApplicationSettings(root, app.getVersion(), __DEVHAVEN_RELEASE_SOURCE__ ?? undefined).init();
    nativeTheme.themeSource = application.snapshot().preferences.theme;
    application.on('change', state => { nativeTheme.themeSource = state.preferences.theme; if (window && !window.isDestroyed()) window.webContents.send('devhaven:application-change', state); });
    void refreshIndex();
    indexTimer = setInterval(() => { void refreshIndex(); }, 60_000);
    const autoUpdate = () => { if (application.snapshot().preferences.updates.automatic) void application.check(); };
    autoUpdate(); updateTimer = setInterval(autoUpdate, 6 * 60 * 60 * 1000);
    let memoryUpdate: ReturnType<typeof setTimeout> | undefined;
    memory.on('change', () => {
      const signature = JSON.stringify(memory.snapshot().entities.map(entity => [entity.id, entity.revision]));
      if (signature !== indexedEntities) { indexedEntities = signature; scheduleIndex(); }
      if (memoryUpdate) return;
      memoryUpdate = setTimeout(() => { memoryUpdate = undefined; if (window && !window.isDestroyed()) window.webContents.send('devhaven:memory-change', memory.snapshot()); }, 120);
    });
    const testHome = !app.isPackaged && process.env.DEVHAVEN_TEST_HOME ? root : undefined;
    globalShell = new ShellIntegration(root, testHome ? {
      home: testHome,
      zdotdir: process.env.DEVHAVEN_TEST_ZDOTDIR ?? testHome,
      configHome: process.env.DEVHAVEN_TEST_CONFIG_HOME ?? path.join(testHome, '.config'),
      shell: process.env.DEVHAVEN_TEST_SHELL,
    } : { home: app.getPath('home') });
    terminals = new TerminalManager(service, event => { if (window && !window.isDestroyed()) window.webContents.send('devhaven:terminal-event', event); });
    await clearOldTerminalScripts(service.root);
    registerHandlers();
    service.on('change', snapshot => { if (window && !window.isDestroyed()) window.webContents.send('devhaven:change', snapshot); });
    service.on('storage-error', error => { void dialog.showMessageBox({ type: 'error', title: '无法保存状态', message: String(error) }); });
    createWindow();
    memory.start();
    void service.scan();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { dialog.showErrorBox('DevHaven 启动失败', String(error)); app.quit(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { terminals?.dispose(); memory?.stop(); globalSearch.dispose(); clearInterval(indexTimer); clearInterval(updateTimer); clearTimeout(indexDebounce); });
let canQuit = false;
app.on('before-quit', event => {
  if (canQuit || !service?.tasks.some(t => t.status === 'running' || t.status === 'queued')) return;
  event.preventDefault();
  void dialog.showMessageBox({ type: 'info', buttons: ['继续运行', '完成后退出'], defaultId: 0, cancelId: 0,
    title: '还有环境任务正在执行', message: '安装任务需要继续运行。你可以等待任务完成后自动退出。' }).then(async ({ response }) => {
    if (response === 1) { await service.idle(); canQuit = true; app.quit(); }
  });
});
function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const state = restoreWindowState(readWindowState(stateFile), screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea);
  window = new BrowserWindow({ ...state.bounds, minWidth: state.minWidth, minHeight: state.minHeight, backgroundColor: windowBackground(), frame: true, titleBarStyle: 'default', show: false,
    title: 'DevHaven', autoHideMenuBar: true, icon: path.join(__dirname, '../out/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  const created = window;
  trackWindowState(created, stateFile, state);
  window.once('ready-to-show', () => { if (state.maximized) created.maximize(); created.show(); });
  window.on('closed', () => terminals?.dispose());
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) dialog.showErrorBox('页面加载失败', `${description}\n${url}\n请重新构建后启动客户端。`);
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => dialog.showErrorBox('桌面接口加载失败', error.message));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  restrictDocumentNavigation(window.webContents);
  window.webContents.on('will-navigate', (event, url) => { if (url !== (devURL ?? pathToFileURL(pagePath).href)) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devURL
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:3000; font-src 'self' data:"
      : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'self'"
    ] } });
  });
  if (devURL) void window.loadURL(devURL); else void window.loadFile(pagePath);
}
function registerHandlers() {
  const handle = (name: string, action: (value: unknown) => unknown) => ipcMain.handle(`devhaven:${name}`, (event, value) => {
    const sender = event.senderFrame;
    const expected = devURL ?? pathToFileURL(pagePath).href;
    if (!window || event.sender !== window.webContents || !sender || sender !== event.sender.mainFrame || new URL(sender.url).origin !== new URL(expected).origin || (!devURL && sender.url.split('#')[0] !== expected)) throw new Error('不受信任的调用来源');
    return action(value);
  });
  handle('application', () => application.snapshot());
  handle('application-save', value => application.save(preferencesSchema.parse(value)));
  handle('update-check', () => application.check());
  handle('search-status', () => globalSearch.status());
  handle('search-rebuild', async () => { await globalSearch.rebuild(memory.config, memory.snapshot().entities); return globalSearch.status(); });
  handle('snapshot', () => service.snapshot());
  handle('search', value => globalSearch.search(searchQuerySchema.parse(value), memory.config));
  handle('search-cancel', () => globalSearch.cancel());
  handle('memory-snapshot', async () => { await memory.consumeInbox(); return memory.snapshot(); });
  handle('memory-events', input => memory.events(eventQuerySchema.parse(input)));
  handle('memory-config', async value => {
    const result = await memory.saveConfig(memoryConfigSchema.parse(value)); libraries.clear(); scheduleIndex();
    if (result.config.initialized && result.config.autoScan) for (const source of result.config.sources.filter(item => item.scan)) memory.scan(source.id);
    return result;
  });
  handle('memory-choose', async value => {
    const purpose = z.enum(['source', 'memory', 'reports', 'agent']).parse(value);
    const result = await dialog.showOpenDialog(window!, { title: purpose === 'agent' ? '选择 Codex 可执行文件' : '选择目录', properties: purpose === 'agent' ? ['openFile'] : ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('memory-scan', value => memory.scan(z.string().uuid().parse(value)));
  handle('memory-cancel', value => memory.cancel(z.string().uuid().parse(value)));
  handle('memory-report', value => { const data = z.object({ date: z.string(), period: reportPeriodSchema }).strict().parse(value); return memory.report(data.date, data.period); });
  handle('memory-save-report', value => { const data = z.object({ id: z.string().uuid(), content: z.string().max(2_000_000), revision: z.string().length(64) }).strict().parse(value); return memory.saveReport(data.id, data.content, data.revision); });
  handle('memory-reveal', async value => {
    const target = z.enum(['memory', 'reports', 'skill']).parse(value);
    const error = await shell.openPath(target === 'memory' ? memory.config.directory : target === 'reports' ? memory.config.reportsDirectory : memory.snapshot().skillDirectory);
    if (error) throw new Error(error);
  });
  handle('library-call', async value => {
    const call = z.object({ sourceId: z.string().uuid(), operation: z.string(), input: z.record(z.string(), z.unknown()).optional() }).strict().parse(value);
    const source = memory.config.sources.find(item => item.id === call.sourceId);
    if (!source) throw new Error('来源已移除，请重新选择');
    let library = libraries.get(source.id);
    if (!library) { library = new LibraryService({ source, store: memory.libraryStore(source.id) }); libraries.set(source.id, library); }
    const input = call.input ?? {}, location = z.object({ path: z.string().max(4096) }).strict();
    const changed = async <T>(work: Promise<T>): Promise<T> => { try { return await work; } finally { scheduleIndex(); } };
    switch (call.operation) {
      case 'settings': return library.getSettings();
      case 'browse': return library.browse(source.kind, location.parse(input).path);
      case 'overview': if (source.kind !== 'knowledge') throw new Error('来源类型不匹配'); return library.overview();
      case 'projects': if (source.kind !== 'projects') throw new Error('来源类型不匹配'); return library.projects();
      case 'history': {
        const data = z.object({ path: z.string().max(4096), query: z.unknown() }).strict().parse(input);
        await library.resolve(source.kind, data.path);
        return memory.events({ ...eventQuerySchema.parse(data.query), sourceId: source.id, path: data.path });
      }
      case 'git-history': {
        if (source.kind !== 'projects') throw new Error('来源类型不匹配');
        const data = location.extend({ page: z.number().int().min(1).max(1000000), revision: z.string().regex(/^[a-f0-9]{40,64}$/).optional() }).parse(input);
        return library.gitHistory(data.path, data.page, data.revision);
      }
      case 'read': return library.read(source.kind, location.parse(input).path);
      case 'metadata': { const data = location.extend({ metadata: metadataSchema, revision: z.string().max(64) }).parse(input); return changed(library.saveMetadata({ ...data, kind: source.kind })); }
      case 'save': { const data = location.extend({ content: z.string().max(2 * 1024 * 1024), revision: z.string().max(64) }).parse(input); return changed(library.saveDocument(source.kind, data.path, data.content, data.revision)); }
      case 'create': { const data = location.extend({ name: z.string().max(120), directory: z.boolean(), expectedRoot: z.string().max(4096).optional() }).parse(input); return changed(library.create(source.kind, data.path, data.name, data.directory, data.expectedRoot)); }
      case 'destination-folders': return library.destinationFolders(source.kind, location.parse(input).path);
      case 'reveal': { const target = await library.resolve(source.kind, location.parse(input).path); if ((await stat(target)).isDirectory()) { const error = await shell.openPath(target); if (error) throw new Error(error); } else shell.showItemInFolder(target); return; }
      case 'readme': if (source.kind !== 'projects') throw new Error('来源类型不匹配'); return library.projectReadme(location.parse(input).path);
      case 'pull': if (source.kind !== 'projects') throw new Error('来源类型不匹配'); return changed(library.pullProject(location.parse(input).path));
      case 'clone': { if (source.kind !== 'projects') throw new Error('来源类型不匹配'); const data = z.object({ remote: z.string().max(2000), name: z.string().max(120), parent: z.string().max(4096), expectedRoot: z.string().max(4096).optional() }).strict().parse(input); return changed(library.cloneProject(data.remote, data.name, data.parent, data.expectedRoot)); }
      case 'open-document': {
        const target = await library.resolve(source.kind, location.parse(input).path);
        if (!(await stat(target)).isFile()) throw new Error('请选择文档文件');
        await shell.openExternal(editorURL(target));
        return;
      }
      case 'open-project': {
        if (source.kind !== 'projects') throw new Error('来源类型不匹配');
        const data = location.extend({ target: z.enum(['finder', 'vscode']) }).parse(input), target = await library.resolve('projects', data.path);
        if (data.target === 'finder') { const error = await shell.openPath(target); if (error) throw new Error(error); } else await shell.openExternal(editorURL(target));
        return;
      }
      default: throw new Error('不支持的资料操作');
    }
  });
  handle('open-link', value => { const url = new URL(z.string().max(8192).parse(value)); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP(S) 链接'); return shell.openExternal(url.href); });
  handle('shell-status', () => globalShell.status());
  handle('shell-enabled', value => globalShell.setEnabled(z.boolean().parse(value)));
  handle('bootstrap', () => service.bootstrap());
  handle('scan', () => service.scan());
  handle('versions', value => service.versions(toolIdSchema.parse(value)));
  handle('install', value => { const data = z.object({ tool: toolIdSchema, version: versionSchema }).strict().parse(value); return service.install(data.tool, data.version); });
  handle('default', value => service.setDefault(z.uuid().parse(value)));
  handle('uninstall', async value => {
    const id = z.uuid().parse(value); const item = service.findInstallation(id);
    const result = await dialog.showMessageBox(window!, { type: 'warning', title: '卸载受管环境', message: `卸载 ${item.tool} ${item.version}？`, detail: `将移除此受管版本及其目录：\n${item.path}`, buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0 });
    if (result.response === 1) await service.uninstall(id);
  });
  handle('terminal', value => { const data = z.object({ id: z.uuid().optional(), repl: z.boolean().optional() }).strict().parse(value); return terminals.create(data.id, data.repl); });
  handle('terminal-attach', value => terminals.attach(z.uuid().parse(value)));
  handle('terminal-write', value => { const data = z.object({ id: z.uuid(), data: z.string().max(65_536) }).strict().parse(value); terminals.write(data.id, data.data); });
  handle('terminal-resize', value => { const data = z.object({ id: z.uuid(), cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) }).strict().parse(value); terminals.resize(data.id, data.cols, data.rows); });
  handle('terminal-close', value => terminals.close(z.uuid().parse(value)));
  handle('reveal', async value => {
    const target = z.string().parse(value);
    const allowed = [service.root, ...service.installations.flatMap(i => [i.path, ...i.binPaths]), ...service.systemTools.map(t => t.path)];
    if (!allowed.includes(target)) throw new Error('只能打开已识别的环境路径');
    const info = await stat(target);
    if (info.isDirectory()) { const error = await shell.openPath(target); if (error) throw new Error(error); }
    else shell.showItemInFolder(target);
  });
  handle('export', async value => {
    const manifest = service.manifest(z.string().trim().min(1).max(80).parse(value));
    const result = await dialog.showSaveDialog(window!, { title: '导出环境', defaultPath: 'devhaven-environment.json', filters: [{ name: 'DevHaven 环境清单', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, JSON.stringify(manifest, null, 2), { mode: 0o600 }); return result.filePath;
  });
  handle('preview-import', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '导入环境', properties: ['openFile'], filters: [{ name: 'DevHaven 环境清单', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0]; if ((await stat(file)).size > 1024 * 1024) throw new Error('环境清单不能超过 1 MB');
    return service.previewImport(JSON.parse(await readFile(file, 'utf8')));
  });
  handle('apply-import', value => service.applyImport(value));
}
