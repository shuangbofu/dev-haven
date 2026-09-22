'use client';

import { useEffect, useRef, useState } from 'react';
import type { MemoryTask } from '@/shared/memory';
import { Button } from './ui/button';
import { Pagination } from './list-controls';
import { AgentContent } from './agent-event-content';
import { ArrowLeft, Check, CircleAlert, Loader2, Terminal, Brain, Circle, ChevronRight, Bug, Search } from 'lucide-react';
import type { AgentEvent } from '@/shared/agent-event';

const names = { queued: '等待中', running: '执行中', completed: '完成', failed: '失败', cancelled: '已取消', info: '状态' };
const sectionsOf = (event: AgentEvent) => event.sections ?? (event.kind === 'message' || event.kind === 'reasoning' ? [{ label: '内容', format: 'markdown' as const, content: event.detail }] : []);

export function AgentTaskStream({ task }: { task: MemoryTask }) {
  const [page, setPage] = useState(1), [following, setFollowing] = useState(true);
  const [view, setView] = useState<'process' | 'diagnostics' | 'detail'>('process');
  const [selectedId, setSelectedId] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const events = task.events ?? [], pageSize = 20, selected = events.find(event => event.id === selectedId);
  const last = Math.max(1, Math.ceil(events.length / pageSize)), current = following ? last : Math.min(page, last);
  useEffect(() => { if (following && view === 'process') viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); }, [following, view, current, events]);
  const open = (event: AgentEvent) => { setSelectedId(event.id); setView('detail'); };
  return <div className="agent-task-stream"><div className="agent-stream-toolbar">
    {view !== 'process' ? <><Button size="sm" variant="ghost" onClick={() => setView('process')}><ArrowLeft />执行过程</Button><strong>{view === 'diagnostics' ? '诊断日志' : selected?.title ?? '调用详情'}</strong></> : <><span>{names[task.status === 'success' ? 'completed' : task.status]}</span><Button size="sm" variant="ghost" aria-pressed={following} onClick={() => { setPage(current); setFollowing(!following); }}>跟随最新{following ? ' · 开' : ' · 关'}</Button><Pagination page={current} pageSize={pageSize} total={events.length} onChange={value => { setFollowing(false); setPage(value); }} /></>}
    {view !== 'diagnostics' && <Button size="sm" variant="ghost" className="agent-diagnostic-button" onClick={() => setView('diagnostics')}><Bug />诊断</Button>}
  </div><div ref={viewport} className="agent-stream-content" onWheel={() => setFollowing(false)}>
    {view === 'diagnostics' ? <div className="agent-diagnostic-view"><p>应用准备、CLI 运行诊断与原始事件，用于排查问题。</p>{task.error && <p className="library-warning">{task.error}</p>}<pre>{task.logs.join('\n') || '暂无诊断日志'}</pre><h4>原始事件</h4>{events.map(event => <section key={event.id}><h5>{event.title} · {new Date(event.startedAt).toLocaleTimeString()}</h5><pre>{event.detail}</pre></section>)}</div> : view === 'detail' ? selected ? <div className="agent-call-detail"><div className="agent-detail-meta"><span>{names[selected.status]}</span><time>{new Date(selected.startedAt).toLocaleTimeString()}</time></div>{sectionsOf(selected).map((section, index) => <section key={index}><h4>{section.label}</h4><AgentContent section={section} /></section>)}</div> : <p>该事件已超出保留范围</p> : <>
      {task.error && <p className="library-warning">{task.error}</p>}{!!task.eventsOmitted && <p className="project-muted">较早的 {task.eventsOmitted} 条过程已省略</p>}
      <div className="agent-timeline">{events.slice((current - 1) * pageSize, current * pageSize).map(event => <EventEntry key={event.id} event={event} onOpen={() => open(event)} />)}</div>
      {!events.length && <p className="project-muted">{task.status === 'queued' ? '等待执行…' : task.status === 'running' ? '等待 Codex 事件…' : '没有采集到过程事件'}</p>}
    </>}
  </div></div>;
}

function EventEntry({ event, onOpen }: { event: AgentEvent; onOpen: () => void }) {
  if (event.kind === 'message') return <article className="agent-timeline-message">{sectionsOf(event).map((section, index) => <AgentContent key={index} section={section} />)}</article>;
  const Icon = event.status === 'running' ? Loader2 : event.status === 'failed' ? CircleAlert : event.kind === 'reasoning' ? Brain : event.title === '搜索网页' ? Search : event.kind === 'call' ? Terminal : event.status === 'completed' ? Check : Circle;
  const duration = Math.max(0, (Date.parse(event.updatedAt) - Date.parse(event.startedAt)) / 1000), interactive = !!sectionsOf(event).length;
  const content = <><Icon size={15} className={event.status === 'running' ? 'animate-spin' : ''} /><span className="agent-action-description"><strong>{event.title}</strong>{event.summary && <span title={event.summary}>{event.summary}</span>}</span><span className="agent-action-state">{names[event.status]}</span>{duration > 0 && <small>{duration.toFixed(1)}s</small>}{interactive && <ChevronRight size={14} />}</>;
  return <article className={`agent-timeline-action agent-action-${event.status}`}>{interactive ? <button onClick={onOpen} aria-label={`查看${event.title}详情`}>{content}</button> : <div>{content}</div>}</article>;
}
