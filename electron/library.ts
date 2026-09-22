import { documentType } from '../src/shared/document-format';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ownGitHistory } from './git-history';
import type { LibraryMemoryStore } from './memory';
import type { MemorySource } from '../src/shared/memory';
import { metadataSchema, gitRemoteSchema, type LibraryGitInfo, type ChangeLogEntry, type DirectoryListing, type LibraryDocument, type LibraryEntry, type LibraryKind, type LibraryOverview, type LibrarySettings, type MetadataWrite, type ProjectListing } from '../src/shared/library';

const MAX_TEXT = 2 * 1024 * 1024;
const ignored = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'out', 'release', '__pycache__', 'venv']);
const isChangelog = (name: string) => /^change?logs?\.md$/i.test(name) || /^changelog\.md$/i.test(name);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const inside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
const slash = (value: string) => value.split(path.sep).join('/');
const execFileAsync = promisify(execFile);

export class LibraryService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private central: { source: MemorySource; store: LibraryMemoryStore }) {}
  getSettings(): LibrarySettings { return { [this.central.source.kind]: this.central.source.directory }; }
  private serialize<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.catch(() => {}).then(work); this.queue = result; return result; }
  private async root(kind: LibraryKind) {
    const root = this.getSettings()[kind];
    if (!root) throw new Error('请先在设置中选择目录');
    try { return await realpath(root); } catch { throw new Error('配置的目录已移动或不可访问，请在设置中重新选择'); }
  }
  async resolve(kind: LibraryKind, relative: string) {
    if (relative.includes('\\') || relative.includes('\0') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p.startsWith('.'))) throw new Error('无效的相对路径');
    const root = await this.root(kind);
    let segment = root;
    for (const component of relative.split('/').filter(Boolean)) {
      segment = path.join(segment, component);
      if ((await lstat(segment)).isSymbolicLink()) throw new Error('不支持通过符号链接访问内容');
    }
    const resolved = await realpath(path.join(root, relative));
    if (!inside(root, resolved)) throw new Error('路径超出已配置的目录');
    if (this.central && !this.central.store.allowed(resolved)) throw new Error('该目录已从来源中排除');
    return resolved;
  }
  async destination(kind: LibraryKind, selected: string) {
    if (!path.isAbsolute(selected)) throw new Error('请选择完整的目录路径');
    const root = await this.root(kind), absolutePath = await realpath(selected);
    if (!inside(root, absolutePath)) throw new Error('目标目录必须位于设置中配置的对应根目录内');
    const relative = slash(path.relative(root, absolutePath));
    if (await this.resolve(kind, relative) !== absolutePath) throw new Error('目录设置已变化，请重新选择');
    if (!(await stat(absolutePath)).isDirectory()) throw new Error('请选择目录');
    if (kind === 'projects') {
      const parts = relative.split('/').filter(Boolean);
      for (let index = 0; index <= parts.length; index++) if ((await this.metadata(path.join(root, ...parts.slice(0, index)))).metadata?.kind === 'project') throw new Error('不能在已有项目内部导入项目，请选择分组目录');
    }
    return { root, path: relative, absolutePath };
  }
  async destinationFolders(kind: LibraryKind, relative: string) {
    const current = await this.destination(kind, await this.resolve(kind, relative));
    const folders: { name: string; path: string }[] = [];
    for (const entry of await readdir(current.absolutePath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const child = [current.path, entry.name].filter(Boolean).join('/');
      try { await this.destination(kind, await this.resolve(kind, child)); folders.push({ name: entry.name, path: child }); }
      catch { /* Excluded folders and existing projects are not destinations. */ }
    }
    return { current, folders: folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) };
  }
  private async checkExpectedRoot(kind: LibraryKind, expectedRoot?: string) {
    if (expectedRoot !== undefined && await this.root(kind) !== expectedRoot) throw new Error('目录设置已变化，请重新选择目标目录');
  }
  private async smallRead(file: string, limit = MAX_TEXT) {
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) throw new Error(`文件过大或不是普通文件（上限 ${Math.round(limit / 1024)} KB）`);
      const buffer = Buffer.alloc(limit + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit) throw new Error('文件超过预览大小限制');
      if (buffer.subarray(0, bytesRead).includes(0)) throw new Error('不支持二进制文件预览');
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
  }
  private async metadata(directory: string) {
    return this.central.store.metadata(directory);
  }
  private async changelog(directory: string): Promise<ChangeLogEntry[]> {
    return this.central.store.history(directory);
  }
  private remoteInfo(remote: string) {
    let url: URL;
    try {
      const scp = remote.match(/^([\w.-]+)@([\w.-]+):(.+)$/);
      url = new URL(scp ? `ssh://${scp[1]}@${scp[2]}/${scp[3]}` : remote);
      if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return { remote: '', provider: 'other' as const };
    } catch { return { remote: '', provider: 'other' as const }; }
    url.password = ''; url.search = ''; url.hash = '';
    if (url.protocol !== 'ssh:') url.username = '';
    const safe = url.toString();
    const provider: LibraryGitInfo['provider'] = url.hostname === 'github.com' ? 'github' : url.hostname === 'gitlab.com' ? 'gitlab' : 'enterprise';
    const webUrl = `${['http:', 'https:'].includes(url.protocol) ? url.protocol : 'https:'}//${url.hostname}${['http:', 'https:'].includes(url.protocol) && url.port ? `:${url.port}` : ''}${url.pathname.replace(/\.git\/?$/, '')}`;
    return { remote: safe, provider, webUrl };
  }
  private async gitCommand(directory: string, args: string[], timeout = 12_000) {
    const result = await execFileAsync('git', ['-C', directory, ...args], {
      timeout, maxBuffer: 512 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', GIT_OPTIONAL_LOCKS: '0' },
    });
    return String(result.stdout).trim();
  }
  private async git(directory: string, configuredRemote?: string): Promise<LibraryGitInfo | undefined> {
    try { const marker = await lstat(path.join(directory, '.git')); if (marker.isSymbolicLink() || (!marker.isFile() && !marker.isDirectory())) return undefined; }
    catch { return undefined; }
    try {
      const rawRemote = await this.gitCommand(directory, ['remote', 'get-url', 'origin']).catch(() => configuredRemote ?? '');
      const remote = this.remoteInfo(rawRemote);
      const branch = await this.gitCommand(directory, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '分离 HEAD');
      const log = await this.gitCommand(directory, ['log', '-1', '--format=%H%n%cI%n%s']).catch(() => '');
      const [commit, commitDate, commitMessage] = log.split('\n');
      const status = await this.gitCommand(directory, ['status', '--porcelain']);
      return { ...remote, branch, commit, commitDate, commitMessage, dirty: !!status };
    } catch { return { remote: '', dirty: false, warning: 'Git 状态无法读取，请确认已安装 Git 且仓库可访问' }; }
  }
  async gitHistory(relative: string, requestedPage = 1, revision?: string) {
    const pageSize = 20;
    z.number().int().min(1).max(1000000).parse(requestedPage);
    if (revision !== undefined) z.string().regex(/^[a-f0-9]{40,64}$/).parse(revision);
    const directory = await this.resolve('projects', relative);
    if ((await this.metadata(directory)).metadata?.kind !== 'project') throw new Error('请选择已登记的项目');
    return ownGitHistory(directory, requestedPage, pageSize, revision, undefined, this.central.store.gitAuthorEmails());
  }
  private async entry(root: string, file: string): Promise<LibraryEntry> {
    const info = await stat(file), directory = info.isDirectory();
    const meta = directory ? await this.metadata(file) : { metadataRevision: '' };
    const changelog = directory ? await this.changelog(file) : [];
    let documentTitle: string | undefined, documentSummary: string | undefined;
    if (!directory && documentType(file).format === 'markdown' && info.size <= 128 * 1024) {
      try {
        const text = await this.smallRead(file, 128 * 1024);
        documentTitle = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
        documentSummary = text.split(/\n\s*\n/).map(value => value.replace(/^#{1,6}\s+/, '').replace(/[>*_`]/g, '').replace(/\s+/g, ' ').trim()).find(value => value && !value.startsWith('---'))?.slice(0, 180);
      } catch {}
    }
    const git = directory && meta.metadata?.kind === 'project' ? await this.git(file, meta.metadata.git?.remote) : undefined;
    return { path: slash(path.relative(root, file)), name: path.basename(file), displayName: meta.metadata?.name ?? path.basename(file),
      directory, description: meta.metadata?.description ?? '', modified: info.mtime.toISOString(), size: info.size,
      languages: meta.metadata?.languages ?? [], tags: meta.metadata?.tags ?? [], changelog, documentTitle, documentSummary, git, ...meta };
  }
  async browse(kind: LibraryKind, relative = ''): Promise<DirectoryListing> {
    const root = await this.root(kind), directory = await this.resolve(kind, relative);
    const entries: LibraryEntry[] = [], warnings: string[] = [];
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.filter(c => !c.name.startsWith('.') && !ignored.has(c.name) && !isChangelog(c.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= 1500) { warnings.push('当前目录超过 1500 项，请进入子目录浏览'); break; }
      if (child.isSymbolicLink()) { warnings.push(`已跳过符号链接：${child.name}`); continue; }
      if (!child.isDirectory() && !child.isFile()) continue;
      try {
        const candidate = path.join(directory, child.name);
        if (this.central && !this.central.store.allowed(candidate)) continue;
        if (child.isDirectory() && (await this.metadata(candidate)).metadata?.kind !== 'collection') continue;
        entries.push(await this.entry(root, candidate));
      } catch { warnings.push(`无法读取：${child.name}`); }
    }
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.displayName.localeCompare(b.displayName, 'zh-CN'));
    return { root, path: relative, current: await this.entry(root, directory), entries, warnings };
  }
  async read(kind: LibraryKind, relative: string): Promise<LibraryDocument> {
    const file = await this.resolve(kind, relative), info = await stat(file);
    const type = documentType(file);
    if (!info.isFile()) throw new Error('请选择文档');
    if (type.format === 'unsupported') return { path: relative, content: '', revision: '', size: info.size, format: 'unsupported' };
    const content = await this.smallRead(file);
    return { path: relative, content, revision: hash(content), size: info.size, ...type };
  }
  private async atomic(file: string, content: string) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const mode = await stat(file).then(s => s.mode & 0o777).catch(() => 0o600);
    try { await writeFile(temporary, content, { mode, flag: 'wx' }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  }
  private async recorded(kind: LibraryKind, message: string, relative = '') {
    await this.central.store.record(await this.resolve(kind, relative), message);
  }
  async saveMetadata(input: MetadataWrite) {
    return this.serialize(async () => {
      if (input.kind === 'knowledge' && input.metadata.kind !== 'collection') throw new Error('知识库只能登记知识集合');
      const directory = await this.resolve(input.kind, input.path);
      if (!(await stat(directory)).isDirectory()) throw new Error('元数据只能保存在目录中');
      const old = await this.metadata(directory);
      if (old.warning) throw new Error(old.warning);
      if (old.metadataRevision !== input.revision) throw new Error('元数据已被其他程序修改，请刷新后重试');
      await this.central.store.save(directory, metadataSchema.parse(input.metadata));
      if (input.kind === 'projects') await this.projectAudit(directory, input.path, '更新项目信息', true);
      else await this.recorded(input.kind, `更新 ${input.path || '.'} 元数据`, input.path);
    });
  }
  async saveDocument(kind: LibraryKind, relative: string, content: string, revision: string) {
    return this.serialize(async () => {
      if (Buffer.byteLength(content) > MAX_TEXT) throw new Error('文档不能超过 2 MB');
      const previous = await this.read(kind, relative);
      if (previous.format === 'unsupported' || !revision || revision !== previous.revision) throw new Error('文件已被其他程序修改或不支持编辑，请重新读取后再保存');
      await this.atomic(await this.resolve(kind, relative), content);
      await this.recorded(kind, `编辑 ${relative}`, relative);
      return this.read(kind, relative);
    });
  }
  async create(kind: LibraryKind, parent: string, name: string, directory: boolean, expectedRoot?: string) {
    return this.serialize(async () => {
      await this.checkExpectedRoot(kind, expectedRoot);
      if (!name.trim() || name.length > 120 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name.startsWith('.') || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('名称不符合跨平台文件命名规则');
      if (directory && ignored.has(name)) throw new Error('该名称用于依赖或构建输出，请使用其他知识集合名称');
      if (!directory && !/\.(md|txt|html|htm)$/i.test(name)) throw new Error('新建文档请使用 .md、.html 或 .txt 扩展名');
      const base = await this.resolve(kind, parent), file = path.join(base, name);
      await this.destination(kind, base);
      if (directory) {
        await mkdir(file);
        const metadata = metadataSchema.parse({ schemaVersion: 1, kind: 'collection', name });
        await this.central.store.save(file, metadata);
      } else await writeFile(file, /\.html?$/i.test(name) ? '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>新文档</title></head><body><h1>新文档</h1></body></html>\n' : `# ${name.replace(/\.[^.]+$/, '')}\n`, { flag: 'wx', mode: 0o600 });
      await this.recorded(kind, `新建${directory ? '目录' : '文档'} ${[parent, name].filter(Boolean).join('/')}`, slash(path.relative(await this.root(kind), file)));
      return slash(path.relative(await this.root(kind), file));
    });
  }
  async projects(): Promise<ProjectListing> {
    const root = await this.root('projects'), entries: LibraryEntry[] = [], groups: LibraryEntry[] = [], warnings: string[] = [];
    let visited = 0;
    const walk = async (directory: string, depth: number) => {
      if (this.central && !this.central.store.allowed(directory)) return;
      if (++visited > 2000) return;
      let names: string[];
      try { names = await readdir(directory); } catch { warnings.push(`无法读取 ${slash(path.relative(root, directory))}`); return; }
      const entry = await this.entry(root, directory);
      if (entry.warning) warnings.push(`${entry.path || '.'}：${entry.warning}`);
      if (entry.git?.warning) warnings.push(`${entry.path}：${entry.git.warning}`);
      const isProject = entry.metadata?.kind === 'project';
      if (isProject) {
        if (!entry.languages.length) entry.languages = await this.languages(directory);
        if (!entry.description) {
          try { const pkg = JSON.parse(await this.smallRead(path.join(directory, 'package.json'), 128 * 1024)); if (typeof pkg.description === 'string') entry.description = pkg.description.slice(0, 2000); } catch {}
        }
        entries.push(entry); return;
      }
      groups.push(entry);
      if (depth >= 4) { warnings.push(`扫描深度已达上限：${entry.path}`); return; }
      for (const name of names.sort()) {
        if (name.startsWith('.') || ignored.has(name)) continue;
        const file = path.join(directory, name);
        try {
          if ((await lstat(file)).isDirectory()) {
            const kind = (await this.metadata(file)).metadata?.kind;
            if (kind === 'collection' || kind === 'project') await walk(file, depth + 1);
          }
        } catch { warnings.push(`无法读取 ${name}`); }
      }
    };
    await walk(root, 0);
    if (visited > 2000) warnings.push('项目扫描达到 2000 个目录上限，请缩小根目录范围');
    return { root, entries: entries.sort((a, b) => a.path.localeCompare(b.path)), groups, warnings };
  }
  async projectReadme(relative: string): Promise<LibraryDocument | null> {
    const target = await this.resolve('projects', relative);
    if ((await this.metadata(target)).metadata?.kind !== 'project') throw new Error('请选择已登记的项目');
    const name = (await readdir(target)).find(name => /^readme\.(md|markdown|txt)$/i.test(name));
    return name ? this.read('projects', [relative, name].filter(Boolean).join('/')) : null;
  }
  async pullProject(relative: string): Promise<LibraryEntry> {
    return this.serialize(async () => {
      const root = await this.root('projects'), target = await this.resolve('projects', relative);
      const meta = await this.metadata(target);
      if (meta.metadata?.kind !== 'project') throw new Error('只能更新已登记的项目');
      const git = await this.git(target); if (!git || git.warning) throw new Error('该项目没有可用的 Git 仓库');
      try { await this.gitCommand(target, ['pull', '--ff-only', '--no-rebase', '--no-autostash'], 120_000); }
      catch {
        await this.projectAudit(target, relative, 'Git 更新失败，未自动合并或丢弃本地改动');
        throw new Error('Git 更新失败：请检查网络、凭据、上游分支或本地改动。未自动合并或丢弃改动');
      }
      const after = await this.git(target);
      await this.projectAudit(target, relative, git.commit === after?.commit ? 'Git 更新检查完成，已是最新代码' : `Git 更新完成：${git.commit?.slice(0, 8) ?? '初始'} → ${after?.commit?.slice(0, 8) ?? '最新'}`);
      return this.entry(root, target);
    });
  }
  private async projectAudit(target: string, relative: string, message: string, reportable = false) {
    await this.central.store.record(target, `${relative || '.'}：${message}`, 'app', reportable);
  }
  async cloneProject(remoteInput: string, nameInput: string, parent = '', expectedRoot?: string): Promise<LibraryEntry> {
    return this.serialize(async () => {
      await this.checkExpectedRoot('projects', expectedRoot);
      const remote = gitRemoteSchema.parse(remoteInput), name = nameInput.trim();
      if (!name || name.length > 120 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name.startsWith('.') || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('项目目录名不符合跨平台文件命名规则');
      const root = await this.root('projects'), base = await this.resolve('projects', parent), target = path.join(base, name);
      await this.destination('projects', base);
      // Reserve the destination exclusively; never remove a pre-existing directory on failure.
      try { await mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标项目目录已存在'); throw error; }
      try { await this.gitCommand(base, ['clone', '--', remote, target], 180_000); }
      catch { await rm(target, { recursive: true, force: true }); await this.projectAudit(base, slash(path.relative(root, target)), 'Git 导入失败'); throw new Error('Git 导入失败，请检查地址、网络或凭据'); }
      const git = await this.git(target); if (!git || git.warning) throw new Error('仓库已下载，但 Git 信息读取失败，文件已保留');
      const metadata = metadataSchema.parse({ schemaVersion: 1, kind: 'project', name, languages: await this.languages(target), git: { remote, provider: git.provider } });
      await this.central.store.save(target, metadata, 'git');
      await this.projectAudit(target, slash(path.relative(root, target)), '通过 DevHaven 导入 Git 项目');
      return this.entry(root, target);
    });
  }
  async overview(): Promise<LibraryOverview> {
    const root = await this.root('knowledge'), collections: LibraryEntry[] = [], documents: LibraryEntry[] = [], warnings: string[] = [];
    const visit = async (directory: string, depth: number) => {
      if (this.central && !this.central.store.allowed(directory)) return;
      if (depth > 6) return;
      let names: string[]; try { names = await readdir(directory); } catch { warnings.push(`无法读取 ${slash(path.relative(root, directory))}`); return; }
      if (depth === 1) collections.push(await this.entry(root, directory));
      for (const name of names) {
        if (name.startsWith('.') || ignored.has(name)) continue;
        const file = path.join(directory, name);
        try {
          const info = await lstat(file);
          if (info.isDirectory() && (await this.metadata(file)).metadata?.kind === 'collection') await visit(file, depth + 1);
          else if (info.isFile() && documentType(name).format !== 'unsupported' && !isChangelog(name)) documents.push(await this.entry(root, file));
        } catch { warnings.push(`无法读取 ${slash(path.relative(root, file))}`); }
      }
    };
    await visit(root, 0);
    const tags = [...new Set(collections.flatMap(entry => entry.tags))].sort();
    const recent = [...documents].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 12);
    return { root, collections: collections.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN')), documents, recent, tags, warnings };
  }
  private async languages(directory: string) {
    const found = new Set<string>(); let files = 0;
    const mapping: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift', '.vue': 'Vue', '.php': 'PHP', '.rb': 'Ruby' };
    const visit = async (dir: string, depth: number) => {
      for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (files++ > 1200) return;
        if (item.name.startsWith('.') || ignored.has(item.name) || item.isSymbolicLink()) continue;
        if (item.isFile()) {
          const language = mapping[path.extname(item.name)]; if (language) found.add(language);
          const manifest: Record<string, string> = { 'go.mod': 'Go', 'Cargo.toml': 'Rust', 'pom.xml': 'Java', 'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'tsconfig.json': 'TypeScript' };
          if (manifest[item.name]) found.add(manifest[item.name]);
        } else if (item.isDirectory() && depth < 2) await visit(path.join(dir, item.name), depth + 1);
      }
    };
    await visit(directory, 0); return [...found].sort();
  }
}
