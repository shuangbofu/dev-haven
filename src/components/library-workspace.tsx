'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Code2, BookOpen, ChevronRight, FileText, FolderOpen, FolderPlus, History, Pencil, RefreshCw, Save } from 'lucide-react';
import { SourceReader } from './source-reader';
import { HTMLReader } from './html-reader';
import { DestinationField } from './destination-field';
import { DocumentIcon } from './document-icon';
import { MarkdownReader } from './markdown-reader';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import type { ProjectSearchTarget } from '@/shared/search';
import type { MemorySource } from '@/shared/memory';
import { scopedLibrary } from '@/lib/scoped-library';
import type { LibraryClient } from '@/shared/types';
import type { DirectoryListing, SelectedDestination, LibraryDocument, LibraryEntry, LibraryKind, LibraryMetadata, LibraryOverview, LibrarySettings } from '@/shared/library';
import { LanguageLogo, useTechnologyIcons } from './technology-icons';
export { LanguageLogo } from './technology-icons';
import { KnowledgeNavigation } from './knowledge-navigation';
import { ToolbarSearch, WorkspaceToolbar } from './workspace-toolbar';
import { Pagination } from './list-controls';
import { ChangeHistory } from './change-history';
import { paginate } from '@/shared/pagination';
import { collectionForDocument, inCollection } from '@/lib/knowledge-scope';

const report = (error: unknown) => toast.error(String(error).replace(/^Error: Error invoking remote method '[^']+': Error: /, ''), { duration: 7000 });
const labels = { knowledge: '知识库', projects: '项目' };
const dateTime = (value: string) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });


export function LibraryWorkspace({ api, kind, active, sourceControl, sources, sourceId, collectionTarget, onCollectionCreated, documentTarget, onDocumentTargetHandled }: { documentTarget?: ProjectSearchTarget; onDocumentTargetHandled: (id: string) => void; sources: MemorySource[]; sourceId: string; collectionTarget?: { sourceId: string; path: string }; onCollectionCreated: (sourceId: string, path: string) => void; api: LibraryClient; kind: 'knowledge'; active: boolean; sourceControl?: (navigate: (action: () => void) => void) => React.ReactNode }) {
  const [settings, setSettings] = useState<LibrarySettings>({});
  const [loadedListing, setListing] = useState<DirectoryListing>();
  
  const [overview, setOverview] = useState<LibraryOverview>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [collectionPath, setCollectionPath] = useState<string | null>(null);
  const currentListing = loadedListing?.path === folder && collectionPath !== null && inCollection(collectionPath, loadedListing.path) ? loadedListing : undefined;
  const listing = useMemo(() => currentListing && collectionPath === '' ? { ...currentListing, entries: currentListing.entries.filter(entry => !entry.directory) } : currentListing, [currentListing, collectionPath]);
  
  const [document, setDocument] = useState<LibraryDocument>();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  
  const [metadataTarget, setMetadataTarget] = useState<LibraryEntry>();
  const [createType, setCreateType] = useState<'collection' | 'directory' | 'document'>();
  const [newName, setNewName] = useState('');
  const [createDestination, setCreateDestination] = useState<SelectedDestination>();
  const [createParent, setCreateParent] = useState({ path: '', root: '', name: '' });
  const [treeRevision, setTreeRevision] = useState(0);
  const [discard, setDiscard] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pending = useRef<() => void>(() => {});
  const directoryCache = useRef(new Map<string, DirectoryListing>());
  const request = useRef(0);
  const docRequest = useRef(0);
  const dirty = !!document && draft !== document.content;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const navigate = (action: () => void) => {
    if (busy) return;
    if (dirty) { pending.current = action; setDiscard(true); } else action();
  };
  const load = useCallback(async () => {
    const token = ++request.current;
    if (collectionPath !== null && directoryCache.current.has(folder)) { setListing(directoryCache.current.get(folder)); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const config = await api.librarySettings();
      if (token !== request.current) return;
      setSettings(previous => {
        if (previous[kind] && previous[kind] !== config[kind]) {
          setFolder(''); setCollectionPath(null); setDocument(undefined); setDraft(''); setEditing(false);
          setListing(undefined);
        }
        return config;
      });
      if (!config[kind]) return;
      if (collectionPath === null) {
        const result = await api.libraryOverview();
        if (token === request.current) { setOverview(result); setWarnings(result.warnings); setListing(undefined); }
      } else {
        const result = directoryCache.current.get(folder) ?? await api.libraryBrowse(kind, folder);
        directoryCache.current.set(folder, result);
        if (token === request.current) { setListing(result); setWarnings(result.warnings); }
      }
    } catch (error) { if (token === request.current) setError(String(error)); }
    finally { if (token === request.current) setLoading(false); }
  }, [api, kind, folder, collectionPath]);
  useEffect(() => { if (active) void load(); return () => { request.current++; }; }, [active, load]);
  useEffect(() => {
    if (!active || dirtyRef.current) return;
    docRequest.current++;
    setFolder(''); setCollectionPath(null); setDocument(undefined); setDraft(''); setEditing(false); setQuery('');
  }, [active, kind]);
  useEffect(() => {
    if (!collectionTarget) return;
    setCollectionPath(collectionTarget.path); setFolder(collectionTarget.path);
  }, [collectionTarget]);
  useEffect(() => {
    if (!active || !documentTarget) return;
    let cancelled = false;
    const open = async () => {
      try {
        const overview = await api.libraryOverview();
        if (cancelled) return;
        const root = collectionForDocument(overview.collections.map(item => item.path), documentTarget.path);
        await openDocument(documentTarget.path, root);
        if (!cancelled) onDocumentTargetHandled(documentTarget.id);
      } catch (error) { if (!cancelled) { report(error); onDocumentTargetHandled(documentTarget.id); } }
    };
    navigate(() => { void open(); });
    return () => { cancelled = true; };
  }, [active, documentTarget, api, onDocumentTargetHandled]);
  useEffect(() => {
    const refresh = () => { if (active && !dirtyRef.current) { directoryCache.current.delete(folder); void load(); } };
    window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh);
  }, [active, load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const openDocument = async (relative: string, nextCollection?: string) => {
    if ((nextCollection ?? collectionPath) !== null && !inCollection((nextCollection ?? collectionPath)!, relative)) { report(new Error('文档不在当前知识库内')); return; }
    request.current++;
    const token = ++docRequest.current;
    try {
      const parent = relative.split('/').slice(0, -1).join('/');
      const [next, nextListing] = await Promise.all([api.libraryRead(kind, relative), directoryCache.current.get(parent) ?? api.libraryBrowse(kind, parent)]);
      if (token === docRequest.current) { directoryCache.current.set(parent, nextListing); setListing(nextListing); }
      if (token === docRequest.current) { request.current++; setLoading(false); if (nextCollection !== undefined) setCollectionPath(nextCollection); setFolder(relative.split('/').slice(0, -1).join('/')); setDocument(next); setDraft(next.content); setEditing(false); }
    } catch (error) { if (token === docRequest.current) { setLoading(false); report(error); } }
  };
  const changeFolder = (relative: string) => navigate(() => {
    if (collectionPath !== null && !inCollection(collectionPath, relative)) return;
    request.current++;
    const token = ++docRequest.current;
    void (async () => {
      try {
        const next = directoryCache.current.get(relative) ?? await api.libraryBrowse(kind, relative);
        if (token !== docRequest.current) return;
        request.current++; setLoading(false); directoryCache.current.set(relative, next); setListing(next);
        if (collectionPath === null) setCollectionPath(relative);
        setFolder(relative); setQuery(''); setDocument(undefined); setDraft(''); setEditing(false);
      } catch (error) { if (token === docRequest.current) { setLoading(false); report(error); } }
    })();
  });
  const goHome = () => navigate(() => { request.current++; docRequest.current++; setCollectionPath(null); setFolder(''); setDocument(undefined); setDraft(''); setEditing(false); setQuery(''); });
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (error) { report(error); } finally { setBusy(false); } };
  const knowledgeHome = collectionPath === null;
  const relativeLink = (href: string) => {
    if (/^https?:\/\//i.test(href)) { void api.openLink(href).catch(report); return; }
    if (href.startsWith('#')) return;
    if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('/')) { toast.error('链接需要是库内相对路径或 HTTP(S) 地址'); return; }
    try {
      const parts = (document?.path.split('/').slice(0, -1) ?? []);
      for (const part of decodeURIComponent(href.split(/[?#]/)[0]).split('/')) {
        if (part === '..') { if (!parts.length) throw new Error('链接超出目录'); parts.pop(); }
        else if (part && part !== '.') parts.push(part);
      }
      if (collectionPath === null || !inCollection(collectionPath, parts.join('/'))) throw new Error('链接超出当前知识库，请返回首页打开对应知识库');
      navigate(() => { void openDocument(parts.join('/')); });
    } catch (error) { report(error); }
  };
  const startCreate = (type: 'collection' | 'directory' | 'document') => navigate(() => {
    setCreateParent({ path: folder, root: settings[kind]!, name: folder ? listing?.current.displayName || folder : sources.find(source => source.id === sourceId)?.name || '知识库根目录' });
    setCreateDestination(undefined); setNewName(''); setCreateType(type);
  });
  const documentActions = document && <>
    <Button size="icon" variant="ghost" title="用 VS Code 打开文档" aria-label="用 VS Code 打开文档" onClick={() => void api.libraryOpenDocument(document.path).catch(report)}><Code2 /></Button>
    <Button size="icon" variant="ghost" title="打开文档位置" aria-label="打开文档位置" onClick={() => void api.libraryReveal(kind, document.path).catch(report)}><FolderOpen /></Button>
    {document.format !== 'unsupported' && <div className="document-modes" role="group" aria-label="文档模式">
      <Button size="sm" variant="ghost" aria-pressed={!editing} onClick={() => setEditing(false)}><BookOpen />阅读</Button>
      <Button size="sm" variant="ghost" aria-pressed={editing} onClick={() => setEditing(true)}><Pencil />编辑</Button>
    </div>}
    {dirty && <Button size="sm" variant="ghost" className="document-save" disabled={busy} onClick={() => void run(async () => { const next = await api.librarySaveDocument(kind, document.path, draft, document.revision); setDocument(next); setDraft(next.content); toast.success('已保存并记录变更'); directoryCache.current.delete(folder); await load(); })}><Save />保存</Button>}
  </>;
  return <div className="library-workspace knowledge-workspace" hidden={!active}>
    <WorkspaceToolbar title={labels[kind]}
      leading={!knowledgeHome && <Button size="icon" variant="ghost" title="返回知识库首页" aria-label="返回知识库首页" onClick={goHome}><ArrowLeft /></Button>}
      search={<ToolbarSearch label={knowledgeHome ? '搜索知识库' : '搜索当前目录'} value={query} onChange={setQuery} />}
      filters={knowledgeHome ? sourceControl?.(navigate) : undefined}
      actions={<>
        {knowledgeHome && <Button size="sm" disabled={busy || loading || !settings[kind]} onClick={() => startCreate('collection')}><FolderPlus />新建知识库</Button>}
        {!knowledgeHome && listing?.current && <>
          <Button size="icon" variant="ghost" title="集合变更记录" aria-label="集合变更记录" onClick={() => setHistoryOpen(true)}><History /></Button>
          <Button size="icon" variant="ghost" title="集合信息" aria-label="集合信息" onClick={() => setMetadataTarget(listing.current)}><Pencil /></Button>
          <Button size="icon" variant="ghost" title="打开集合目录" aria-label="打开集合目录" onClick={() => void api.libraryReveal(kind, folder).catch(report)}><FolderOpen /></Button>
        </>}
        <Button size="icon" variant="ghost" aria-label="刷新知识库" title="刷新" disabled={loading || busy} onClick={() => { directoryCache.current.clear(); setTreeRevision(value => value + 1); void load(); }}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
      </>} />
    {!settings[kind] ? <div className="empty-state"><BookOpen /><p>尚未设置{labels[kind]}目录</p></div> : <>
      {error && <div role="alert" className="library-warning">{error}<Button variant="outline" onClick={goHome}>返回知识库首页</Button></div>}
      {warnings.length > 0 && <details className="library-warning"><summary>{warnings.length} 条读取提示</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      {knowledgeHome ? <KnowledgeOverview key={query} overview={overview} query={query} onOpenCollection={changeFolder} onOpenDocument={relative => navigate(() => { void openDocument(relative, collectionForDocument(overview?.collections.map(item => item.path) ?? [], relative)); })} /> : <>
        <div className="collection-summary">{listing?.current && <>
          <h2 title={`更新于 ${dateTime(listing.current.modified)}`}>{listing.current.displayName}</h2>
          {listing.current.description && <p title={listing.current.description}>{listing.current.description}</p>}
          <span className="collection-summary-counts">{listing.entries.filter(item => item.directory).length} 个子集合 · {listing.entries.filter(item => !item.directory).length} 篇内容</span>
          {!!listing.current.tags.length && <span className="collection-summary-tags" title={listing.current.tags.join(' · ')}>{listing.current.tags.map(tag => `#${tag}`).join(' ')}</span>}
        </>}</div>

        <div className="library-panes knowledge-panes">
          <KnowledgeNavigation key={`${settings.knowledge}:${collectionPath}:${treeRevision}`} api={api} rootPath={collectionPath!} folder={folder} documentPath={document?.path} listing={listing} query={query} busy={busy || loading} onListing={next => { directoryCache.current.set(next.path, next); }} onCreate={startCreate} onFolder={changeFolder} onDocument={relative => navigate(() => {
            void openDocument(relative);
          })} />
          <div className="document-panel">{document ? <>{(editing || !['markdown', 'html'].includes(document.format)) && <div className="document-toolbar"><strong title={document.path}>{document.path.split('/').at(-1)}{dirty && ' · 未保存'}</strong>{documentActions}</div>}
            {document.format === 'unsupported' ? <div className="empty-state"><FileText /><p>此文件暂不支持内置预览，可在文件管理器中打开。</p></div> : editing ? <textarea className="document-editor" aria-label="文档内容" spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} /> : document.format === 'markdown' ? <MarkdownReader key={document.path} title={`${document.path.split('/').at(-1)}${dirty ? ' · 未保存' : ''}`} content={draft} onLink={relativeLink} actions={documentActions} /> : document.format === 'html' ? <HTMLReader key={document.path} title={document.path.split('/').at(-1)!} content={draft} actions={documentActions} /> : <SourceReader content={draft} language={document.language} />}
          </> : <div className="collection-contents">
            <h3>{listing?.current.displayName || '集合内容'}</h3>
            {(listing?.entries ?? []).filter(entry => `${entry.displayName} ${entry.documentTitle ?? ''} ${entry.description}`.toLowerCase().includes(query.toLowerCase())).map(entry => <button className="collection-content-row" key={entry.path} onClick={() => entry.directory ? changeFolder(entry.path) : navigate(() => void openDocument(entry.path))}>
              {entry.directory ? <BookOpen size={16} /> : <DocumentIcon path={entry.path} size={16} />}<span><strong>{entry.documentTitle || entry.displayName}</strong><small>{entry.description || entry.documentSummary || (entry.directory ? entry.tags.map(tag => `#${tag}`).join(' ') : entry.name)}</small></span><ChevronRight size={14} />
            </button>)}
            {!listing?.entries.length && <p className="library-placeholder">{loading ? '正在读取内容…' : '暂无内容'}</p>}
          </div>}</div>
        </div>
      </>}
    </>}
    <MetadataDialog key={metadataTarget?.path ?? 'closed'} entry={metadataTarget} onClose={() => setMetadataTarget(undefined)} onSave={async metadata => { await api.librarySaveMetadata({ kind, path: metadataTarget!.path, metadata, revision: metadataTarget!.metadataRevision }); setMetadataTarget(undefined); directoryCache.current.clear(); setTreeRevision(value => value + 1); await load(); toast.success('目录信息已保存'); }} />
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="collection-history-dialog" aria-describedby={undefined}><DialogTitle>{listing?.current.displayName} · 变更记录</DialogTitle>{historyOpen && <ChangeHistory key={folder} api={api} path={folder} />}</DialogContent></Dialog>

    <Dialog open={!!createType} onOpenChange={open => { if (!open && !busy) setCreateType(undefined); }}><DialogContent><DialogTitle>新建{createType === 'collection' ? '知识库' : createType === 'directory' ? '目录' : '文档'}</DialogTitle><DialogDescription>{createType === 'collection' ? '先选择根目录，再进入目标文件夹。' : `创建到「${createParent.name}」`}{createType === 'document' ? '，文件名以 .md、.html 或 .txt 结尾。' : '，自动登记元数据。'}</DialogDescription>
      <form onSubmit={event => { event.preventDefault(); if (busy || !newName.trim() || createType === 'collection' && !createDestination) return; void run(async () => {
        if (createType === 'collection') {
          const destination = sources.find(source => source.id === createDestination?.sourceId && source.kind === 'knowledge');
          if (!destination || destination.directory !== createDestination?.sourceDirectory) throw new Error('根目录设置已变化，请重新选择根目录');
          const created = await scopedLibrary(api, destination.id).libraryCreate(kind, createDestination!.path, newName.trim(), true, createDestination!.root);
          directoryCache.current.clear(); setCreateType(undefined); docRequest.current++; setDocument(undefined); setDraft(''); setEditing(false); setQuery('');
          onCollectionCreated(destination.id, created);
          toast.success('已创建并记录变更'); return;
        }
        const created = await api.libraryCreate(kind, createParent.path, newName.trim(), createType !== 'document', createParent.root);
        if (createType === 'directory' && collectionPath === '') setCollectionPath(created);
        directoryCache.current.clear(); setCreateType(undefined); docRequest.current++; setDocument(undefined); setDraft(''); setEditing(false); setQuery('');
        setFolder(createType !== 'document' ? created : createParent.path);
        const updatedOverview = await api.libraryOverview(); setOverview(updatedOverview); setTreeRevision(value => value + 1);
        if (createType === 'document') await load();
        if (createType === 'document') await openDocument(created);
        toast.success('已创建并记录变更');
      }); }}>
        {createType === 'collection' && <DestinationField api={api} sources={sources} preferredSourceId={sourceId} value={createDestination} disabled={busy} onChange={setCreateDestination} />}
        <label className="field-label">名称<Input autoFocus aria-label="新建名称" maxLength={120} disabled={busy} value={newName} onChange={e => setNewName(e.target.value)} /></label>
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setCreateType(undefined)}>取消</Button><Button type="submit" disabled={busy || !newName.trim() || createType === 'collection' && !createDestination}>创建</Button></div>
      </form>
    </DialogContent></Dialog>
    <Dialog open={discard} onOpenChange={setDiscard}><DialogContent><DialogTitle>文档有未保存的修改</DialogTitle><DialogDescription>继续切换会放弃当前修改。</DialogDescription><div className="dialog-actions"><Button variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={() => { setDiscard(false); pending.current(); }}>放弃并切换</Button></div></DialogContent></Dialog>
  </div>;
}

export function MetadataDialog({ entry, title, onClose, onSave }: { entry?: LibraryEntry; title?: string; onClose: () => void; onSave: (metadata: LibraryMetadata) => Promise<void> }) {
  const iconCatalog = useTechnologyIcons();
  const [name, setName] = useState(entry?.displayName ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [languages, setLanguages] = useState(entry?.languages ?? []);
  const [tags, setTags] = useState(entry?.tags.join(', ') ?? '');
  const kind = entry?.metadata?.kind ?? 'collection';
  const [launch, setLaunch] = useState(entry?.metadata?.launch ? JSON.stringify(entry.metadata.launch, null, 2) : '');
  const [busy, setBusy] = useState(false);
  const list = (value: string) => value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  return <Dialog open={!!entry} onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="metadata-dialog"><DialogTitle>{title ?? (kind === 'project' ? '项目信息' : '集合信息')}</DialogTitle><DialogDescription>元数据保存在集中记忆中。</DialogDescription>
    {entry?.warning && <p className="library-warning">{entry.warning}</p>}
    <label className="field-label">名称<Input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label>
    <label className="field-label">描述<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} /></label>
    {kind === 'project' && <fieldset className="language-picker"><legend>语言</legend>{[...new Set([...iconCatalog.map(icon => icon.name), ...languages])].map(language => <label key={language}><input type="checkbox" checked={languages.includes(language)} disabled={busy || languages.length >= 20 && !languages.includes(language)} onChange={event => setLanguages(current => event.target.checked ? [...current, language] : current.filter(item => item !== language))} /><LanguageLogo language={language} /></label>)}</fieldset>}
    <label className="field-label">标签（逗号分隔）<Input value={tags} onChange={e => setTags(e.target.value)} /></label>
    {kind === 'project' && <details><summary>启动配置（可选）</summary><textarea aria-label="启动配置 JSON" value={launch} onChange={e => setLaunch(e.target.value)} placeholder={'{"command":"npm","args":["run","dev"]}'} /></details>}
    <div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || !name.trim() || !!entry?.warning} onClick={() => { setBusy(true); void Promise.resolve().then(() => onSave({ ...entry?.metadata, schemaVersion: 1, kind, name, description, languages, tags: list(tags), launch: kind === 'project' && launch.trim() ? JSON.parse(launch) : undefined })).catch(report).finally(() => setBusy(false)); }}>保存</Button></div>
  </DialogContent></Dialog>;
}

function KnowledgeOverview({ overview, query, onOpenCollection, onOpenDocument }: { overview?: LibraryOverview; query: string; onOpenCollection: (path: string) => void; onOpenDocument: (path: string) => void }) {
  const [page, setPage] = useState(1);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page]);
  const matches = (entry: LibraryEntry) => `${entry.displayName} ${entry.description} ${entry.documentTitle ?? ''} ${entry.documentSummary ?? ''} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
  const collections = overview?.collections.filter(matches) ?? [];
  const collectionPage = paginate(collections, { page, pageSize: 18 });
  const recent = overview?.recent.filter(matches) ?? [];
  if (!overview) return <div className="empty-state"><BookOpen /><p>正在整理知识元数据…</p></div>;
  return <div ref={content} className="knowledge-overview-content">
    <div className="knowledge-summary"><div><strong>{overview.collections.length}</strong><span>个知识集合</span></div><div><strong>{overview.documents.length}</strong><span>篇可阅读文档</span></div><div><strong>{overview.tags.length}</strong><span>个主题标签</span></div></div>
    <div className="knowledge-overview-controls"><h2>知识集合</h2><Pagination {...collectionPage} onChange={setPage} /></div>
    <section className="metadata-section"><div className="collection-grid">{collectionPage.items.map(collection => <button className="collection-card" key={collection.path} onClick={() => onOpenCollection(collection.path)}><div className="collection-card-icon"><BookOpen size={20} /></div><div className="collection-card-body"><h3>{collection.displayName}</h3><p>{collection.description || '尚未补充集合描述。'}</p><div className="collection-card-meta"><span>{collection.tags.length ? collection.tags.map(tag => `#${tag}`).join(' ') : '未分类'}</span><ChevronRight size={14} /></div></div></button>)}</div>{!collections.length && <p className="library-placeholder">没有匹配的知识集合</p>}</section>
    <section className="metadata-section"><div className="metadata-section-heading"><h2>最近更新</h2><span>按文档更新时间排序</span></div><div className="recent-documents">{recent.map(document => <button key={document.path} onClick={() => onOpenDocument(document.path)}><DocumentIcon path={document.path} size={17} /><div><strong>{document.documentTitle || document.displayName.replace(/\.[^.]+$/, '')}</strong><p>{document.documentSummary || '打开文档阅读内容'}</p></div><small>{dateTime(document.modified)}</small></button>)}</div>{!recent.length && <p className="library-placeholder">没有匹配的文档</p>}</section>
  </div>;
}
