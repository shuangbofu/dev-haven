'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, FolderOpen, Loader2, Pencil, RefreshCw, Save, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DesktopAPI } from '@/shared/types';
import { localDate, reportRange, reportNames, type ReportPeriod, type MemorySnapshot } from '@/shared/memory';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { MarkdownReader } from './markdown-reader';
import { ToolbarSearch, WorkspaceToolbar } from './workspace-toolbar';
import { Pagination, Segments } from './list-controls';
import { EventRows, originNames } from './change-history';
import { MemoryEntities } from './memory-entities';
import { AgentTaskStream } from './agent-task-stream';
import { paginate, type Page } from '@/shared/pagination';
import type { MemoryEvent } from '@/shared/memory';

const statuses = { queued: '等待中', running: '执行中', success: '已完成', failed: '失败', cancelled: '已取消' };
export function MemoryWorkspace({ api, snapshot, active }: { api: DesktopAPI; snapshot: MemorySnapshot; active: boolean }) {
  const [tab, setTab] = useState('events');
  const [sourceId, setSourceId] = useState('');
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState<string>();
  const [date, setDate] = useState(localDate());
  const [period, setPeriod] = useState<ReportPeriod>('daily');
  const range = reportRange(date || localDate(), period);
  const reportName = reportNames[period];
  const rangeLabel = period === 'daily' ? range.start : `${range.start} ~ ${range.end}`;
  const [reportId, setReportId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<Page<MemoryEvent>>();
  const [eventsError, setEventsError] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const eventsSignature = JSON.stringify(snapshot.events);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page, tab, sourceId, origin, query]);
  useEffect(() => { setPage(1); }, [origin, sourceId, query, tab]);
  useEffect(() => {
    if (!active || tab !== 'events') return;
    let cancelled = false;
    setEventsLoading(true); setEventsError('');
    const timer = setTimeout(() => {
      void api.memoryEvents({ page, origin: origin as MemoryEvent['origin'] || undefined, sourceId: sourceId || undefined, query }).then(result => { if (!cancelled) setEvents(result); }).catch(error => { if (!cancelled) { setEventsError(String(error)); } }).finally(() => { if (!cancelled) setEventsLoading(false); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, active, tab, origin, sourceId, query, page, eventsSignature]);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch (error) { toast.error(String(error)); } finally { setBusy(false); } };
  const sourceName = (id: string) => snapshot.config.sources.find(source => source.id === id)?.name ?? '已移除来源';
  const task = snapshot.tasks.find(task => task.id === taskId);
  const versions = snapshot.reports.filter(report => report.date === range.start && (report.period ?? 'daily') === period);
  const report = versions.find(report => report.id === reportId) ?? versions[0];
  const reportTask = snapshot.tasks.find(task => task.kind === 'report' && task.date === range.start && (task.period ?? 'daily') === period);
  const reportPending = !!reportTask && ['queued', 'running'].includes(reportTask.status);
  const matching = (id: string, text: string) => (!sourceId || id === sourceId) && text.toLowerCase().includes(query.toLowerCase());
  const taskPage = paginate(snapshot.tasks.filter(item => matching(item.sourceId ?? '', `${sourceName(item.sourceId ?? '')} ${item.date ?? ''} ${statuses[item.status]} ${item.kind === 'report' ? reportNames[item.period ?? 'daily'] : '扫描'} ${item.error ?? ''}`)), { page, pageSize: 10 });
  return <section className="memory-workspace" hidden={!active}>
    <WorkspaceToolbar title="记忆"
      search={tab !== 'reports' && <ToolbarSearch label="搜索记忆" value={query} onChange={setQuery} />}
      filters={tab === 'reports' ? <>
        <Input type="date" aria-label="报告日期" disabled={editing || busy} value={date} onChange={event => { if (!event.target.value) return; setDate(event.target.value); setReportId(''); setEditing(false); }} />
        {report && <select aria-label="报告版本" disabled={editing || busy} value={report.id} onChange={event => { setReportId(event.target.value); setEditing(false); }}>{versions.map((version, index) => <option key={version.id} value={version.id}>{index === 0 ? '最新版本' : '历史版本'} · {new Date(version.createdAt).toLocaleString()}</option>)}</select>}
      </> : undefined}
      actions={<>
        <Button size="icon" variant="ghost" title={tab === 'reports' ? '打开报告目录' : '打开记忆目录'} aria-label={tab === 'reports' ? '打开报告目录' : '打开记忆目录'} onClick={() => void run(() => api.memoryReveal(tab === 'reports' ? 'reports' : 'memory'))}><FolderOpen /></Button>
        {tab === 'reports' ? <>
          {report && <Button size="icon" variant="ghost" title={editing ? '取消编辑' : '编辑报告'} aria-label={editing ? '取消编辑' : '编辑报告'} disabled={busy || reportPending || report.id !== versions[0]?.id} onClick={() => { setDraft(report.content); setEditing(!editing); }}>{editing ? <X /> : <Pencil />}</Button>}
          {editing && report ? <Button disabled={busy} onClick={() => void run(async () => { await api.memorySaveReport(report.id, draft, report.revision); setEditing(false); setReportId(''); })}><Save />保存</Button> : <Button disabled={busy || !date || reportPending} onClick={() => void run(async () => { await api.memoryReport(date, period); setReportId(''); })}>{reportPending ? <Loader2 className="animate-spin" /> : <CalendarDays />}{reportPending ? reportTask.status === 'queued' ? '等待生成' : '生成中' : report ? '重新生成' : `生成${reportName}`}</Button>}
        </> : <Button variant="outline" disabled={busy} title={sourceId ? '刮削当前来源' : '刮削所有已启用的来源'} onClick={() => void run(async () => { for (const source of snapshot.config.sources.filter(source => sourceId ? source.id === sourceId : source.scan)) await api.memoryScan(source.id); setQuery(''); setTab('tasks'); })}><RefreshCw />刮削</Button>}
      </>} />
    <nav className="memory-navigation" aria-label="记忆导航">{[['events', '变更记录'], ['entities', '元数据'], ['tasks', '扫描任务'], ['reports', '报告']].map(([value, label]) => <button key={value} aria-current={tab === value ? 'page' : undefined} disabled={editing && value !== tab} onClick={() => { setTab(value); setEditing(false); }}>{label}</button>)}</nav>
    {tab === 'reports' && <div className="report-controls"><nav className="report-navigation" aria-label="报告类型">{(Object.entries(reportNames) as [ReportPeriod, string][]).map(([value, label]) => <button key={value} aria-current={period === value ? 'page' : undefined} disabled={editing || busy} onClick={() => { setPeriod(value); setReportId(''); }}>{label}</button>)}</nav><span>{rangeLabel}{period === 'weekly' && ' · 周一至周日'}</span></div>}
    {tab !== 'reports' && <div className="memory-controls">
      {snapshot.config.sources.length > 1 && <Segments label="来源目录" value={sourceId} onChange={setSourceId} options={[{ value: '', label: '全部目录' }, ...snapshot.config.sources.map(source => ({ value: source.id, label: `${source.kind === 'projects' ? '项目' : '知识'} · ${source.name}`, title: source.directory }))]} />}
      {tab === 'events' && <div className="memory-control-row"><Segments label="记录来源" value={origin} onChange={setOrigin} options={[{ value: '', label: '全部记录来源' }, ...(['git', 'scan', 'agent', 'app'] as const).map(value => ({ value, label: originNames[value] }))]} /></div>}
      {tab === 'events' && <Pagination {...(events ?? { page: 1, pageSize: 20, total: 0 })} onChange={setPage} busy={eventsLoading} />}
      {tab === 'tasks' && <Pagination {...taskPage} onChange={setPage} />}
    </div>}
    <div ref={content} aria-busy={tab === 'events' && eventsLoading} className={`memory-content${tab === 'reports' ? ' memory-report-content' : tab === 'entities' ? ' memory-entity-content' : ''}`}>
    {tab === 'reports' && reportTask && <div className="report-task-status" role={reportTask.status === 'failed' ? 'alert' : 'status'}>
      <span>{reportTask.status === 'queued' ? `${reportName}等待生成` : reportTask.status === 'running' ? `正在生成${reportName}` : reportTask.status === 'success' ? `${reportName}生成完成` : reportTask.status === 'cancelled' ? `${reportName}生成已取消` : `${reportName}生成失败`}{reportTask.error && <span className="report-task-error">{reportTask.error}</span>}</span>
      <Button size="sm" variant="ghost" onClick={() => setTaskId(reportTask.id)}>任务日志</Button>
      {reportPending && <Button size="icon" variant="ghost" title="取消生成报告" aria-label="取消生成报告" disabled={busy} onClick={() => void run(() => api.memoryCancel(reportTask.id))}><Square /></Button>}
    </div>}
    {tab === 'events' && <>{eventsError && <p role="alert" className="library-warning">{eventsError}</p>}{events && <><EventRows items={events.items} sources={snapshot.config.sources} entities={snapshot.entities} />{!events.total && <p className="library-placeholder">暂无匹配的记录</p>}</>}</>}
    {tab === 'entities' && <MemoryEntities key={`${sourceId}:${query}`} sources={snapshot.config.sources} entities={snapshot.entities.filter(entity => matching(entity.sourceId, `${entity.metadata.name} ${entity.metadata.description} ${entity.path} ${entity.metadata.tags.join(' ')} ${entity.metadata.languages.join(' ')}`))} />}
    {tab === 'tasks' && <><div className="memory-task-list">{taskPage.items.map(item => <article key={item.id}><button onClick={() => setTaskId(item.id)}><strong>{item.kind === 'scan' ? `扫描 ${sourceName(item.sourceId!)}` : `${item.date} ${reportNames[item.period ?? 'daily']}`}</strong><small>{new Date(item.createdAt).toLocaleString()} · {statuses[item.status]}</small>{item.error && <p>{item.error}</p>}</button>{['queued', 'running'].includes(item.status) ? <Button size="icon" variant="ghost" title="取消任务" aria-label="取消任务" onClick={() => void run(() => api.memoryCancel(item.id))}><Square /></Button> : <Button size="icon" variant="ghost" title="重新执行" aria-label="重新执行" disabled={busy} onClick={() => void run(() => item.kind === 'scan' ? api.memoryScan(item.sourceId!) : api.memoryReport(item.date!, item.period))}><RefreshCw /></Button>}</article>)}</div>{!taskPage.total && <p className="library-placeholder">暂无匹配的任务</p>}</>}
    {tab === 'reports' && (report ? editing ? <textarea className="document-editor" aria-label="报告内容" value={draft} onChange={event => setDraft(event.target.value)} /> : <div className="memory-report-reader"><MarkdownReader key={report.id} title={`${rangeLabel} 个人${reportName}`} content={report.content} onLink={href => { if (/^https?:\/\//i.test(href)) void api.openLink(href); }} /></div> : <p className="library-placeholder">本期尚未生成个人{reportName}</p>)}
    </div>
    <Dialog open={!!taskId} onOpenChange={open => { if (!open) setTaskId(undefined); }}><DialogContent aria-describedby={undefined} className="agent-task-dialog"><DialogTitle>执行过程</DialogTitle>{task && <AgentTaskStream key={task.id} task={task} />}</DialogContent></Dialog>
  </section>;
}
