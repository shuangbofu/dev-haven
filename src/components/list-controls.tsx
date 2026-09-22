'use client';

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import type { MemorySource } from '@/shared/memory';

export function Segments({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: ReactNode; title?: string }[]; onChange: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const measure = () => {
      if (!container.current || !list.current || !container.current.clientWidth) return;
      const buttons = Array.from(list.current.children) as HTMLButtonElement[];
      const total = buttons.reduce((width, button) => width + button.getBoundingClientRect().width, 0) + Math.max(0, buttons.length - 1) * 3;
      setOverflow(total > container.current.clientWidth + 1);
      const firstTop = buttons[0]?.offsetTop;
      const next = new Set(buttons.filter(button => button.offsetTop > firstTop).map(button => button.dataset.value!));
      setHidden(previous => previous.size === next.size && [...next].every(value => previous.has(value)) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [options, overflow]);
  return <div ref={container} className="filter-collapse">
    <div ref={list} id={id} className={`filter-segments${expanded ? ' is-expanded' : ''}${overflow ? ' has-overflow' : ''}`} role="group" aria-label={label}>
      {options.map(option => <button type="button" key={option.value} data-value={option.value} title={option.title} aria-pressed={value === option.value} aria-hidden={!expanded && hidden.has(option.value) || undefined} tabIndex={!expanded && hidden.has(option.value) ? -1 : 0} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
    {overflow && <button type="button" className="filter-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(current => !current)}>{expanded ? '收起' : '展开全部'}<ChevronDown size={13} /></button>}
  </div>;
}

export function SourceTabs({ sources, value, onChange }: { sources: MemorySource[]; value: string; onChange: (value: string) => void }) {
  if (sources.length < 2) return null;
  return <Segments label="来源目录" value={value} onChange={onChange} options={sources.map(source => ({ value: source.id, label: <><FolderOpen size={14} />{source.name}</>, title: source.directory }))} />;
}

export function Pagination({ page, pageSize, total, onChange, busy = false }: { page: number; pageSize: number; total: number; onChange: (page: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="list-pagination" aria-label="分页"><span className="pagination-status" role="status">{busy && <><Loader2 size={13} className="animate-spin" aria-hidden="true" /><span className="sr-only">正在读取</span></>}</span><span>{total} 条 · {page} / {pages} 页</span><Button size="icon" variant="ghost" title="上一页" aria-label="上一页" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /></Button><Button size="icon" variant="ghost" title="下一页" aria-label="下一页" disabled={busy || page >= pages} onClick={() => onChange(page + 1)}><ChevronRight /></Button></nav>;
}
