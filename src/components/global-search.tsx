'use client';
import { SourceReader } from './source-reader';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Code2, FileText, FolderKanban, FolderOpen, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { DesktopAPI } from '@/shared/types';
import type { LibraryDocument } from '@/shared/library';
import type { SearchHit, SearchResults } from '@/shared/search';
import type { MemorySource } from '@/shared/memory';
import { scopedLibrary } from '@/lib/scoped-library';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { HTMLReader } from './html-reader';
import { DocumentIcon } from './document-icon';
import { MarkdownReader } from './markdown-reader';
import { LanguageLogo } from './technology-icons';
import { Pagination } from './list-controls';

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return text;
  const pattern = new RegExp(`(${tokens.join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

export function GlobalSearchPanel({ api, sources, open, onOpenChange, onProject, onDocument, shortcut }: {
  api: DesktopAPI; sources: MemorySource[]; open: boolean; onOpenChange: (open: boolean) => void;
  onDocument: (hit: SearchHit) => void; onProject: (hit: SearchHit) => void; shortcut: string;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'document' | 'project'>('all');
  const [page, setPage] = useState(1);
  const [indexTick, setIndexTick] = useState(0);
  const [indexPending, setIndexPending] = useState(false);
  useEffect(() => { if (!open || !indexPending) return; const timer = setTimeout(() => setIndexTick(value => value + 1), 1200); return () => clearTimeout(timer); }, [open, indexPending, indexTick]);
  const [result, setResult] = useState<SearchResults>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<{ hit: SearchHit; document?: LibraryDocument; error?: string }>();
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const sequence = useRef(0), listId = useId();
  const sourceSignature = JSON.stringify(sources);
  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    setError(''); setSelected(0);
    if (!query.trim()) { setResult(undefined); setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      void api.search({ query, kind, page }).then(value => { if (!cancelled) { setResult(value); setIndexPending(!!value.indexing); } }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => { if (!cancelled) setBusy(false); });
    }, 80);
    return () => { cancelled = true; clearTimeout(timer); void api.cancelSearch().catch(() => {}); };
  }, [api, open, query, kind, page, sourceSignature, preview, indexTick]);
  useEffect(() => { if (!open) { sequence.current++; setPreview(undefined); } }, [open]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const enterDetails = (hit: SearchHit) => {
    const source = sources.find(source => source.id === hit.sourceId);
    if (hit.kind === 'project' || source?.kind === 'projects') onProject(hit);
    else onDocument(hit);
    onOpenChange(false);
  };
  const choose = async (hit: SearchHit) => {
    if (hit.kind === 'project') { enterDetails(hit); return; }
    const token = ++sequence.current;
    setPreview({ hit });
    try {
      const source = sources.find(source => source.id === hit.sourceId);
      if (!source) throw new Error('来源目录已移除，请重新搜索');
      const document = await scopedLibrary(api, source.id).libraryRead(source.kind, hit.path);
      if (token === sequence.current) setPreview({ hit, document });
    } catch (error) { if (token === sequence.current) setPreview({ hit, error: String(error) }); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className={`global-search-panel${preview ? ' global-search-preview' : ''}`} aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
    <DialogTitle className="sr-only">全局搜索</DialogTitle>
    {preview ? <>
      <div className="global-search-preview-toolbar"><Button size="icon" variant="ghost" title="返回搜索" aria-label="返回搜索" onClick={() => { sequence.current++; setPreview(undefined); requestAnimationFrame(() => input.current?.focus()); }}><ArrowLeft /></Button><span title={preview.hit.path}>{preview.hit.sourceName} / {preview.hit.path}</span><Button size="icon" variant="ghost" title="打开文档位置" aria-label="打开文档位置" onClick={() => { const source = sources.find(source => source.id === preview.hit.sourceId); if (source) void scopedLibrary(api, source.id).libraryReveal(source.kind, preview.hit.path).catch(error => toast.error(String(error))); }}><FolderOpen /></Button><Button size="sm" variant="ghost" onClick={() => enterDetails(preview.hit)}><ArrowUpRight />{sources.find(source => source.id === preview.hit.sourceId)?.kind === 'projects' ? '进入项目' : '进入知识库'}</Button><Button size="icon" variant="ghost" title="用 VS Code 打开文档" aria-label="用 VS Code 打开文档" onClick={() => void scopedLibrary(api, preview.hit.sourceId).libraryOpenDocument(preview.hit.path).catch(error => toast.error(String(error)))}><Code2 /></Button></div>
      {preview.error ? <p className="library-placeholder" role="alert">{preview.error}</p> : !preview.document ? <div className="global-search-empty"><Loader2 className="animate-spin" />正在读取文档</div> : preview.document.format === 'markdown' ? <MarkdownReader title={preview.hit.title} content={preview.document.content} onLink={href => {
        if (/^https?:\/\//i.test(href)) { void api.openLink(href).catch(error => toast.error(String(error))); return; }
        if (href.startsWith('#')) return;
        try {
          if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('/')) throw new Error('请选择来源目录内的文档链接');
          const parts = preview.hit.path.split('/').slice(0, -1);
          for (const part of decodeURIComponent(href.split(/[?#]/)[0]).split('/')) {
            if (part === '..') { if (!parts.length) throw new Error('链接超出来源目录'); parts.pop(); }
            else if (part && part !== '.') parts.push(part);
          }
          void choose({ ...preview.hit, path: parts.join('/'), title: parts.at(-1) ?? '' });
        } catch (error) { toast.error(String(error)); }
      }} /> : preview.document.format === 'html' ? <HTMLReader title={preview.hit.title} content={preview.document.content} /> : ['code', 'text'].includes(preview.document.format) ? <SourceReader content={preview.document.content} language={preview.document.language} /> : <p className="library-placeholder">此格式请在文档位置打开</p>}
    </> : <>
      <div className="global-search-input">{busy ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}<input ref={input} value={query} maxLength={300} role="combobox" aria-label="全局搜索文档与项目" aria-expanded={!!result?.items.length} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={result?.items[selected] ? `${listId}-${selected}` : undefined} placeholder="搜索文档正文、项目、描述、标签…" onChange={event => { setQuery(event.target.value); setPage(1); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || !result?.items.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + result.items.length) % result.items.length); }
        if (event.key === 'Enter') { event.preventDefault(); if (event.metaKey || event.ctrlKey) enterDetails(result.items[selected]); else void choose(result.items[selected]); }
      }} /></div>
      <div className="global-search-controls"><nav aria-label="搜索类型">{([['all', '全部'], ['document', '文档'], ['project', '项目']] as const).map(([value, label]) => <button key={value} aria-current={kind === value ? 'page' : undefined} onClick={() => { setKind(value); setPage(1); }}>{label}</button>)}</nav><Pagination {...(result ?? { page: 1, pageSize: 30, total: 0 })} busy={busy} onChange={setPage} /></div>
      <div className="global-search-results" ref={list} aria-busy={busy}>
        {error ? <p className="global-search-empty" role="alert">{error}</p> : busy && !result ? <div className="global-search-empty" role="status"><Loader2 className="animate-spin" />搜索中…</div> : !query.trim() ? <div className="global-search-empty"><Search /><p>搜索所有已配置的项目和知识目录</p><small>支持正文、README、描述、标签和路径；多个关键词用空格分隔</small></div> : !result?.items.length ? <p className="global-search-empty">没有匹配的文档或项目</p> : null}
        <div id={listId} role="listbox" aria-label="搜索结果">{result?.items.map((hit, index) => <div role="option" id={`${listId}-${index}`} key={hit.id} aria-selected={selected === index} className="global-search-hit" onMouseMove={() => setSelected(index)} onClick={() => void choose(hit)}>
          {hit.kind === 'project' ? <FolderKanban size={20} /> : <DocumentIcon path={hit.path} size={20} />}<div className="global-search-hit-body"><div className="global-search-hit-title"><strong><Highlight text={hit.title} query={query} /></strong><span>{hit.kind === 'project' ? '项目' : '文档'} · {hit.matchedIn}</span></div>{hit.snippet && <p><Highlight text={hit.snippet} query={query} /></p>}<small><Highlight text={`${hit.sourceName} / ${hit.path}`} query={query} /></small>{!!hit.languages.length && <div className="language-list">{hit.languages.slice(0, 5).map(language => <LanguageLogo key={language} language={language} />)}</div>}</div><Button size="icon" variant="ghost" title="进入详情" aria-label={`进入 ${hit.title} 详情`} onClick={event => { event.stopPropagation(); enterDetails(hit); }}><ArrowUpRight /></Button>
        </div>)}</div>
        {(result?.partial || !!result?.warnings.length) && <p className="global-search-note">{result.partial ? '索引达到扫描上限，当前结果可能不完整；可在设置中调整来源范围并重建。' : result?.warnings.join('；')}</p>}
      </div>
      <footer className="global-search-footer" title={result?.indexedAt ? `索引更新于 ${new Date(result.indexedAt).toLocaleString('zh-CN')}` : ''}><span><kbd>↑ ↓</kbd> 选择 <kbd>↵</kbd> 打开</span><span><kbd>{shortcut}</kbd> 搜索 <kbd>Esc</kbd> 关闭</span></footer>
    </>}
  </DialogContent></Dialog>;
}
