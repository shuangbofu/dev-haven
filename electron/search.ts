import { htmlText } from './html-text';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryConfig, MemoryEntity } from '../src/shared/memory';
import { searchQuerySchema, type SearchQuery, type SearchHit, type SearchResults } from '../src/shared/search';
import { contains, ignoredDirectories, sourcePath } from './memory-files';

const extensions = new Set(['.html', '.htm', '.md', '.markdown', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv']);
const maxFile = 2 * 1024 * 1024;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const excludedName = (name: string) => name.startsWith('.') || ignoredDirectories.has(name) || /^(?:change?logs?\.md|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|(?:credential|secret|private[-_]?key)|\.(?:pem|key|p12)$/i.test(name);

export interface IndexRow { hit: Omit<SearchHit, 'snippet' | 'matchedIn'>; metadata: string; body: string }
export class GlobalSearch {
  private current?: AbortController;
  private cache = new Map<string, { signature: string; text: string }>();
  private cacheSize = 0;
  cancel() { this.current?.abort(); }
  private async read(file: string) {
    const info = await stat(file);
    if (!info.isFile() || info.size > maxFile) throw new Error('文件超过 2 MB 或不是普通文件');
    const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    const cached = this.cache.get(file);
    if (cached?.signature === signature) return cached.text;
    const handle = await open(file, 'r');
    let text = '';
    try {
      if (!(await handle.stat()).isFile()) return '';
      const buffer = Buffer.alloc(maxFile + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxFile || buffer.subarray(0, bytesRead).includes(0)) return '';
      text = buffer.subarray(0, bytesRead).toString('utf8');
      if (/\.html?$/i.test(file)) text = htmlText(text);
    } finally { await handle.close(); }
    if (this.cacheSize + text.length > 32 * 1024 * 1024) { this.cache.clear(); this.cacheSize = 0; }
    this.cacheSize += text.length - (this.cache.get(file)?.text.length ?? 0);
    this.cache.set(file, { signature, text });
    return text;
  }
  async search(input: SearchQuery, config: MemoryConfig, entities: MemoryEntity[], collect?: (row: IndexRow) => void): Promise<SearchResults> {
    const { query, kind, page } = searchQuerySchema.parse(input);
    this.cancel(); const controller = this.current = new AbortController();
    const tokens = normalize(query).split(/\s+/).filter(Boolean).slice(0, 12);
    if (!tokens.length && !collect) return { items: [], total: 0, page: 1, pageSize: 30, partial: false, warnings: [] };
    const hits = new Map<string, SearchHit & { score: number }>();
    const warnings = new Set<string>();
    let visited = 0, bytes = 0, partial = false;
    let started = Date.now();
    // Reserve a share for every source so large knowledge roots cannot starve projects.
    const byteLimit = collect ? Math.floor(80 * 1024 * 1024 / Math.max(1, config.sources.length)) : 100 * 1024 * 1024;
    const check = () => {
      if (controller.signal.aborted) throw new Error('搜索已取消');
      if (visited > 20000 || bytes > byteLimit || Date.now() - started > 15000) { partial = true; return false; }
      return true;
    };
    const add = (hit: Omit<SearchHit, 'snippet' | 'matchedIn'>, metadata: string, body: string) => {
      if (collect) { collect({ hit, metadata, body }); return; }
      if (kind !== 'all' && kind !== hit.kind) return;
      const title = normalize(hit.title), meta = normalize(`${hit.path} ${metadata}`), content = normalize(body);
      if (!tokens.every(token => title.includes(token) || meta.includes(token) || content.includes(token))) return;
      const bodyOnly = tokens.some(token => !title.includes(token) && !meta.includes(token));
      const raw = (bodyOnly ? body : metadata || body).replace(/\s+/g, ' ').trim();
      const normalized = normalize(raw);
      const index = Math.min(...tokens.map(token => normalized.indexOf(token)).filter(index => index >= 0));
      const start = Number.isFinite(index) ? Math.max(0, index - 55) : 0;
      const snippet = `${start ? '…' : ''}${raw.slice(start, start + 190)}${raw.length > start + 190 ? '…' : ''}`;
      const score = tokens.reduce((value, token) => value + (title.includes(token) ? 10 : meta.includes(token) ? 5 : 1), 0);
      const result = { ...hit, snippet, matchedIn: bodyOnly ? hit.kind === 'project' ? 'README' : '正文' : tokens.every(token => title.includes(token)) ? '名称' : '元信息 / 路径', score };
      if (!hits.has(hit.id) || hits.get(hit.id)!.score < score) hits.set(hit.id, result);
    };
    for (const source of config.sources) {
      if (collect) { bytes = 0; visited = 0; started = Date.now(); }
      const excluded = [config.directory, config.reportsDirectory];
      const sourceEntities = entities.filter(item => item.sourceId === source.id);
      const projects = sourceEntities.filter(item => item.metadata.kind === 'project');
      for (const entity of projects) {
        if (!check()) break;
        try {
          const directory = await sourcePath(source, entity.path, excluded);
          if (!(await stat(directory)).isDirectory()) continue;
          let readme = '';
          const entry = (await readdir(directory, { withFileTypes: true })).filter(item => item.isFile() && /^readme(?:\.[\w-]+)?\.(?:md|markdown|txt|rst)$/i.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
          if (entry) {
            try { readme = await this.read(await sourcePath(source, [entity.path, entry.name].filter(Boolean).join('/'), excluded)); bytes += Buffer.byteLength(readme, 'utf8'); }
            catch { warnings.add(`${source.name}：部分 README 无法读取或超过 2 MB`); }
          }
          const m = entity.metadata;
          add({ id: `${source.id}:project:${entity.path}`, kind: 'project', sourceId: source.id, sourceName: source.name, path: entity.path, title: m.name, languages: m.languages }, [m.description, ...m.tags, ...m.languages, m.git?.remote ?? ''].join(' '), readme);
        } catch { if (controller.signal.aborted) throw new Error('搜索已取消'); }
      }
      if (kind === 'project') continue;
      const walk = async (relative: string, depth: number): Promise<void> => {
        if (!check()) return;
        if (depth > 20) { partial = true; return; }
        let children;
        try { children = await readdir(await sourcePath(source, relative, excluded), { withFileTypes: true }); }
        catch { warnings.add(`${source.name}：部分目录不可读取或已排除`); return; }
        for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!check()) return;
          if (entry.isSymbolicLink() || excludedName(entry.name)) continue;
          const child = [relative, entry.name].filter(Boolean).join('/');
          if (excluded.some(directory => contains(directory, path.join(source.directory, ...child.split('/'))))) continue;
          if (source.excludes.some(item => item && (child === item || child.startsWith(`${item}/`)))) continue;
          if (entry.isDirectory()) { visited++; await walk(child, depth + 1); continue; }
          if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
          if (source.kind === 'projects' && !/\.(?:md|markdown|html?|txt|rst)$/i.test(entry.name)) continue;
          visited++;
          try {
            const file = await sourcePath(source, child, excluded);
            const body = await this.read(file); bytes += Buffer.byteLength(body, 'utf8');
            const owner = sourceEntities.filter(item => !item.path || child.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
            const project = projects.filter(item => !item.path || child.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
            const title = body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || entry.name;
            add({ id: `${source.id}:document:${child}`, kind: 'document', sourceId: source.id, sourceName: source.name, path: child, title, projectPath: project?.path, languages: [] }, [owner?.metadata.name ?? '', owner?.metadata.description ?? '', ...(owner?.metadata.tags ?? [])].join(' '), body);
          } catch { warnings.add(`${source.name}：部分文件无法读取或超过 2 MB`); }
        }
      };
      await walk('', 0);
    }
    check();
    const sorted = [...hits.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
    const pageSize = 30, current = Math.min(page, Math.max(1, Math.ceil(sorted.length / pageSize)));
    return { items: sorted.slice((current - 1) * pageSize, current * pageSize).map(({ score: _score, ...hit }) => hit), total: sorted.length, page: current, pageSize, partial, warnings: [...warnings] };
  }
}
