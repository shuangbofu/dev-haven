import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { MemoryConfig, MemoryEntity } from '../src/shared/memory';
import { searchQuerySchema, type SearchQuery, type SearchResults, type SearchIndexStatus } from '../src/shared/search';
import { atomicJSON, sourcePath } from './memory-files';
import { GlobalSearch, type IndexRow } from './search';
const normalized = (text: string) => text.normalize('NFKC').toLowerCase();
const scope = (config: MemoryConfig) => createHash('sha256').update(JSON.stringify([config.directory, config.reportsDirectory, config.sources])).digest('hex');
const hitSchema = z.object({ id: z.string(), kind: z.enum(['document', 'project']), sourceId: z.string(), sourceName: z.string(), path: z.string(), title: z.string(), projectPath: z.string().optional(), languages: z.array(z.string()) });
const diskSchema = z.object({ version: z.literal(1), scope: z.string(), indexedAt: z.string(), partial: z.boolean(), warnings: z.array(z.string()), rows: z.array(z.object({ hit: hitSchema, metadata: z.string(), body: z.string() })).max(22000) });
type Snapshot = z.infer<typeof diskSchema>;
type Prepared = IndexRow & { titleText: string; metaText: string; bodyText: string };

/** Persistent text index. Queries perform no tree traversal or file-content reads. */
export class LocalSearchIndex {
  private snapshot?: Snapshot;
  private rows: Prepared[] = [];
  private scanner = new GlobalSearch();
  private building?: Promise<void>;
  private loading?: Promise<void>;
  private loadedScope = '';
  private error?: string;
  private queryGeneration = 0;
  private diskStamp = '';
  status(): SearchIndexStatus { return { indexedAt: this.snapshot?.indexedAt, indexing: !!this.building, documents: this.rows.length, partial: this.snapshot?.partial ?? false, error: this.error }; }
  cancel() { this.queryGeneration++; }
  private file(config: MemoryConfig) { return path.join(config.directory, 'search-index.json'); }
  private install(snapshot: Snapshot) {
    this.rows = snapshot.rows.map(row => ({ ...row, titleText: normalized(row.hit.title), metaText: normalized(`${row.hit.path} ${row.metadata}`), bodyText: normalized(row.body) }));
    this.snapshot = snapshot;
  }
  async load(config: MemoryConfig): Promise<void> {
    const signature = scope(config);
    if (this.loading) await this.loading;
    if (this.loadedScope !== signature) { this.snapshot = undefined; this.rows = []; this.diskStamp = ''; this.loadedScope = signature; }
    this.loading = (async () => {
      try {
        const info = await stat(this.file(config));
        const stamp = `${info.mtimeMs}:${info.size}`;
        if (stamp === this.diskStamp) return;
        if (info.size > 150 * 1024 * 1024) throw new Error('搜索索引超过大小限制，请重建');
        const snapshot = diskSchema.parse(JSON.parse(await readFile(this.file(config), 'utf8')));
        if (this.loadedScope !== signature) return;
        this.diskStamp = stamp;
        if (snapshot.scope === signature) { this.install(snapshot); this.error = undefined; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = '索引无法读取，请重建本地索引'; }
    })().finally(() => { this.loading = undefined; });
    await this.loading;
  }
  async rebuild(config: MemoryConfig, entities: MemoryEntity[]): Promise<void> {
    if (this.building) { await this.building; if (this.snapshot?.scope === scope(config)) return; }
    const captured = structuredClone(config), signature = scope(captured);
    await this.load(captured);
    this.building = (async () => {
      const rows: IndexRow[] = [];
      const result = await this.scanner.search({ query: '', kind: 'all' }, captured, entities, row => rows.push(row));
      const snapshot: Snapshot = { version: 1, scope: signature, indexedAt: new Date().toISOString(), rows, partial: result.partial, warnings: result.warnings };
      await atomicJSON(this.file(captured), snapshot);
      if (this.loadedScope === signature) {
        this.install(snapshot); this.error = undefined;
        const info = await stat(this.file(captured)); this.diskStamp = `${info.mtimeMs}:${info.size}`;
      }
    })().catch(error => { this.error = String(error); throw error; }).finally(() => { this.building = undefined; });
    return this.building;
  }
  async search(input: SearchQuery, config: MemoryConfig): Promise<SearchResults> {
    const { query, kind, page } = searchQuerySchema.parse(input);
    const generation = ++this.queryGeneration;
    await this.load(config);
    const tokens = normalized(query).split(/\s+/).filter(Boolean).slice(0, 12);
    const warnings = [...(this.snapshot?.warnings ?? [])];
    if (this.error) warnings.push(this.error);
    if (!this.snapshot) warnings.push('本地搜索索引尚未就绪，请构建索引');
    const result = [];
    for (const row of tokens.length ? this.rows : []) {
      if (kind !== 'all' && row.hit.kind !== kind) continue;
      if (!tokens.every(token => row.titleText.includes(token) || row.metaText.includes(token) || row.bodyText.includes(token))) continue;
      const bodyOnly = tokens.some(token => !row.titleText.includes(token) && !row.metaText.includes(token));
      const raw = (bodyOnly ? row.body : row.metadata || row.body).replace(/\s+/g, ' ').trim();
      const text = normalized(raw), indexes = tokens.map(token => text.indexOf(token)).filter(index => index >= 0);
      const start = indexes.length ? Math.max(0, Math.min(...indexes) - 55) : 0;
      result.push({ ...row.hit, snippet: `${start ? '…' : ''}${raw.slice(start, start + 190)}${raw.length > start + 190 ? '…' : ''}`, matchedIn: bodyOnly ? row.hit.kind === 'project' ? 'README' : '正文' : tokens.every(token => row.titleText.includes(token)) ? '名称' : '元信息 / 路径', score: tokens.reduce((score, token) => score + (row.titleText.includes(token) ? 10 : row.metaText.includes(token) ? 5 : 1), 0) });
    }
    result.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
    const pageSize = 30, current = Math.min(page, Math.max(1, Math.ceil(result.length / pageSize)));
    const items = [];
    // Revalidate returned paths against exclusions and symlinks, without rereading contents.
    for (const { score: _score, ...hit } of result.slice((current - 1) * pageSize, current * pageSize)) {
      try {
        const source = config.sources.find(source => source.id === hit.sourceId);
        if (!source) continue;
        await sourcePath(source, hit.path, [config.directory, config.reportsDirectory]); items.push(hit);
      } catch { warnings.push('部分索引路径已变化，等待下一次刷新'); }
    }
    if (generation !== this.queryGeneration) throw new Error('搜索已取消');
    return { items, total: result.length, page: current, pageSize, partial: this.snapshot?.partial ?? false, warnings: [...new Set(warnings)], indexedAt: this.snapshot?.indexedAt, indexing: !!this.building };
  }
}
