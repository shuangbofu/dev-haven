'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Code, Download, ExternalLink, FolderOpen, GitBranch, History, Pencil, RefreshCw } from 'lucide-react';
import { MarkdownReader } from './markdown-reader';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { LanguageLogo, MetadataDialog } from './library-workspace';
import type { DesktopAPI, LibraryClient } from '@/shared/types';
import type { ChangeLogEntry, SelectedDestination, LibraryDocument, LibraryEntry, ProjectListing } from '@/shared/library';
import { DestinationField } from './destination-field';
import type { MemorySource } from '@/shared/memory';
import { scopedLibrary } from '@/lib/scoped-library';
import { ToolbarSearch, WorkspaceToolbar } from './workspace-toolbar';
import { Pagination, Segments, SourceTabs } from './list-controls';
import { paginate } from '@/shared/pagination';
import { ChangeHistory } from './change-history';
import type { ProjectSearchTarget } from '@/shared/search';

const message = (error: unknown) => String(error).replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/, '');
const report = (error: unknown) => toast.error(message(error), { duration: 7000 });
const providerName = (project: LibraryEntry) => ({ github: 'GitHub', gitlab: 'GitLab', enterprise: '企业 Git', other: 'Git' }[project.git?.provider ?? 'other']);
const gitState = (project: LibraryEntry) => !project.git ? '本地项目' : project.git.warning ? 'Git 状态不可用' : project.git.dirty ? '有未提交改动' : '工作区干净';
type DetailTab = 'overview' | 'readme' | 'changes' | 'git';

export function ProjectWorkspace({ api, active, sources, target, onTargetHandled }: { api: DesktopAPI; active: boolean; sources: MemorySource[]; target?: ProjectSearchTarget; onTargetHandled?: (id: string) => void }) {
  const [id, setId] = useState('');
  const [importedTarget, setImportedTarget] = useState<ProjectSearchTarget>();
  useEffect(() => { if (target) setId(target.sourceId); }, [target]);
  const available = sources.filter(source => source.kind === 'projects');
  const selected = available.find(source => source.id === id) ?? available[0];
  const scoped = useMemo(() => selected ? scopedLibrary(api, selected.id) : undefined, [api, selected?.id, selected?.directory]);
  if (!selected || !scoped) return <section hidden={!active}><WorkspaceToolbar title="项目" /><p className="library-placeholder">尚未配置项目目录</p></section>;
  return <ProjectContent key={`${selected.id}:${selected.directory}`} api={scoped} active={active} sources={available} sourceId={selected.id} onImported={(sourceId, path) => { setId(sourceId); setImportedTarget({ sourceId, path, id: crypto.randomUUID() }); }} onTargetHandled={value => { if (importedTarget?.id === value) setImportedTarget(undefined); else onTargetHandled?.(value); }} target={importedTarget?.sourceId === selected.id ? importedTarget : target?.sourceId === selected.id ? target : undefined} sourceControl={<SourceTabs sources={available} value={selected.id} onChange={setId} />} />;
}
function ProjectContent({ api, active, sourceControl, target, onTargetHandled, sources, sourceId, onImported }: { sources: MemorySource[]; sourceId: string; onImported: (sourceId: string, path: string) => void; api: LibraryClient; active: boolean; sourceControl: React.ReactNode; target?: ProjectSearchTarget; onTargetHandled?: (id: string) => void }) {
  const [data, setData] = useState<ProjectListing>();
  const [root, setRoot] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>();
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, group, language, tag]);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [groupChanges, setGroupChanges] = useState(false);
  const [readme, setReadme] = useState<LibraryDocument | null>();
  const [readmeError, setReadmeError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [remote, setRemote] = useState('');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState<SelectedDestination>();
  const [importError, setImportError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const request = useRef(0);
  const operation = useRef(false);
  const selected = data?.entries.find(entry => entry.path === selectedPath);
  const currentGroup = data?.groups.find(entry => entry.path === group);
  const appliedTarget = useRef<string>(undefined);
  useEffect(() => {
    if (!active || loading || !data || !target || appliedTarget.current === target.id) return;
    appliedTarget.current = target.id;
    setSelectedPath(target.path); setTab('overview'); setGroupChanges(false);
    onTargetHandled?.(target.id);
  }, [active, loading, data, target, onTargetHandled]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const settings = await api.librarySettings();
      const next = settings.projects ? await api.libraryProjects() : undefined;
      if (id !== request.current) return;
      setRoot(previous => {
        if (previous !== (settings.projects ?? '')) { setSelectedPath(undefined); setGroup(''); }
        return settings.projects ?? '';
      });
      setData(next);
    } catch (error) { if (id === request.current) setError(message(error)); }
    finally { if (id === request.current) setLoading(false); }
  }, [api]);
  useEffect(() => { if (active) void load(); return () => { request.current++; }; }, [active, load]);
  useEffect(() => {
    if (selectedPath === undefined || !active) return;
    let cancelled = false;
    setReadme(undefined); setReadmeError('');
    void api.libraryProjectReadme(selectedPath).then(value => { if (!cancelled) setReadme(value); }).catch(error => {
      if (!cancelled) { setReadme(null); setReadmeError(message(error)); }
    });
    return () => { cancelled = true; };
  }, [api, selectedPath, data, active, root]);

  const pull = async () => {
    if (!selected || operation.current) return;
    operation.current = true; setBusy(true);
    try { await api.libraryPullProject(selected.path); toast.success('更新检查完成，已记录变更'); }
    catch (error) { report(error); }
    finally { await load(); operation.current = false; setBusy(false); }
  };
  const clone = async () => {
    if (operation.current || !destination) return;
    operation.current = true; setBusy(true); setImportError('');
    try {
      const inferred = remote.trim().split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? '';
      const source = sources.find(source => source.id === destination.sourceId);
      if (!source || source.directory !== destination.sourceDirectory) throw new Error('根目录设置已变化，请重新选择目标目录');
      const next = await scopedLibrary(api, source.id).libraryCloneProject(remote.trim(), name.trim() || inferred, destination.path, destination.root);
      if (source.id === sourceId) await load();
      setImportOpen(false); onImported(source.id, next.path);
      toast.success('项目已导入并记录变更');
    } catch (error) { setImportError(message(error)); await load(); }
    finally { operation.current = false; setBusy(false); }
  };
  const openProject = (entry: LibraryEntry) => { setSelectedPath(entry.path); setTab('overview'); };
  const projects = data?.entries.filter(entry => (!group || entry.path.startsWith(`${group}/`)) &&
    (!language || entry.languages.includes(language)) &&
    (!tag || entry.tags.includes(tag)) &&
    `${entry.displayName} ${entry.description} ${entry.tags.join(' ')} ${entry.languages.join(' ')} ${entry.git?.remote ?? ''}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const directoryLogs = selected ? data?.groups.filter(entry => !entry.path || selected.path.startsWith(`${entry.path}/`)) ?? [] : [];
  const projectPage = paginate(projects, { page, pageSize: 12 });
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page, group, language, tag, query, selectedPath]);
  return <div className="library-workspace projects-workspace" hidden={!active}>
    <WorkspaceToolbar title={selected?.displayName ?? '项目'}
      count={selectedPath === undefined ? projects.length : undefined}
      leading={selectedPath !== undefined && <Button size="icon" variant="ghost" title="返回项目" aria-label="返回项目" disabled={busy} onClick={() => setSelectedPath(undefined)}><ArrowLeft /></Button>}
      search={selectedPath === undefined && <ToolbarSearch label="搜索项目" value={query} onChange={setQuery} />}
      filters={selectedPath === undefined && sourceControl}
      actions={<>
        {selected ? <Button size="icon" variant="ghost" title="项目信息" aria-label="项目信息" disabled={busy} onClick={() => setEditing(true)}><Pencil /></Button> : <Button variant={groupChanges ? 'secondary' : 'ghost'} size="icon" title="目录变更记录" aria-label="目录变更记录" aria-pressed={groupChanges} onClick={() => setGroupChanges(!groupChanges)}><History /></Button>}
        <Button variant="ghost" size="icon" title="刷新" aria-label="刷新项目" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
        {selected ? <>
          <Button variant="outline" size="sm" onClick={() => void api.libraryOpenProject(selected.path, 'finder').catch(report)}><FolderOpen />目录</Button>
          <Button variant="outline" size="sm" onClick={() => void api.libraryOpenProject(selected.path, 'vscode').catch(report)}><Code />VS Code</Button>
          {selected.git?.webUrl && <Button variant="outline" size="sm" onClick={() => void api.openLink(selected.git!.webUrl!).catch(report)}><ExternalLink />仓库</Button>}
          {selected.git && <Button size="sm" disabled={busy || !!selected.git.warning} onClick={() => void pull()}><Download />{busy ? '更新中…' : '更新代码'}</Button>}
        </> : <>
          <Button size="sm" variant="outline" disabled={!root || busy} onClick={() => { setRemote(''); setName(''); setDestination(undefined); setImportError(''); setImportOpen(true); }}><Download />添加 Git 项目</Button>
        </>}
      </>} />
    {selectedPath === undefined && <div className="catalog-filters">
      <div className="project-group-filter"><Segments label="目录分组" value={group} onChange={setGroup} options={[{ value: '', label: '全部项目' }, ...(data?.groups.filter(entry => entry.path).map(entry => ({ value: entry.path, label: entry.displayName, title: entry.path })) ?? [])]} />
        {group && currentGroup && <Button size="icon" variant="ghost" title="编辑目录分组" aria-label="编辑目录分组" disabled={busy || loading} onClick={() => setEditingGroup(true)}><Pencil /></Button>}
      </div>
      <Segments label="筛选语言" value={language} onChange={setLanguage} options={[{ value: '', label: '全部语言' }, ...[...new Set(data?.entries.flatMap(entry => entry.languages) ?? [])].sort().map(item => ({ value: item, label: <LanguageLogo language={item} />, title: item }))]} />
      {!!data?.entries.some(entry => entry.tags.length) && <Segments label="筛选标签" value={tag} onChange={setTag} options={[{ value: '', label: '全部标签' }, ...[...new Set(data.entries.flatMap(entry => entry.tags))].sort().map(item => ({ value: item, label: `#${item}` }))]} />}
    </div>}
    {selectedPath === undefined && !groupChanges && <Pagination {...projectPage} onChange={setPage} busy={loading} />}
    <div ref={content} className={`projects-content${selected ? ' projects-content-detail' : ''}`}>
    {error && <p role="alert" className="library-warning">{error}</p>}
    {!!data?.warnings.length && <details className="library-warning"><summary>{data.warnings.length} 条读取提示</summary>{data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    {!root && !loading ? <div className="empty-state"><FolderOpen /><p>尚未设置项目目录</p></div> : selectedPath === undefined ? <>
      {groupChanges ? <section className="project-section"><h2>{currentGroup?.displayName ?? '项目根目录'} · 变更记录</h2><ChangeHistory key={group} api={api} path={group} /></section> : <div className="project-catalog">
        {projectPage.items.map(project => <article className="project-tile" key={project.path}>
          <button className="project-tile-body" onClick={() => openProject(project)}>
            <div className="project-tile-heading"><h2 title={project.displayName}>{project.displayName}</h2>{project.git && <span className="git-badge"><GitBranch size={12} />{providerName(project)}</span>}</div>
            <p title={project.description}>{project.description || '暂无项目描述'}</p>
            <div className="language-list">{project.languages.map(item => <LanguageLogo key={item} language={item} />)}</div>
            <div className="project-tile-status"><span className="project-tile-branch" title={project.git?.branch ?? undefined}>{project.git && <GitBranch size={12} />}<span>{project.git?.branch ?? (project.metadata?.launch ? '已登记启动配置' : '本地项目')}</span></span><span className="project-tile-worktree" title={gitState(project)}>{gitState(project)}</span></div>
          </button>
          <div className="project-tile-footer"><span title={project.path}>{project.path}</span><Button size="icon" variant="ghost" title="打开项目目录" aria-label={`打开 ${project.displayName} 目录`} onClick={() => void api.libraryOpenProject(project.path, 'finder').catch(report)}><FolderOpen /></Button>{project.git?.webUrl && <Button size="icon" variant="ghost" title="打开远程仓库" aria-label={`打开 ${project.displayName} 仓库`} onClick={() => void api.openLink(project.git!.webUrl!).catch(report)}><ExternalLink /></Button>}</div>
        </article>)}
      </div>}
      {!groupChanges && !projects.length && <p className="library-placeholder">{loading ? '正在读取项目…' : query || group || language ? '没有匹配的项目' : '暂无已登记的项目'}</p>}
    </> : selected ? <main className="project-full-page">
      <nav className="project-tabs" aria-label="项目详情" role="tablist">{(['overview', 'readme', 'changes', ...(selected.git ? ['git' as const] : [])] as const).map(value => <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{value === 'overview' ? '概览' : value === 'readme' ? '项目说明' : value === 'git' ? 'Git 提交' : '变更记录'}</button>)}</nav>
      <div role="tabpanel" className={tab === 'readme' ? 'project-tab-content project-tab-reader' : 'project-tab-content'}>
        {tab === 'overview' ? <>
          <p className="project-purpose">{selected.description || '暂无项目描述'}</p>
          <div className="language-list">{selected.languages.map(item => <LanguageLogo key={item} language={item} />)}{selected.tags.map(tag => <span className="language-chip" key={tag}>#{tag}</span>)}</div>
          <section className="project-section"><h2>Git</h2>{selected.git ? <dl className="project-facts">
            <div><dt>仓库</dt><dd>{selected.git.remote || '未配置远程仓库'}</dd></div>
            <div><dt>分支</dt><dd>{selected.git.branch || '未知'}</dd></div>
            <div><dt>工作区</dt><dd>{gitState(selected)}</dd></div>
            <div><dt>最近提交</dt><dd><code>{selected.git.commit?.slice(0, 8)}</code> {selected.git.commitMessage || '暂无提交'}{selected.git.commitDate && <time>{new Date(selected.git.commitDate).toLocaleString()}</time>}</dd></div>
          </dl> : <p className="project-muted">本地项目，未检测到 Git 仓库</p>}{selected.git?.warning && <p role="alert" className="library-warning">{selected.git.warning}</p>}</section>
          <section className="project-section"><h2>启动配置</h2>{selected.metadata?.launch ? <dl className="project-facts">
            <div><dt>命令</dt><dd><code>{selected.metadata.launch.command} {selected.metadata.launch.args.join(' ')}</code></dd></div>
            <div><dt>工作目录</dt><dd>{selected.metadata.launch.cwd || '.'}</dd></div>
            {selected.metadata.launch.previewUrl && <div><dt>预览地址</dt><dd>{selected.metadata.launch.previewUrl}</dd></div>}
          </dl> : <p className="project-muted">暂无启动配置</p>}</section>
          <section className="project-section"><h2>最近变更</h2><ChangeLog entries={selected.changelog.slice(0, 5)} /></section>
        </> : tab === 'readme' ? readmeError ? <p role="alert" className="library-warning">{readmeError}</p> : readme === undefined ? <p className="library-placeholder">正在读取项目说明…</p> : readme ? <MarkdownReader key={readme.path} title={readme.path.split('/').at(-1) || 'README'} content={readme.content} onLink={href => { if (/^https?:\/\//i.test(href)) void api.openLink(href).catch(report); else toast.error('请在项目目录中打开相对链接'); }} /> : <p className="library-placeholder">暂无 README</p> : <>
          {tab === 'git' ? <ChangeHistory key={`git:${selected.path}:${selected.git?.commit}`} api={api} path={selected.path} git /> : <section className="project-section"><h2>项目变更记录</h2><ChangeHistory key={selected.path} api={api} path={selected.path} /></section>}
          {tab === 'changes' && directoryLogs.map(entry => <DirectoryHistory key={entry.path} entry={entry} api={api} />)}
        </>}
      </div>
    </main> : <p className="library-placeholder">{loading ? '正在读取项目…' : '项目已移动或未登记，请返回项目刷新'}</p>}
    </div>
    <Dialog open={importOpen} onOpenChange={value => { if (!busy) setImportOpen(value); }}><DialogContent aria-describedby={undefined}><DialogTitle>添加 Git 项目</DialogTitle>
      <form onSubmit={event => { event.preventDefault(); void clone(); }}>
        <label className="field-label">Git 地址<Input required aria-label="Git 地址" value={remote} disabled={busy} onChange={event => setRemote(event.target.value)} placeholder="HTTPS 或 SSH 仓库地址" /></label>
        <DestinationField api={api} sources={sources} preferredSourceId={sourceId} value={destination} disabled={busy} onChange={setDestination} />
        <label className="field-label">项目目录名<Input aria-label="项目目录名" value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="默认使用仓库名" /></label>
        {importError && <p role="alert" className="library-warning">{importError}</p>}
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setImportOpen(false)}>取消</Button><Button type="submit" disabled={busy || !destination || !remote.trim()}><Download />{busy ? '导入中…' : '导入'}</Button></div>
      </form>
    </DialogContent></Dialog>
    <MetadataDialog key={editing ? selected?.path : 'closed'} entry={editing ? selected : undefined} onClose={() => setEditing(false)} onSave={async metadata => {
      if (!selected) return;
      await api.librarySaveMetadata({ kind: 'projects', path: selected.path, metadata: { ...metadata, kind: 'project' }, revision: selected.metadataRevision });
      setEditing(false); await load();
    }} />
    <MetadataDialog key={editingGroup ? `group:${currentGroup?.path}` : 'group-closed'} title="目录分组信息" entry={editingGroup ? currentGroup : undefined} onClose={() => setEditingGroup(false)} onSave={async metadata => {
      if (!currentGroup) return;
      await api.librarySaveMetadata({ kind: 'projects', path: currentGroup.path, metadata: { ...metadata, kind: 'collection' }, revision: currentGroup.metadataRevision });
      setEditingGroup(false); await load();
    }} />
  </div>;
}

function DirectoryHistory({ entry, api }: { entry: LibraryEntry; api: LibraryClient }) {
  const [open, setOpen] = useState(false);
  return <details className="project-directory-history" onToggle={event => setOpen(event.currentTarget.open)}><summary>{entry.path ? entry.displayName : '项目根目录'} · 目录变更记录</summary>{open && <ChangeHistory api={api} path={entry.path} />}</details>;
}

function ChangeLog({ entries }: { entries: ChangeLogEntry[] }) {
  return <div className="changelog-timeline">{entries.length ? entries.map((entry, index) => <div key={index}><time>{entry.date || '未标日期'}</time><span>{entry.message}</span></div>) : <p className="project-muted">暂无变更记录</p>}</div>;
}
