import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import type { EnvironmentService } from './service';
import type { TerminalEvent, TerminalSession } from '../src/shared/types';
import { toolById } from '../src/shared/catalog';

type Session = { process: IPty; info: TerminalSession; output: string; exitCode?: number; attached: boolean };

export class TerminalManager {
  private sessions = new Map<string, Session>();
  constructor(private service: EnvironmentService, private emit: (event: TerminalEvent) => void) {}

  async create(installationId?: string, interactive = false): Promise<TerminalSession> {
    if (this.sessions.size >= 8) throw new Error('最多同时打开 8 个终端，请先关闭一个会话。');
    const installation = installationId ? this.service.findInstallation(installationId) : undefined;
    const tool = installation ? toolById(installation.tool) : undefined;
    const source = await this.service.engine.ready()
      ? await this.service.engine.environment(installation ? [`${tool!.backend}@${installation.version}`] : [])
      : process.env;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) if (value !== undefined) env[process.platform === 'win32' ? key.toUpperCase() : key] = value;
    delete env.ELECTRON_RUN_AS_NODE; delete env.NO_COLOR;
    env.TERM = 'xterm-256color'; env.COLORTERM = 'truecolor';
    let file = process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
    let args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : process.platform === 'darwin' ? ['-f', '-i'] : ['--noprofile', '--norc', '-i'];
    if (interactive) {
      if (!tool?.repl) throw new Error('该工具没有交互终端。');
      const [command, ...rest] = tool.repl;
      file = await executable(command, env.PATH ?? ''); args = rest;
      if (tool.id === 'python') env.PYTHONIOENCODING = 'utf-8';
    }
    // Electron resolves unpacked native addons; node-pty resolves its spawn helper.
    // Passing app.asar.unpacked here makes node-pty append ".unpacked" a second time.
    const nativePath = path.join(__dirname, 'vendor/node-pty');
    const pty = require(nativePath) as typeof import('node-pty');
    const info: TerminalSession = { id: randomUUID(), title: tool ? `${tool.name} ${installation!.version}${interactive ? ' · 交互' : ' · 命令行'}` : '命令行', cwd: this.service.engine.cwd, installationId };
    const terminalProcess = pty.spawn(file, args, { name: 'xterm-256color', cols: 100, rows: 28, cwd: info.cwd, env });
    const session: Session = { process: terminalProcess, info, output: '', attached: false };
    this.sessions.set(info.id, session);
    terminalProcess.onData(data => {
      session.output = (session.output + data).slice(-1_000_000);
      if (session.attached) this.emit({ id: info.id, type: 'data', data });
    });
    terminalProcess.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      if (session.attached) this.emit({ id: info.id, type: 'exit', exitCode });
    });
    return info;
  }
  private get(id: string) { const session = this.sessions.get(id); if (!session) throw new Error('终端会话已关闭。'); return session; }
  attach(id: string) { const session = this.get(id); session.attached = true; return { output: session.output, exitCode: session.exitCode }; }
  write(id: string, data: string) { const session = this.get(id); if (session.exitCode === undefined) session.process.write(data); }
  resize(id: string, cols: number, rows: number) { const session = this.get(id); if (session.exitCode === undefined) session.process.resize(cols, rows); }
  close(id: string) { const session = this.sessions.get(id); if (!session) return; this.sessions.delete(id); session.attached = false; if (session.exitCode === undefined) session.process.kill(); }
  dispose() { for (const id of this.sessions.keys()) this.close(id); }
}

async function executable(command: string, searchPath: string) {
  for (const folder of searchPath.split(path.delimiter).filter(Boolean)) {
    const file = path.join(folder, process.platform === 'win32' ? `${command}.exe` : command);
    try { await access(file); return file; } catch { /* Continue through the selected environment's PATH. */ }
  }
  throw new Error(`环境中未找到 ${command}，请重新检测已安装版本。`);
}

export async function clearOldTerminalScripts(root: string) {
  const folder = path.join(root, 'terminals');
  try { for (const name of await readdir(folder)) if (/^[a-f0-9-]+\.(command|ps1|ready)$/.test(name)) await rm(path.join(folder, name), { force: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
