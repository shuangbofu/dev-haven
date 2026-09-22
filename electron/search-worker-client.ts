import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { MemoryConfig, MemoryEntity } from '../src/shared/memory';
import type { SearchQuery, SearchResults, SearchIndexStatus } from '../src/shared/search';
/** Crawling, indexing and querying run off Electron's main/UI thread. */
export class SearchWorkerClient {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(private directory: string) {}
  private call<T>(operation: string, data = {}): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(path.join(this.directory, 'search-worker.cjs'));
      this.worker.on('message', ({ id, value, error }) => { const request = this.pending.get(id); if (!request) return; this.pending.delete(id); if (error) request.reject(new Error(error)); else request.resolve(value); });
      this.worker.on('error', error => { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); });
      this.worker.on('exit', () => { this.worker = undefined; for (const request of this.pending.values()) request.reject(new Error('索引工作进程已退出')); this.pending.clear(); });
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker!.postMessage({ id, operation, ...data }); });
  }
  rebuild(config: MemoryConfig, entities: MemoryEntity[]) { return this.call<void>('rebuild', { config, entities }); }
  search(query: SearchQuery, config: MemoryConfig) { return this.call<SearchResults>('search', { query, config }); }
  status() { return this.call<SearchIndexStatus>('status'); }
  cancel() { return this.call<void>('cancel'); }
  dispose() { void this.worker?.terminate(); }
}
