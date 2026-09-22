'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { PageSkeleton } from './page-skeleton';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, BookOpen, Box, Check, ChevronRight, Clipboard, Clock3, Download, FolderKanban, FolderOpen, Info, LayoutGrid, Loader2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings, Settings2, Terminal, XCircle } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BrandLogo, ToolLogo } from '@/components/brand';
import { ToolDialog, type Action } from '@/components/tool-dialog';
import { ShellIntegrationSettings } from '@/components/shell-integration-settings';
import { catalog, toolById, type ToolId } from '@/shared/catalog';
import type { DesktopAPI, ImportPlan, Snapshot, Task, TerminalSession } from '@/shared/types';
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
import type { MemorySnapshot } from '@/shared/memory';
import { MemorySettings } from './memory-settings';
import { TechnologyIcons } from './technology-icons';
import type { ProjectSearchTarget } from '@/shared/search';
import { useSidebar } from './use-sidebar';
import { ToolbarSearch, WorkspaceToolbar } from './workspace-toolbar';

import { defaultSearchShortcut, matchesShortcut, shortcutLabel } from '@/shared/shortcut';
import { ApplicationSettings } from './application-settings';
import { applyAppearance } from './theme';
import type { ApplicationState } from '@/shared/application';

type Page = 'overview' | 'terminal' | 'knowledge' | 'projects' | 'memory' | 'settings';
const TerminalWorkspace = dynamic(() => import('./terminal-workspace').then(module => module.TerminalWorkspace), { ssr: false, loading: () => <PageSkeleton /> });
const KnowledgeWorkspace = dynamic(() => import('./knowledge-workspace').then(module => module.KnowledgeWorkspace), { ssr: false, loading: () => <PageSkeleton /> });
const ProjectWorkspace = dynamic(() => import('./project-workspace').then(module => module.ProjectWorkspace), { ssr: false, loading: () => <PageSkeleton /> });
const MemoryWorkspace = dynamic(() => import('./memory-workspace').then(module => module.MemoryWorkspace), { ssr: false, loading: () => <PageSkeleton /> });
const GlobalSearchPanel = dynamic(() => import('./global-search').then(module => module.GlobalSearchPanel), { ssr: false });
const navigation = [
  { id: 'overview', label: '环境', icon: LayoutGrid },
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'memory', label: '记忆', icon: Brain },
] as const;
const shortcuts = [
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'settings', label: '设置', icon: Settings },
] as const;
const platformName = (value: string) => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[value] ?? value);
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const statusLabel = { queued: '等待中', running: '执行中', success: '已完成', failed: '失败' };
const taskName = (task: Task) => `${{ bootstrap: '准备管理引擎', install: '安装', uninstall: '卸载', default: '设置默认版本' }[task.kind]}${task.tool ? ` ${toolById(task.tool).name} ${task.version}` : ''}`;

export function Workspace() {
  const sidebar = useSidebar();
  const [application, setApplication] = useState<ApplicationState>();
  const announcedRelease = useRef('');
  useEffect(() => {
    if (application?.release.status !== 'available' || !application.release.version || announcedRelease.current === application.release.version) return;
    announcedRelease.current = application.release.version;
    toast.info(`DevHaven 有新版本 v${application.release.version}`, { action: { label: '查看更新', onClick: () => { setSettingsTab('about'); setPage('settings'); } } });
  }, [application?.release.status, application?.release.version]);
  useEffect(() => {
    if (!application) return;
    const update = () => applyAppearance(application.preferences); update();
    const media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [application?.preferences.theme, application?.preferences.accent]);
  const [api, setApi] = useState<DesktopAPI>();
  const [state, setState] = useState<Snapshot>();
  const [memory, setMemory] = useState<MemorySnapshot>();
  const [desktopRequired, setDesktopRequired] = useState(false);
  const [fatal, setFatal] = useState('');
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [knowledgeTarget, setKnowledgeTarget] = useState<ProjectSearchTarget>();
  const consumeKnowledgeTarget = useCallback((id: string) => setKnowledgeTarget(current => current?.id === id ? undefined : current), []);
  const searchShortcut = application?.preferences.searchShortcut ?? defaultSearchShortcut;
  const searchShortcutText = shortcutLabel(searchShortcut, state?.platform === 'darwin');
  const [page, setPage] = useState<Page>('overview');
  const previousPage = useRef<Page>('overview');
  useEffect(() => { if (page !== 'settings') previousPage.current = page; }, [page]);
  const [visited, setVisited] = useState<Set<Page>>(() => new Set());
  useEffect(() => { setVisited(previous => previous.has(page) ? previous : new Set([...previous, page])); }, [page]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!memory?.config.initialized) return;
    const keydown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, searchShortcut, state?.platform === 'darwin')) { event.preventDefault(); setSearchOpen(value => !value); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [memory?.config.initialized, searchShortcut, state?.platform]);
  const [projectTarget, setProjectTarget] = useState<ProjectSearchTarget>();
  const consumeProjectTarget = useCallback((id: string) => setProjectTarget(current => current?.id === id ? undefined : current), []);
  const [category, setCategory] = useState('全部');
  const [environmentTab, setEnvironmentTab] = useState('受管环境');
  const [selectedTool, setSelectedTool] = useState<ToolId>();
  const [selectedTask, setSelectedTask] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [importPlan, setImportPlan] = useState<ImportPlan>();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('我的环境');
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<string>();

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    let unsubscribeMemory = () => {};
    let unsubscribeApplication = () => {};
    const timer = setTimeout(() => { if (active) setFatal('连接超时，请重新加载或重启客户端。'); }, 10_000);
    try {
      const desktop = window.devhaven;
      if (!desktop && location.protocol === 'file:') throw new Error('桌面接口加载失败，请重新构建并启动客户端。');
      if (!desktop) { setDesktopRequired(true); clearTimeout(timer); return; }
      const client = desktop;
      setApi(client);
      unsubscribeApplication = client.onApplicationChange(value => { if (active) setApplication(value); });
      void client.application().then(value => { if (active) setApplication(value); }).catch(error => { if (active) setFatal(String(error)); });
      const accept = (snapshot: Snapshot) => { if (active) setState(snapshot); };
      unsubscribe = client.onChange(accept);
      unsubscribeMemory = client.onMemoryChange(snapshot => { if (active) setMemory(snapshot); });
      void Promise.all([client.snapshot(), client.memorySnapshot()]).then(([snapshot, memorySnapshot]) => { if (active) { accept(snapshot); setMemory(memorySnapshot); setFatal(''); } clearTimeout(timer); }).catch(error => { if (active) setFatal(String(error)); clearTimeout(timer); });
    } catch (error) { setFatal(error instanceof Error ? error.message : String(error)); clearTimeout(timer); }
    return () => { active = false; clearTimeout(timer); unsubscribe(); unsubscribeMemory(); unsubscribeApplication(); };
  }, []);

  const act: Action = useCallback(async (key, action, message) => {
    setBusy(key);
    try { const result = await action(); if (message) toast.success(message); return result; }
    catch (error) { toast.error(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error), { duration: 7000 }); }
    finally { setBusy(undefined); }
  }, []);
  const copy = (value: string) => act('copy', () => navigator.clipboard.writeText(value), '已复制');
  const importFile = () => act('import', async () => { const plan = await api!.previewImport(); if (plan) setImportPlan(plan); });
  const go = (target: Page) => { setPage(target); setQuery(''); };
  const showCatalog = () => { go('overview'); setEnvironmentTab('安装工具'); };
  const openTerminal = (id?: string, interactive?: boolean) => {
    if (!api || busy === 'terminal') return;
    void act('terminal', async () => {
      const installation = state?.installations.find(item => item.id === id);
      const session = await api.terminal(id, interactive ?? !!(installation && toolById(installation.tool).repl));
      setTerminals(items => [...items, session]); setActiveTerminal(session.id); setSelectedTool(undefined); go('terminal');
    });
  };
  const closeTerminal = useCallback((id: string) => {
    if (!api) return;
    void api.terminalClose(id).then(() => setTerminals(items => items.filter(item => item.id !== id)))
      .catch(error => toast.error(String(error)));
  }, [api]);
  useEffect(() => {
    setActiveTerminal(current => terminals.some(item => item.id === current) ? current : terminals[0]?.id);
  }, [terminals]);

  if (desktopRequired) return <div className="startup"><BrandLogo /><h1>DevHaven</h1><p>请打开桌面客户端。浏览器无法连接本机环境管理服务。</p></div>;
  if (fatal) return <div className="startup"><BrandLogo /><h1>无法加载环境</h1><p>{fatal}</p><Button onClick={() => location.reload()}><RefreshCw />重新加载</Button></div>;
  if (!api || !state || !memory) return <div className="startup"><BrandLogo /><h1>DevHaven</h1><p><Loader2 className="size-4 animate-spin" />正在连接环境…</p></div>;

  const activeTasks = state.tasks.filter(t => ['queued', 'running'].includes(t.status));
  const installedTools = new Set(state.installations.map(i => i.tool));
  const filteredInstalled = state.installations.filter(i => `${toolById(i.tool).name} ${i.version}`.toLowerCase().includes(query.toLowerCase()));
  const filteredSystem = state.systemTools.filter(i => `${toolById(i.tool).name} ${i.version}`.toLowerCase().includes(query.toLowerCase()));
  const filteredCatalog = catalog.filter(t => `${t.name} ${t.category}`.toLowerCase().includes(query.toLowerCase()) && (category === '全部' || t.category === category));
  const filteredTasks = state.tasks.filter(item => `${taskName(item)} ${statusLabel[item.status]}`.toLowerCase().includes(query.toLowerCase()));
  const task = state.tasks.find(t => t.id === selectedTask);
  const engineBusy = activeTasks.some(t => t.kind === 'bootstrap');

  return <TechnologyIcons.Provider value={memory.icons}><div className={cn('app-shell', page === 'settings' && 'settings-full-page', sidebar.collapsed && 'sidebar-collapsed', sidebar.dragging && 'sidebar-dragging')} style={sidebar.style}>
    <aside className="sidebar" id="workspace-sidebar">
      <div className="sidebar-heading"><button className="brand" aria-label="DevHaven 首页" onClick={() => go('overview')}><BrandLogo /><span>DevHaven</span></button><Button size="icon" variant="ghost" aria-label={sidebar.collapsed ? '展开侧栏' : '折叠侧栏'} title={sidebar.collapsed ? '展开侧栏' : '折叠侧栏'} aria-expanded={!sidebar.collapsed} aria-controls="workspace-sidebar" onClick={sidebar.toggle}>{sidebar.collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
      {memory.config.initialized && <button className="nav-item sidebar-search" aria-label="全局搜索" title={`全局搜索 (${searchShortcutText})`} onClick={() => setSearchOpen(true)}><Search size={17} /><span>搜索</span><kbd>{searchShortcutText}</kbd></button>}
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} title={item.label} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} className={cn('nav-item', page === item.id && 'active')} onClick={() => go(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.id === 'overview' && activeTasks.length > 0 && <Badge variant="secondary">{activeTasks.length}</Badge>}</button>)}</nav>
      <nav className="sidebar-shortcuts" aria-label="快捷入口">{shortcuts.map(item => <button key={item.id} title={item.label} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} className={cn('nav-item', page === item.id && 'active')} onClick={() => go(item.id)}><item.icon size={18} /></button>)}</nav>
      {!sidebar.collapsed && <div className="sidebar-resize" {...sidebar.separator} />}
    </aside>
    <div className="main-shell">
      <main className={cn('main-content', memory.config.initialized && (page === 'knowledge' || page === 'memory' || page === 'projects' || page === 'settings') && 'viewport-content')}>
        {!memory.config.initialized ? <MemorySettings api={api} snapshot={memory} onboarding /> : <>
        {(page === 'terminal' || visited.has('terminal') || terminals.length > 0) && <TerminalWorkspace api={api} visible={page === 'terminal'} sessions={terminals} active={activeTerminal} installations={state.installations} busy={busy === 'terminal'} onActive={setActiveTerminal} onOpen={openTerminal} onClose={closeTerminal} />}
        {(page === 'knowledge' || visited.has('knowledge')) && <KnowledgeWorkspace api={api} sources={memory.config.sources} active={page === 'knowledge'} target={knowledgeTarget} onTargetHandled={consumeKnowledgeTarget} />}
        {(page === 'projects' || visited.has('projects')) && <ProjectWorkspace api={api} sources={memory.config.sources} active={page === 'projects'} target={projectTarget} onTargetHandled={consumeProjectTarget} />}
        {(page === 'memory' || visited.has('memory')) && <MemoryWorkspace api={api} snapshot={memory} active={page === 'memory'} />}
        {page === 'overview' && <>
          <WorkspaceToolbar title="环境" context={<span className="workspace-toolbar-count">{installedTools.size} 个工具 · {state.installations.length} 个版本</span>}
            search={<ToolbarSearch value={query} onChange={setQuery} label={environmentTab === '安装记录' ? '搜索记录' : '搜索工具或版本'} />}
            filters={environmentTab === '安装工具' && <select aria-label="工具分类" value={category} onChange={event => setCategory(event.target.value)}>{['全部', '语言', '运行时', '包管理器', '构建工具', '框架'].map(value => <option key={value}>{value}</option>)}</select>}
            actions={<><Button size="icon" variant="ghost" title="导入清单" aria-label="导入清单" disabled={busy === 'import'} onClick={() => void importFile()}><ArrowDownToLine /></Button><Button size="icon" variant="ghost" title="导出清单" aria-label="导出清单" disabled={!state.installations.length} onClick={() => setExportOpen(true)}><ArrowUpFromLine /></Button><Button size="icon" variant="ghost" title="检测环境" aria-label="检测环境" disabled={busy === 'scan'} onClick={() => void act('scan', () => api.scan(), '检测完成')}><RefreshCw className={busy === 'scan' ? 'animate-spin' : ''} /></Button><Button onClick={() => showCatalog()}><Plus />安装工具</Button></>} />
          {!state.engineReady && <div className="inline-notice"><Download size={18} /><div><strong>管理引擎尚未安装</strong><p>安装 mise 后可管理工具版本。</p></div><Button size="sm" disabled={engineBusy} onClick={() => void act('bootstrap', () => api.bootstrap(), '已加入任务队列')}>{engineBusy ? <Loader2 className="animate-spin" /> : <Download />}{engineBusy ? '准备中' : '准备管理引擎'}</Button></div>}
          <div className="workspace-view-tabs"><div className="tabs" role="tablist" aria-label="环境来源">{['受管环境', '系统环境', '安装工具', '安装记录'].map(tab => <button role="tab" aria-selected={environmentTab === tab} className={cn(environmentTab === tab && 'active')} key={tab} onClick={() => { setEnvironmentTab(tab); setQuery(''); }}>{tab}<span>{tab === '受管环境' ? state.installations.length : tab === '系统环境' ? state.systemTools.length : tab === '安装工具' ? catalog.length : activeTasks.length ? `${activeTasks.length} 进行中` : state.tasks.length}</span></button>)}</div></div>
        {environmentTab === '安装工具' ? <>
          <div className="catalog-grid">{filteredCatalog.map(tool => {
            const versions = state.installations.filter(i => i.tool === tool.id);
            const current = versions.find(i => i.isDefault) ?? versions[0];
            const pending = activeTasks.some(t => t.tool === tool.id);
            return <article className="tool-card" key={tool.id}><div className="tool-card-heading"><ToolLogo id={tool.id} /><div><h2>{tool.name}</h2><span>{tool.category}</span></div>{versions.length > 0 && <Badge variant="secondary">已安装</Badge>}</div><div className="tool-card-meta">{pending ? <span><Loader2 size={13} className="animate-spin" />任务执行中</span> : current ? <><code>{current.version}</code><span>{versions.length} 个版本</span></> : <span>未安装</span>}</div><Button className="w-full" variant="outline" aria-label={`管理 ${tool.name}`} onClick={() => setSelectedTool(tool.id)}>{versions.length ? <Settings2 /> : <Plus />}{versions.length ? '管理版本' : '选择版本'}</Button></article>;
          })}</div>{!filteredCatalog.length && <EmptyState icon={Search} title="没有匹配的工具" />}
        </> : <>
          {environmentTab === '安装记录' ? <div className="data-table"><Table><TableHeader><TableRow><TableHead>操作</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead><TableHead className="text-right">日志</TableHead></TableRow></TableHeader><TableBody>{filteredTasks.map(item => <TableRow key={item.id}><TableCell><div className="task-name"><TaskIcon status={item.status} /><span>{taskName(item)}</span></div>{item.error && <p className="task-error" title={item.error}>{item.error}</p>}</TableCell><TableCell><Badge variant={item.status === 'failed' ? 'destructive' : 'outline'}>{statusLabel[item.status]}</Badge></TableCell><TableCell className="muted-cell">{dateTime(item.createdAt)}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" aria-label={`查看日志 ${taskName(item)}`} onClick={() => setSelectedTask(item.id)}>查看<ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table>{!filteredTasks.length && <EmptyState icon={Terminal} title={query ? "没有匹配的记录" : "暂无安装记录"} />}</div> : <>
          <div className="data-table"><Table><TableHeader><TableRow><TableHead>工具</TableHead><TableHead>版本</TableHead><TableHead>安装路径</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
            {environmentTab === '受管环境' ? filteredInstalled.map(item => <TableRow key={item.id}><TableCell><div className="tool-name"><ToolLogo id={item.tool} bare /><span>{toolById(item.tool).name}</span></div></TableCell><TableCell><div className="version-cell"><code>{item.version}</code>{item.isDefault && <Badge variant="secondary">默认</Badge>}</div></TableCell><TableCell><PathValue value={item.path} onCopy={() => void copy(item.path)} /></TableCell><TableCell><div className="row-actions"><IconButton label={`打开 ${toolById(item.tool).name} ${item.version} 终端`} onClick={() => openTerminal(item.id)}><Terminal /></IconButton><IconButton label={`打开 ${toolById(item.tool).name} 安装目录`} onClick={() => void act('reveal', () => api.reveal(item.path))}><FolderOpen /></IconButton><IconButton label={`管理 ${toolById(item.tool).name}`} onClick={() => setSelectedTool(item.tool)}><MoreHorizontal /></IconButton></div></TableCell></TableRow>) : filteredSystem.map(item => <TableRow key={item.tool}><TableCell><div className="tool-name"><ToolLogo id={item.tool} bare /><span>{toolById(item.tool).name}</span></div></TableCell><TableCell><code>{item.version}</code></TableCell><TableCell><PathValue value={item.path} onCopy={() => void copy(item.path)} /></TableCell><TableCell><div className="row-actions"><IconButton label={`打开 ${toolById(item.tool).name} 路径`} onClick={() => void act('reveal', () => api.reveal(item.path))}><FolderOpen /></IconButton><Button size="sm" variant="ghost" onClick={() => setSelectedTool(item.tool)}>安装受管版本</Button></div></TableCell></TableRow>)}
          </TableBody></Table>{!(environmentTab === '受管环境' ? filteredInstalled.length : filteredSystem.length) && <EmptyState icon={Box} title={query ? '没有匹配的环境' : environmentTab === '受管环境' ? '暂无受管环境' : '未检测到系统环境'}>{!query && <Button variant="outline" size="sm" onClick={() => environmentTab === '受管环境' ? showCatalog() : void act('scan', () => api.scan())}>{environmentTab === '受管环境' ? <Plus /> : <RefreshCw />}{environmentTab === '受管环境' ? '安装工具' : '重新检测'}</Button>}</EmptyState>}</div>
          <p className="table-note">{environmentTab === '受管环境' ? '默认版本用于内置终端，可在设置中开启全局终端环境。' : '系统环境来自当前 PATH，仅检测，不接管。'}{state.scanTime && environmentTab === '系统环境' && ` 最近检测：${dateTime(state.scanTime)}`}</p>
          </>}
          </>}
        </>}

        {page === 'settings' && <>
          <WorkspaceToolbar title="设置" leading={<Button variant="ghost" size="sm" onClick={() => go(previousPage.current)}><ArrowLeft />返回</Button>} />
          <nav className="settings-tabs" aria-label="设置分类">{[['appearance','外观'],['search','搜索'],['sources','目录与记忆'],['agent','Agent'],['environment','环境'],['about','关于与更新']].map(([id,label]) => <button key={id} aria-current={settingsTab === id ? 'page' : undefined} onClick={() => setSettingsTab(id)}>{label}</button>)}</nav>
          <div className="settings-content">
          {application && <ApplicationSettings api={api} state={application} section={settingsTab} mac={state.platform === 'darwin'} />}
          <div hidden={!['sources','agent'].includes(settingsTab)}><MemorySettings api={api} snapshot={memory} section={settingsTab} /></div>
          <div hidden={settingsTab !== 'environment'}><section className="settings-section"><h2>环境管理</h2><SettingRow label="管理引擎" value={`mise ${state.engineVersion}`}><Badge variant="outline">{state.engineReady ? '已就绪' : '未安装'}</Badge>{!state.engineReady && <Button size="sm" variant="outline" disabled={engineBusy} onClick={() => void act('bootstrap', () => api.bootstrap(), '已加入任务队列')}><Download />安装</Button>}</SettingRow><SettingRow label="本机环境检测" value={state.scanTime ? dateTime(state.scanTime) : '尚未检测'}><Button variant="outline" size="sm" disabled={busy === 'scan'} onClick={() => void act('scan', () => api.scan(), '检测完成')}><RefreshCw className={busy === 'scan' ? 'animate-spin' : ''} />重新检测</Button></SettingRow></section>
          <ShellIntegrationSettings api={api} engineReady={state.engineReady} /></div>
          <section hidden={settingsTab !== 'about'} className="settings-section"><h2>本机</h2><SettingRow label="设备" value={state.hostname} /><SettingRow label="操作系统" value={`${platformName(state.platform)} / ${state.arch}`} /><SettingRow label="存储目录" value={state.root}><IconButton label="复制存储路径" onClick={() => void copy(state.root)}><Clipboard /></IconButton><IconButton label="打开存储目录" onClick={() => void act('reveal', () => api.reveal(state.root))}><FolderOpen /></IconButton></SettingRow></section>
          
          </div>
        </>}
        </>}
      </main>
    </div>

    {memory.config.initialized && searchOpen && <GlobalSearchPanel api={api} sources={memory.config.sources} open={searchOpen} onOpenChange={setSearchOpen} shortcut={searchShortcutText} onDocument={hit => { setKnowledgeTarget({ id: crypto.randomUUID(), sourceId: hit.sourceId, path: hit.path }); go('knowledge'); }} onProject={hit => { setProjectTarget({ id: crypto.randomUUID(), sourceId: hit.sourceId, path: hit.projectPath ?? hit.path }); go('projects'); }} />}
    <ToolDialog toolId={selectedTool} onSelect={setSelectedTool} onClose={() => setSelectedTool(undefined)} state={state} api={api} act={act} busy={busy} onTerminal={openTerminal} />
    <Dialog open={exportOpen} onOpenChange={setExportOpen}><DialogContent><DialogTitle>导出环境清单</DialogTitle><DialogDescription>{state.installations.length} 个版本。不包含本机路径和凭证。</DialogDescription><label className="field-label" htmlFor="manifest-name">名称</label><Input id="manifest-name" maxLength={80} value={exportName} onChange={e => setExportName(e.target.value)} /><div className="dialog-actions"><Button variant="outline" onClick={() => setExportOpen(false)}>取消</Button><Button disabled={!exportName.trim() || busy === 'export'} onClick={() => void act('export', async () => { if (await api.exportManifest(exportName.trim())) { toast.success('环境清单已导出'); setExportOpen(false); } })}><ArrowUpFromLine />导出</Button></div></DialogContent></Dialog>
    <Dialog open={!!importPlan} onOpenChange={open => { if (!open) setImportPlan(undefined); }}><DialogContent className="max-w-2xl"><DialogTitle>导入环境清单</DialogTitle><DialogDescription>{importPlan?.manifest.name} · {platformName(importPlan?.manifest.source.platform ?? '')} / {importPlan?.manifest.source.arch}</DialogDescription>{importPlan?.warnings.map(warning => <p className="dialog-notice" key={warning}><Info size={15} />{warning}</p>)}<div className="import-list">{importPlan?.items.map(item => <div key={`${item.tool}@${item.version}`}><ToolLogo id={item.tool} bare /><strong>{toolById(item.tool).name}</strong><code>{item.version}</code><Badge variant="outline">{item.action === 'installed' ? '已安装' : '待安装'}</Badge>{item.setDefault && <Badge variant="secondary">默认</Badge>}</div>)}</div>{!state.engineReady && <p className="dialog-notice">请先在环境页准备管理引擎。</p>}<div className="dialog-actions"><Button variant="outline" onClick={() => setImportPlan(undefined)}>取消</Button><Button disabled={!state.engineReady || !importPlan?.items.length || busy === 'apply-import'} onClick={() => void act('apply-import', async () => { await api.applyImport(importPlan!.manifest); setImportPlan(undefined); go('overview'); setEnvironmentTab('安装记录'); }, '已加入任务队列')}><Download />开始安装</Button></div></DialogContent></Dialog>
    <Dialog open={!!selectedTask} onOpenChange={open => { if (!open) setSelectedTask(undefined); }}><DialogContent className="max-w-3xl"><DialogTitle>任务日志</DialogTitle><DialogDescription>{task ? taskName(task) : '任务不存在'}</DialogDescription>{task && <><div className="log-heading"><Badge variant={task.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel[task.status]}</Badge><span>{dateTime(task.createdAt)}</span></div><pre className="log-output">{task.logs.join('\n') || '等待任务开始…'}</pre>{task.status === 'failed' && <div className="dialog-actions"><Button disabled={!!busy} onClick={() => void act('retry', async () => { if (task.kind === 'install') await api.install(task.tool!, task.version!); else if (task.kind === 'bootstrap') await api.bootstrap(); else { const item = state.installations.find(i => i.tool === task.tool && i.version === task.version); if (!item) throw new Error('该版本已不存在'); if (task.kind === 'default') await api.setDefault(item.id); else await api.uninstall(item.id); } setSelectedTask(undefined); }, '已重新加入队列')}><RefreshCw />重试</Button></div>}</>}</DialogContent></Dialog>
    <Toaster theme={application?.preferences.theme ?? 'system'} position="bottom-right" closeButton />
  </div></TechnologyIcons.Provider>;
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) { return <Button variant="ghost" size="icon" title={label} aria-label={label} onClick={onClick}>{children}</Button>; }
function PathValue({ value, onCopy }: { value: string; onCopy: () => void }) { return <div className="path-value"><code title={value}>{value}</code><IconButton label="复制路径" onClick={onCopy}><Clipboard /></IconButton></div>; }
function EmptyState({ icon: Icon, title, children }: { icon: typeof Box; title: string; children?: React.ReactNode }) { return <div className="empty-state"><Icon size={25} /><p>{title}</p>{children}</div>; }
function SettingRow({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) { return <div className="setting-row"><span>{label}</span><code>{value}</code><div>{children}</div></div>; }
function TaskIcon({ status }: { status: Task['status'] }) { if (status === 'running') return <Loader2 size={16} className="animate-spin" />; if (status === 'failed') return <XCircle size={16} className="text-destructive" />; if (status === 'success') return <Check size={16} />; return <Clock3 size={16} className="text-muted-foreground" />; }
