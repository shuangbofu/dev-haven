import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { enginePaths } from './engine';
import type { ShellIntegrationStatus } from '../src/shared/types';
import { WindowsEnvironmentIntegration } from './windows-environment';

const start = '# >>> DevHaven 全局终端环境 >>>';
const end = '# <<< DevHaven 全局终端环境 <<<';
const fileSchema = z.object({ configFile: z.string(), backupFile: z.string(), originalExists: z.boolean() });
const recordSchema = z.object({ version: z.literal(1), shell: z.enum(['zsh', 'bash', 'fish']), files: z.array(fileSchema) });
type RecordData = z.infer<typeof recordSchema>;
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const fishQuote = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

function removeBlock(contents: string) {
  const begin = contents.indexOf(start), finish = contents.indexOf(end);
  if (begin < 0 && finish < 0) return contents;
  if (begin < 0 || finish < begin || contents.indexOf(start, begin + start.length) >= 0 || contents.indexOf(end, finish + end.length) >= 0
      || (begin > 0 && contents[begin - 1] !== '\n')) throw new Error('DevHaven 配置标记不完整或重复，请先检查配置文件；未修改原文件。');
  const tail = finish + end.length;
  if (contents[tail] && contents[tail] !== '\n' && contents.slice(tail, tail + 2) !== '\r\n') throw new Error('DevHaven 配置结束标记异常，请先检查配置文件。');
  return contents.slice(0, begin) + contents.slice(tail + (contents.slice(tail, tail + 2) === '\r\n' ? 2 : contents[tail] === '\n' ? 1 : 0));
}
async function readOptional(file: string) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function atomicWrite(file: string, contents: string) {
  // Follow a dotfile symlink without replacing the symlink itself.
  const target = await realpath(file).catch(error => { if (error.code === 'ENOENT') return file; throw error; });
  const mode = await stat(target).then(info => info.mode & 0o777).catch(error => { if (error.code === 'ENOENT') return 0o600; throw error; });
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, contents, { mode }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
}

export class ShellIntegration {
  readonly scriptFile: string;
  private recordFile: string;
  private home: string;
  private platform: string;
  private zdotdir: string;
  private configHome: string;
  private shellName: string;
  private windows?: WindowsEnvironmentIntegration;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private root: string, options: { home?: string; platform?: string; zdotdir?: string; configHome?: string; shell?: string } = {}) {
    this.home = options.home ?? os.homedir();
    this.platform = options.platform ?? process.platform;
    this.zdotdir = options.zdotdir ?? process.env.ZDOTDIR ?? this.home;
    this.configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? path.join(this.home, '.config');
    this.shellName = path.basename(options.shell ?? process.env.SHELL ?? os.userInfo().shell ?? (this.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));
    if (this.platform === 'win32') this.windows = new WindowsEnvironmentIntegration(root);
    this.scriptFile = path.join(root, 'shell', 'env.shell');
    this.recordFile = path.join(root, 'shell', 'integration.json');
  }
  private async record(): Promise<RecordData | undefined> {
    const contents = await readOptional(this.recordFile);
    const record = contents === undefined ? undefined : recordSchema.parse(JSON.parse(contents));
    if (record) this.shellName = record.shell;
    return record;
  }
  private async centralConfig(rc: string) {
    // Resolve explicit sources of a personal config, never evaluate arbitrary shell text.
    for (const line of (await readOptional(rc) ?? '').split('\n')) {
      const match = line.match(/^\s*(?:source|\.)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
      if (!match) continue;
      const candidate = (match[1] ?? match[2] ?? match[3]).replace(/^(?:\$HOME|\$\{HOME\}|~)(?=\/)/, this.home);
      if (!path.isAbsolute(candidate) || !/^(?:\.[\w.-]+|config|env|profile)\.sh$/.test(path.basename(candidate))) continue;
      const relative = path.relative(this.home, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (await readOptional(candidate) !== undefined) return path.normalize(candidate);
    }
    return rc;
  }
  private async targets() {
    if (this.shellName === 'fish') return [path.join(this.configHome, 'fish', 'conf.d', 'devhaven.fish')];
    if (this.shellName === 'bash') {
      let login = path.join(this.home, '.bash_profile');
      for (const name of ['.bash_profile', '.bash_login', '.profile']) {
        const candidate = path.join(this.home, name);
        if (await readOptional(candidate) !== undefined) { login = candidate; break; }
      }
      return [...new Set([await this.centralConfig(path.join(this.home, '.bashrc')), login])];
    }
    return [await this.centralConfig(path.join(this.zdotdir, '.zshrc'))];
  }
  private block() {
    if (this.shellName === 'fish') return `${start}\nif status is-interactive; and test -r ${fishQuote(this.scriptFile)}\n  source ${fishQuote(this.scriptFile)}\nend\n${end}\n`;
    const variable = this.shellName === 'bash' ? 'BASH_VERSION' : 'ZSH_VERSION';
    return `${start}\n# 由 DevHaven 管理；可在应用设置中关闭。\nif [ -n "\${${variable}:-}" ] && [ -r ${shellQuote(this.scriptFile)} ]; then\n  . ${shellQuote(this.scriptFile)}\nfi\n${end}\n`;
  }
  private script() {
    const binary = path.join(this.root, 'engine', 'mise');
    const variables = { ...enginePaths(this.root), MISE_NOT_FOUND_AUTO_INSTALL: '0' };
    if (this.shellName === 'fish') return `# DevHaven 全局终端环境\nif status is-interactive; and test -x ${fishQuote(binary)}\n  set -e GOROOT GOTOOLDIR\n${Object.entries(variables).map(([key, value]) => `  set -gx ${key} ${fishQuote(value)}`).join('\n')}\n  ${fishQuote(binary)} activate fish | source\nend\n`;
    const exports = Object.entries(variables)
      .map(([key, value]) => `  export ${key}=${shellQuote(value)}`).join('\n');
    const variable = this.shellName === 'bash' ? 'BASH_VERSION' : 'ZSH_VERSION';
    return `# DevHaven：共享应用默认版本；项目 mise 配置可覆盖全局默认。\n# 引擎未准备好时保持原有终端环境。\nif [ -n "\${${variable}:-}" ] && [ -x ${shellQuote(binary)} ] && [ "\${_DEVHAVEN_ACTIVATED_ROOT:-}" != ${shellQuote(this.root)} ]; then\n  unset GOROOT GOTOOLDIR\n${exports}\n  eval "$(${shellQuote(binary)} activate ${this.shellName})"\n  _DEVHAVEN_ACTIVATED_ROOT=${shellQuote(this.root)}\nfi\n`;
  }
  async status(): Promise<ShellIntegrationStatus> {
    if (this.windows) return this.windows.status();
    let configFiles: string[] = [];
    try {
      const record = await this.record();
      configFiles = record?.files.map(file => file.configFile) ?? await this.targets();
      const contents = await Promise.all(configFiles.map(async file => await readOptional(file) ?? ''));
      contents.forEach(removeBlock);
      const enabled = contents.every(value => value.includes(this.block()));
      const scriptExists = await access(this.scriptFile).then(() => true, () => false);
      const drift = contents.some(value => value.includes(start)) && (!enabled || !scriptExists);
      return { supported: this.supported(), shell: this.shellName, enabled: enabled && scriptExists, configFile: configFiles[0], configFiles, scriptFile: this.scriptFile, backupFile: record?.files[0]?.backupFile,
        error: drift ? '全局终端配置已被修改或缺失，可点击开启重新生成。' : undefined };
    } catch (error) { return { supported: this.supported(), shell: this.shellName, enabled: false, configFile: configFiles[0] ?? '', configFiles, scriptFile: this.scriptFile, error: String(error) }; }
  }
  private supported() { return ['darwin', 'linux'].includes(this.platform) && ['zsh', 'bash', 'fish'].includes(this.shellName); }
  setEnabled(enabled: boolean): Promise<ShellIntegrationStatus> {
    const work = this.pending.catch(() => {}).then(() => this.windows ? this.windows.setEnabled(enabled) : this.change(enabled));
    this.pending = work;
    return work;
  }
  private async change(enabled: boolean) {
    let record = await this.record();
    if (!this.supported()) throw new Error(`当前 Shell ${this.shellName} 暂不支持自动配置；支持 zsh、bash、fish 和 Windows 用户环境。`);
    const targets = record?.files.map(file => file.configFile) ?? await this.targets();
    const originals = await Promise.all(targets.map(file => readOptional(file)));
    const stripped = originals.map(contents => removeBlock(contents ?? ''));
    const previousScript = await readOptional(this.scriptFile);
    const plans: { file: string; contents: string | undefined }[] = [];
    if (enabled) {
      const extra = this.shellName === 'zsh' ? [path.join(this.zdotdir, '.zshrc'), path.join(this.zdotdir, '.zprofile'), path.join(this.zdotdir, '.zshenv')]
        : this.shellName === 'fish' ? [path.join(this.configHome, 'fish', 'config.fish')] : [path.join(this.home, '.bashrc')];
      const checked = [...stripped, ...await Promise.all(extra.map(async file => removeBlock(await readOptional(file) ?? '')))];
      if (/^[^#\n]*(?:mise[^\n]*\bactivate\b|(?:export\s+)?MISE_(?:DATA_DIR|GLOBAL_CONFIG_FILE)=)/m.test(checked.join('\n'))) {
        throw new Error('检测到已有 mise 激活或目录配置，请先停用旧配置后再开启，避免环境冲突。');
      }
      await mkdir(path.dirname(this.recordFile), { recursive: true });
      if (!record) {
        const files = [];
        for (let i = 0; i < targets.length; i++) {
          const backupFile = path.join(this.root, 'shell', `config-before-${randomUUID()}.txt`);
          await writeFile(backupFile, originals[i] ?? '', { mode: 0o600, flag: 'wx' });
          files.push({ configFile: targets[i], backupFile, originalExists: originals[i] !== undefined });
        }
        record = { version: 1, shell: this.shellName as RecordData['shell'], files };
        await atomicWrite(this.recordFile, JSON.stringify(record, null, 2));
      }
      for (let i = 0; i < targets.length; i++) plans.push({ file: targets[i], contents: originals[i]?.includes(this.block()) ? originals[i] : stripped[i] + (stripped[i] && !stripped[i].endsWith('\n') ? '\n' : '') + this.block() });
    } else {
      for (let i = 0; i < targets.length; i++) {
        let next = stripped[i];
        const backupRecord = record?.files[i];
        if (backupRecord) {
          const backup = await readFile(backupRecord.backupFile, 'utf8');
          if (originals[i] === backup + (backup && !backup.endsWith('\n') ? '\n' : '') + this.block()) next = backup;
        }
        plans.push({ file: targets[i], contents: next === '' && (backupRecord ? !backupRecord.originalExists : originals[i] === undefined) ? undefined : next });
      }
    }
    const changed: number[] = [];
    try {
      await atomicWrite(this.scriptFile, enabled ? this.script() : '# DevHaven 全局终端环境已关闭。请重新打开终端。\n');
      for (let i = 0; i < plans.length; i++) {
        if (plans[i].contents === originals[i]) continue;
        const plan = plans[i];
        if (plan.contents === undefined) await rm(plan.file, { force: true });
        else await atomicWrite(plan.file, plan.contents);
        changed.push(i);
      }
    } catch (error) {
      for (const i of changed.reverse()) {
        if (originals[i] === undefined) await rm(targets[i], { force: true });
        else await atomicWrite(targets[i], originals[i]!);
      }
      if (previousScript === undefined) await rm(this.scriptFile, { force: true }); else await atomicWrite(this.scriptFile, previousScript);
      throw error;
    }
    await appendFile(path.join(this.root, 'CHANGELOG.md'), `\n- ${new Date().toISOString()}：${enabled ? '开启' : '关闭'}当前用户 ${this.shellName} 全局终端环境；配置：${targets.join('、')}；备份：${record?.files.map(file => file.backupFile).join('、') ?? '无需备份'}。\n`, { mode: 0o600 });
    return this.status();
  }
}
