import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from './process';
export const ENGINE_VERSION = '2026.9.10';
// Shared by the desktop engine and external terminal integration.
export function enginePaths(root: string, platform = process.platform): Record<string, string> {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return {
    MISE_DATA_DIR: join(root, 'data'), MISE_CACHE_DIR: join(root, 'cache'),
    MISE_CONFIG_DIR: join(root, 'config'), MISE_STATE_DIR: join(root, 'state'),
    MISE_GLOBAL_CONFIG_FILE: join(root, 'config', 'config.toml'),
    MISE_SYSTEM_CONFIG_DIR: join(root, 'config', 'system'),
    MISE_CARGO_HOME: join(root, 'cargo'), MISE_RUSTUP_HOME: join(root, 'rustup'),
    CARGO_HOME: join(root, 'cargo'), RUSTUP_HOME: join(root, 'rustup'),
    // Keep Go's user state with the managed environment. In particular, never
    // inherit a GOROOT/GOTOOLDIR belonging to a removed installation.
    GOENV: join(root, 'config', 'go', 'env'), GOPATH: join(root, 'go'),
    GOMODCACHE: join(root, 'cache', 'go', 'mod'), GOCACHE: join(root, 'cache', 'go', 'build'),
  };
}
export function checksumFor(contents: string, filename: string) {
  const entry = contents.split('\n').map(line => line.trim().split(/\s+/))
    .find(parts => parts[1]?.replace(/^\*/, '').replace(/^\.\//, '') === filename);
  if (!entry || !/^[a-f0-9]{64}$/.test(entry[0])) throw new Error('发布文件缺少 SHA-256 校验信息');
  return entry[0];
}

export class Engine {
  binary: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  constructor(public root: string) {
    this.binary = path.join(root, 'engine', process.platform === 'win32' ? 'mise.exe' : 'mise');
    this.cwd = path.join(root, 'workspace');
    const inherited = { ...process.env };
    delete inherited.GOROOT;
    delete inherited.GOTOOLDIR;
    this.env = { ...inherited, ...enginePaths(root),
      MISE_YES: '1', MISE_COLOR: '0', MISE_NOT_FOUND_AUTO_INSTALL: '0',
      MISE_HTTP_TIMEOUT: '120', MISE_FETCH_REMOTE_VERSIONS_TIMEOUT: '120',
      MISE_NPM_PACKAGE_MANAGER: 'npm', MISE_NPM_SHELL_OUT: '1',
      MISE_PYTHON_COMPILE: '0',
      NO_COLOR: '1', TERM: 'dumb',
    };
    delete this.env.ELECTRON_RUN_AS_NODE;
  }
  async init() { await Promise.all(['engine', 'workspace', 'config', 'cache', 'data', 'state'].map(d => mkdir(path.join(this.root, d), { recursive: true }))); }
  async ready() { try { await access(this.binary); return true; } catch { return false; } }
  async bootstrap(log: (message: string) => void) {
    if (await this.ready()) { await this.exec(['--version']); log('管理引擎已就绪'); return; }
    const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform as 'darwin' | 'win32' | 'linux'];
    if (!os || !['x64', 'arm64'].includes(process.arch)) throw new Error(`暂不支持 ${process.platform}/${process.arch}`);
    const filename = `mise-v${ENGINE_VERSION}-${os}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
    const base = `https://github.com/jdx/mise/releases/download/v${ENGINE_VERSION}`;
    const checksums = await fetch(`${base}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
    if (!checksums.ok) throw new Error(`无法获取校验信息：HTTP ${checksums.status}`);
    const expectedHash = checksumFor(await checksums.text(), filename);
    log(`下载 mise ${ENGINE_VERSION} · ${os}/${process.arch}`);
    const response = await fetch(`${base}/${filename}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`引擎下载失败：HTTP ${response.status}`);
    const temp = `${this.binary}.download`;
    const hash = createHash('sha256'); let bytes = 0; let reported = 0;
    const hasher = new Transform({ transform(chunk, _encoding, next) {
      bytes += chunk.length; hash.update(chunk);
      if (bytes > 200 * 1024 * 1024) { next(new Error('引擎文件超过大小限制')); return; }
      if (bytes - reported >= 10 * 1024 * 1024) { reported = bytes; log(`已下载 ${(bytes / 1024 / 1024).toFixed(0)} MB`); }
      next(null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), hasher, createWriteStream(temp));
      if (hash.digest('hex') !== expectedHash) throw new Error('SHA-256 校验失败，已拒绝安装');
      await chmod(temp, 0o755); await rename(temp, this.binary);
      try { await this.exec(['--version']); } catch (error) { await rm(this.binary, { force: true }); throw error; }
      log('SHA-256 校验通过，管理引擎已就绪');
    } finally { await rm(temp, { force: true }); }
  }
  async exec(args: string[], log?: (message: string) => void, timeout = 120_000) {
    if (!await this.ready()) throw new Error('请先在环境页准备管理引擎');
    return run(this.binary, args, { cwd: this.cwd, env: this.env, timeout, log });
  }
  async environment(specs: string[] = []) {
    const value: unknown = JSON.parse(await this.exec(['env', '--json', ...specs]));
    if (!value || typeof value !== 'object' || Object.values(value).some(v => typeof v !== 'string')) throw new Error('引擎返回了无效环境变量');
    return { ...this.env, ...(value as Record<string, string>) };
  }
}
