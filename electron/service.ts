import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { catalog, toolById, type ToolId } from '../src/shared/catalog';
import { manifestSchema, planImport, versionSchema } from '../src/shared/manifest';
import type { Installation, Manifest, Snapshot, SystemTool, Task } from '../src/shared/types';
import { Engine, ENGINE_VERSION } from './engine';
import { run } from './process';

const savedSchema = z.object({
  version: z.literal(1),
  installations: z.array(z.object({ id: z.string(), tool: z.enum(catalog.map(t => t.id)), version: versionSchema, path: z.string(), binPaths: z.array(z.string()), installedAt: z.string(), isDefault: z.boolean() })),
  tasks: z.array(z.object({ id: z.string(), kind: z.enum(['bootstrap', 'install', 'uninstall', 'default']), tool: z.enum(catalog.map(t => t.id)).optional(), version: z.string().optional(), status: z.enum(['queued', 'running', 'success', 'failed']), createdAt: z.string(), finishedAt: z.string().optional(), logs: z.array(z.string()), error: z.string().optional() })),
});
export class EnvironmentService extends EventEmitter {
  engine: Engine;
  installations: Installation[] = [];
  tasks: Task[] = [];
  systemTools: SystemTool[] = [];
  engineReady = false;
  scanTime?: string;
  private queue: Promise<void> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();
  private versionCache = new Map<ToolId, { time: number; versions: string[] }>();
  private notifyTimer?: NodeJS.Timeout;
  constructor(public root: string) { super(); this.engine = new Engine(root); }
  async init() {
    await this.engine.init();
    try {
      const state = savedSchema.parse(JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8')));
      this.installations = state.installations; this.tasks = state.tasks;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`状态文件无法读取，请备份后检查 ${path.join(this.root, 'state.json')}：${String(error)}`); }
    for (const task of this.tasks) {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'failed'; task.error = '上次运行被中断，请重新执行此操作。'; task.finishedAt = new Date().toISOString();
      }
    }
    this.engineReady = await this.engine.ready();
    if (this.engineReady) await this.reconcile();
    await this.persist();
    return this;
  }
  snapshot(): Snapshot {
    return structuredClone({ platform: process.platform, arch: process.arch, hostname: os.hostname(), root: this.root,
      engineReady: this.engineReady, engineVersion: ENGINE_VERSION, installations: this.installations,
      systemTools: this.systemTools, tasks: this.tasks, scanTime: this.scanTime });
  }
  private notify() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => { this.notifyTimer = undefined; this.emit('change', this.snapshot()); }, 100);
  }
  private persist() {
    const data = JSON.stringify({ version: 1, installations: this.installations, tasks: this.tasks }, null, 2);
    const save = this.saving.catch(() => {}).then(async () => {
      const file = path.join(this.root, 'state.json');
      await writeFile(`${file}.tmp`, data, { mode: 0o600 }); await rename(`${file}.tmp`, file);
    });
    this.saving = save; return save;
  }
  private async syncDefaults() {
    const lines = this.installations.filter(i => i.isDefault).map(i => `${JSON.stringify(toolById(i.tool).backend)} = ${JSON.stringify(i.version)}`);
    const file = path.join(this.root, 'config', 'config.toml');
    await writeFile(`${file}.tmp`, `[tools]\n${lines.join('\n')}\n`, { mode: 0o600 }); await rename(`${file}.tmp`, file);
    if (await this.engine.ready()) await this.engine.exec(['reshim']);
  }
  private enqueue(kind: Task['kind'], tool: ToolId | undefined, version: string | undefined, work: (log: (s: string) => void) => Promise<void>) {
    if (this.tasks.some(t => t.kind === kind && t.tool === tool && t.version === version && ['queued', 'running'].includes(t.status))) throw new Error('相同任务已在队列中');
    const task: Task = { id: randomUUID(), kind, tool, version, status: 'queued', createdAt: new Date().toISOString(), logs: [] };
    this.tasks.unshift(task);
    this.tasks = this.tasks.filter((t, i) => i < 100 || t.status === 'queued' || t.status === 'running');
    this.notify();
    const recorded = this.persist();
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        await recorded;
        task.status = 'running'; this.notify(); await this.persist();
        const log = (line: string) => { task.logs.push(line.slice(0, 4000)); if (task.logs.length > 400) task.logs.shift(); this.notify(); };
        await work(log); task.status = 'success';
      } catch (error) { task.status = 'failed'; task.error = error instanceof Error ? error.message : String(error); task.logs.push(task.error); }
      finally { task.finishedAt = new Date().toISOString(); this.notify(); await this.persist(); }
    });
    // Surface persistence failures without an unhandled background rejection.
    void this.queue.catch(error => this.emit('storage-error', error));
    return recorded;
  }
  async idle() { await this.queue; }
  bootstrap() {
    return this.enqueue('bootstrap', undefined, undefined, async log => { await this.engine.bootstrap(log); this.engineReady = true; });
  }
  async versions(id: ToolId) {
    const cached = this.versionCache.get(id);
    if (cached && Date.now() - cached.time < 15 * 60_000) return cached.versions;
    const tool = toolById(id);
    const rawVersions = tool.backend.startsWith('npm:')
      ? await this.npmVersions(tool.backend.slice('npm:'.length))
      : (await this.engine.exec(['ls-remote', tool.backend])).split('\n').map(v => v.trim());
    const versions = rawVersions
      .filter(v => versionSchema.safeParse(v).success && !/(alpha|beta|nightly|canary|rc\d|snapshot)/i.test(v))
      .filter(v => id !== 'java' || /^temurin-\d/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (!versions.length) throw new Error('未获取到可安装版本，请检查网络或稍后重试');
    this.versionCache.set(id, { time: Date.now(), versions }); return versions;
  }
  private async npmVersions(packageName: string) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`无法查询 npm 包 ${packageName}：HTTP ${response.status}`);
    const document: unknown = await response.json();
    if (!document || typeof document !== 'object' || !('versions' in document) || !document.versions || typeof document.versions !== 'object') throw new Error(`npm 包 ${packageName} 返回了无效版本信息`);
    return Object.keys(document.versions);
  }
  install(id: ToolId, input: string, makeDefault?: boolean) {
    const version = versionSchema.parse(input); const tool = toolById(id);
    return this.enqueue('install', id, version, async log => {
      const existing = this.installations.find(i => i.tool === id && i.version === version);
      if (existing) { if (makeDefault) await this.activate(existing); log('此版本已安装'); return; }
      if ('requires' in tool && !this.installations.some(i => i.tool === tool.requires && i.isDefault)) throw new Error(`请先安装并设置默认 ${toolById(tool.requires).name}`);
      if (!(await this.versions(id)).includes(version)) throw new Error(`${tool.name} ${version} 不在当前可安装版本列表中`);
      const spec = `${tool.backend}@${version}`;
      log(`正在安装 ${tool.name} ${version}`);
      await this.engine.exec(['install', spec], log, 30 * 60_000);
      const installPath = (await this.engine.exec(['where', spec])).trim();
      const env = await this.engine.environment([spec]);
      const binPaths = this.pathsInInstall(env, installPath);
      this.installations.push({ id: randomUUID(), tool: id, version, path: installPath, binPaths, installedAt: new Date().toISOString(), isDefault: false });
      const installed = this.installations.at(-1)!;
      if (makeDefault ?? !this.installations.some(i => i.tool === id && i.isDefault)) await this.activate(installed);
      log(`安装完成：${installPath}`);
    });
  }
  private pathsInInstall(env: NodeJS.ProcessEnv, installPath: string) {
    const searchPath = Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1] ?? '';
    return searchPath.split(path.delimiter).filter(p => p === installPath || p.startsWith(installPath + path.sep));
  }
  private async activate(installation: Installation) {
    const previous = this.installations.map(i => i.isDefault);
    this.installations.forEach(i => { if (i.tool === installation.tool) i.isDefault = i.id === installation.id; });
    try { await this.syncDefaults(); } catch (error) { this.installations.forEach((i, index) => { i.isDefault = previous[index]; }); throw error; }
  }
  setDefault(id: string) {
    const selected = this.findInstallation(id);
    return this.enqueue('default', selected.tool, selected.version, async log => { await this.activate(this.findInstallation(id)); log('默认版本已更新，新开的终端将使用此版本'); });
  }
  uninstall(id: string) {
    const selected = this.findInstallation(id);
    return this.enqueue('uninstall', selected.tool, selected.version, async log => {
      const item = this.findInstallation(id);
      if (item.isDefault) {
        const dependents = this.installations.filter(i => { const t = toolById(i.tool); return 'requires' in t && t.requires === item.tool; });
        if (dependents.length) throw new Error(`此默认环境被 ${[...new Set(dependents.map(i => toolById(i.tool).name))].join('、')} 使用，请先切换默认版本或卸载相关工具。`);
      }
      await this.engine.exec(['uninstall', `${toolById(item.tool).backend}@${item.version}`], log, 5 * 60_000);
      this.installations = this.installations.filter(i => i.id !== id);
      if (item.isDefault) { const next = this.installations.find(i => i.tool === item.tool); if (next) next.isDefault = true; }
      await this.syncDefaults(); log('受管版本已卸载');
    });
  }
  findInstallation(id: string) { const item = this.installations.find(i => i.id === id); if (!item) throw new Error('找不到该受管版本，请刷新列表'); return item; }
  manifest(name: string): Manifest {
    return manifestSchema.parse({ format: 'devhaven', schemaVersion: 1, name, exportedAt: new Date().toISOString(), source: { platform: process.platform, arch: process.arch },
      tools: this.installations.map(i => ({ id: i.tool, version: i.version, default: i.isDefault })) });
  }
  previewImport(raw: unknown) { return planImport(raw, this.installations, process.platform); }
  async applyImport(raw: unknown) {
    if (!this.engineReady) throw new Error('请先准备管理引擎');
    const plan = this.previewImport(raw);
    for (const item of plan.items) {
      if (item.action === 'install') await this.install(item.tool, item.version, item.setDefault);
      else if (item.setDefault) await this.setDefault(this.installations.find(i => i.tool === item.tool && i.version === item.version)!.id);
    }
  }
  private async reconcile() {
    // Recover a successful engine install even if the app exited before state was saved.
    const rows: Record<string, { version: string; install_path?: string }[]> = JSON.parse(await this.engine.exec(['ls', '--installed', '--json']));
    const recovered: Installation[] = [];
    for (const tool of catalog) {
      const entries = rows[tool.backend] ?? rows[tool.id] ?? rows[tool.backend.split(':').slice(1).join(':')] ?? [];
      for (const entry of entries) {
        if (!versionSchema.safeParse(entry.version).success) continue;
        const old = this.installations.find(i => i.tool === tool.id && i.version === entry.version);
        const location = (entry.install_path ?? await this.engine.exec(['where', `${tool.backend}@${entry.version}`])).trim();
        let binPaths: string[] = [];
        try { binPaths = this.pathsInInstall(await this.engine.environment([`${tool.backend}@${entry.version}`]), location); } catch { /* Keep startup recovery available if a backend cannot report its environment. */ }
        recovered.push(old ? { ...old, path: location, binPaths } : { id: randomUUID(), tool: tool.id, version: entry.version, path: location, binPaths, isDefault: false, installedAt: new Date().toISOString() });
      }
    }
    this.installations = recovered; await this.syncDefaults();
  }
  async scan() {
    const detected = await Promise.all(catalog.map(async tool => {
      try {
        const names = tool.id === 'python' && process.platform !== 'win32' ? ['python3', 'python'] : [tool.command];
        let executable: string | undefined;
        for (const name of names) {
          for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
            const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
            for (const extension of extensions) {
              const candidate = path.join(directory, name + extension);
              try { await access(candidate); executable = candidate; break; } catch {}
            }
            if (executable) break;
          }
          if (executable) break;
        }
        if (!executable) return null;
        // Windows command scripts are queried by a fixed command name; no user input is interpolated.
        const commandScript = /\.(cmd|bat)$/i.test(executable);
        let output = '';
        const scanEnv = { ...process.env }; delete scanEnv.ELECTRON_RUN_AS_NODE;
        const options = { timeout: 8000, env: scanEnv, log: (line: string) => { output += line + '\n'; } };
        if (commandScript) await run('cmd.exe', ['/d', '/c', tool.command, ...tool.versionArgs], options);
        else await run(executable, [...tool.versionArgs], options);
        const match = output.match(/(?:\d+\.)+\d+(?:[+_-][\w.]+)?/);
        if (!match) return null;
        return { tool: tool.id, path: executable, version: match[0] } as SystemTool;
      } catch { return null; }
    }));
    this.systemTools = detected.filter((x): x is SystemTool => !!x); this.scanTime = new Date().toISOString(); this.notify();
    return this.snapshot();
  }
}
