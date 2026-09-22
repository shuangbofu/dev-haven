'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, FilePlus, FileText, Folder, FolderPlus } from 'lucide-react';
import type { LibraryClient } from '@/shared/types';
import type { DirectoryListing, LibraryEntry } from '@/shared/library';
import { DocumentIcon } from './document-icon';
import { Button } from './ui/button';
import { collectionAncestors, inCollection } from '@/lib/knowledge-scope';

export function KnowledgeNavigation({ api, rootPath, folder, documentPath, listing, query, onFolder, onDocument, busy, onCreate, onListing }: {
  api: LibraryClient; rootPath: string; folder: string; documentPath?: string;
  listing?: DirectoryListing; query: string; onFolder: (path: string) => void; onDocument: (path: string) => void;
  onListing: (listing: DirectoryListing) => void; busy: boolean; onCreate: (type: 'directory' | 'document') => void;
}) {
  const [directories, setDirectories] = useState<Record<string, DirectoryListing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const onListingRef = useRef(onListing); onListingRef.current = onListing;
  const cache = useRef<Record<string, DirectoryListing>>({});
  const pending = useRef(new Map<string, Promise<void>>());
  const ensure = useCallback((path: string) => {
    if (!inCollection(rootPath, path)) return Promise.resolve();
    if (cache.current[path]) return Promise.resolve();
    const existing = pending.current.get(path);
    if (existing) return existing;
    const request = api.libraryBrowse('knowledge', path).then(result => {
      cache.current[path] = result; onListingRef.current(result);
      setDirectories(previous => ({ ...previous, [path]: result }));
      setErrors(previous => ({ ...previous, [path]: '' }));
    }).catch(() => setErrors(previous => ({ ...previous, [path]: '读取失败，点击重试' }))).finally(() => pending.current.delete(path));
    pending.current.set(path, request);
    return request;
  }, [api, rootPath]);
  useEffect(() => {
    if (!listing || !inCollection(rootPath, listing.path)) return;
    cache.current[listing.path] = listing;
    setDirectories(previous => (previous[listing.path] === listing ? previous : { ...previous, [listing.path]: listing }));
  }, [listing, rootPath]);
  useEffect(() => {
    const ancestors = collectionAncestors(rootPath, folder);
    setExpanded(previous => new Set([...previous, ...ancestors]));
    for (const path of new Set([rootPath, ...ancestors])) void ensure(path);
  }, [folder, rootPath, ensure]);
  const matches = (entry: LibraryEntry) => `${entry.displayName} ${entry.documentTitle ?? ''} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
  const render = (entries: LibraryEntry[], depth = 0): React.ReactNode => <ul className="knowledge-tree-level">
    {entries.filter(entry => !query || entry.directory || matches(entry)).map(entry => <li key={entry.path}>
      <div className={`knowledge-tree-row ${entry.directory ? folder === entry.path && !documentPath ? 'selected' : '' : documentPath === entry.path ? 'selected' : ''}`} style={{ paddingLeft: Math.min(depth, 6) * 12 + 4 }}>
        {entry.directory ? <>
          <button className="knowledge-tree-toggle" aria-label={`${expanded.has(entry.path) ? '收起' : '展开'} ${entry.displayName}`} aria-expanded={expanded.has(entry.path)} onClick={() => {
            setExpanded(previous => { const next = new Set(previous); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; });
            void ensure(entry.path);
          }}><ChevronRight size={13} /></button>
          <button className="knowledge-tree-label" title={entry.description || entry.displayName} aria-current={folder === entry.path ? 'location' : undefined} onClick={() => onFolder(entry.path)}><Folder size={14} /><span>{entry.displayName}</span></button>
        </> : <button className="knowledge-tree-label knowledge-tree-document" aria-current={documentPath === entry.path ? 'page' : undefined} title={entry.documentTitle || entry.displayName} onClick={() => onDocument(entry.path)}><DocumentIcon path={entry.path} size={14} /><span>{entry.documentTitle || entry.displayName.replace(/\.[^.]+$/, '')}</span></button>}
      </div>
      {entry.directory && expanded.has(entry.path) && (errors[entry.path] ? <button className="knowledge-tree-status" onClick={() => void ensure(entry.path)}>{errors[entry.path]}</button> : directories[entry.path] ? directories[entry.path].entries.length ? render(directories[entry.path].entries, depth + 1) : <p className="knowledge-tree-status">暂无内容</p> : <p className="knowledge-tree-status">读取中…</p>)}
    </li>)}
  </ul>;
  const ancestors = collectionAncestors(rootPath, folder);
  return <aside className="knowledge-navigation" aria-label="知识集合导航">
    <div className="knowledge-navigation-header"><span>知识目录</span><Button size="icon" variant="ghost" title={`新建目录到 ${folder || '知识库根目录'}`} aria-label="新建目录" disabled={busy} onClick={() => onCreate('directory')}><FolderPlus /></Button><Button size="icon" variant="ghost" title={`新建文档到 ${folder || '知识库根目录'}`} aria-label="新建文档" disabled={busy} onClick={() => onCreate('document')}><FilePlus /></Button></div>
    <nav className="knowledge-path" aria-label="当前集合路径">{ancestors.map((path, index) => {
      return <span key={path}>{index > 0 && <ChevronRight size={11} />}<button aria-current={path === folder ? 'location' : undefined} onClick={() => onFolder(path)}>{directories[path]?.current.displayName || path.split('/').at(-1)}</button></span>;
    })}</nav>
    <div className="knowledge-tree">{render((directories[rootPath]?.entries ?? []).filter(entry => inCollection(rootPath, entry.path) && (rootPath !== '' || !entry.directory)))}</div>
  </aside>;
}
