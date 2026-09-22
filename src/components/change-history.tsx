'use client';

import { useEffect, useRef, useState } from 'react';
import type { LibraryClient } from '@/shared/types';
import { eventContext, type MemoryEvent, type MemoryEntity, type MemorySource } from '@/shared/memory';
import type { GitCommit } from '@/shared/library';
import type { Page } from '@/shared/pagination';
import { Pagination } from './list-controls';

export const originNames = { git: 'Git 本人提交', app: '应用操作', agent: 'Agent 记录', scan: 'Agent 识别' };
const eventTime = (value: string) => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export function EventRows({ items, sources = [], entities = [] }: { items: MemoryEvent[]; sources?: MemorySource[]; entities?: MemoryEntity[] }) {
  return <div className="memory-event-list">{items.map(event => {
    const context = eventContext(event, sources, entities);
    return <article key={event.id}><time dateTime={event.occurredAt ?? event.recordedAt} title={`记录时间：${eventTime(event.recordedAt)}`}>{eventTime(event.occurredAt ?? event.recordedAt)}{!event.occurredAt && <small>发现时间</small>}</time><div>
      <div className="event-context">{event.origin && <span className="event-origin">{originNames[event.origin]}</span>}{context.kind && <span>{context.kind === 'projects' ? '项目' : '知识库'}</span>}<b>{context.name}</b>{context.target && <code>{context.target}</code>}</div>
      <strong>{event.message}</strong>
      <small>{[context.sourceName, event.path || '根目录'].filter(Boolean).join(' / ')}{event.git && <> · <code>{event.git.hash.slice(0, 8)}</code> · {event.git.author} &lt;{event.git.email}&gt;</>}{!event.reportable && ' · 不计入报告'}</small>
      {event.evidence.length > 0 && <details className="event-evidence"><summary>依据文件（{event.evidence.length}）</summary>{event.evidence.map(file => <code key={file}>{file}</code>)}</details>}
    </div></article>;
  })}</div>;
}

export function ChangeHistory({ api, path, git = false }: { api: LibraryClient; path: string; git?: boolean }) {
  const [page, setPage] = useState(1);
  const controls = useRef<HTMLDivElement>(null);
  const revision = useRef<string>(undefined);
  const [data, setData] = useState<Page<MemoryEvent | GitCommit>>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const request = git ? api.libraryGitHistory(path, page, revision.current) : api.libraryHistory(path, { page });
    void request.then(result => {
      if (cancelled) return;
      setData(result);
      if ('revision' in result && result.revision) revision.current = result.revision;
    }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, path, git, page]);
  return <section className="change-history" aria-busy={loading}>
    <div ref={controls} className="history-controls">{git && <span className="project-muted">本人提交 · 作者时间</span>}<Pagination {...(data ?? { page: 1, pageSize: 20, total: 0 })} onChange={value => { setPage(value); controls.current?.scrollIntoView({ block: 'start' }); }} busy={loading} /></div>
    {error && <p role="alert" className="library-warning">{error}</p>}
    {data && (git ? <div className="memory-event-list">{(data.items as GitCommit[]).map(commit => <article key={commit.hash}><time>{eventTime(commit.date)}</time><div><strong>{commit.message}</strong><small><code>{commit.hash.slice(0, 8)}</code> · {commit.author}</small></div></article>)}</div> : <EventRows items={data.items as MemoryEvent[]} />)}
    {data && !data.total && <p className="library-placeholder">暂无{git ? 'Git 提交' : '变更记录'}</p>}
  </section>;
}
