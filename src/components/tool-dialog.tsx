'use client';

import { useEffect, useState } from 'react';
import { Check, Clipboard, Code2, Download, FolderOpen, Info, Loader2, RefreshCw, Search, Terminal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ToolLogo } from '@/components/brand';
import { companions, toolById, type ToolId } from '@/shared/catalog';
import type { DesktopAPI, Snapshot } from '@/shared/types';

export type Action = (key: string, action: () => Promise<unknown>, message?: string) => Promise<unknown>;
type Props = { toolId?: ToolId; onSelect: (tool: ToolId) => void; onClose: () => void; state: Snapshot; api: DesktopAPI; act: Action; busy?: string; onTerminal: (id: string, interactive?: boolean) => void };
export function ToolDialog({ toolId, onSelect, onClose, state, api, act, busy, onTerminal }: Props) {
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let ignore = false; setVersions([]); setVersion(''); setError(''); setFilter('');
    if (!toolId || !state.engineReady) { setLoading(false); return; }
    setLoading(true);
    void api.versions(toolId).then(items => { if (!ignore) { setVersions(items); setVersion(items[0] ?? ''); } })
      .catch(err => { if (!ignore) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [toolId, api, state.engineReady, refresh]);
  const tool = toolId ? toolById(toolId) : undefined;
  const companion = toolId ? companions[toolId] : undefined;
  const installed = state.installations.filter(i => i.tool === toolId);
  const current = installed.find(i => i.isDefault) ?? installed[0];
  const alreadyInstalled = installed.some(i => i.version === version);
  const pending = state.tasks.some(t => t.tool === toolId && t.version === version && ['running', 'queued'].includes(t.status));
  const dependency = tool && 'requires' in tool && !state.installations.some(i => i.tool === tool.requires && i.isDefault) ? toolById(tool.requires) : undefined;
  const options = versions.filter(v => v.toLowerCase().includes(filter.toLowerCase()));
  return <Dialog open={!!toolId} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-w-2xl">{tool && <>
    <div className="tool-dialog-heading"><ToolLogo id={tool.id} /><div><DialogTitle>{tool.name}</DialogTitle><DialogDescription>{tool.category}</DialogDescription></div></div>
    <div className="detail-section-title">已安装版本 <span>{installed.length}</span></div>
    {!installed.length ? <p className="no-versions">尚未安装</p> : <div className="installed-versions">{installed.map(item => <div key={item.id}>
      <div className="installed-version-top"><code>{item.version}</code>{item.isDefault && <Badge variant="secondary">默认</Badge>}<div className="version-actions">
        {!item.isDefault && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void act('default', () => api.setDefault(item.id), '已提交版本切换')}>设为默认</Button>}
        <Button variant="ghost" size="icon" disabled={busy === 'terminal'} title="打开终端" aria-label={`打开 ${item.version} 终端`} onClick={() => onTerminal(item.id)}>{busy === 'terminal' ? <Loader2 className="animate-spin" /> : <Terminal />}</Button>
        <Button variant="ghost" size="icon" title="卸载版本" aria-label={`卸载 ${item.version}`} disabled={!!busy} onClick={() => void act('uninstall', () => api.uninstall(item.id))}><Trash2 /></Button>
      </div></div>
      <div className="installed-path"><code title={item.path}>{item.path}</code><Button variant="ghost" size="icon" title="复制安装路径" aria-label="复制安装路径" onClick={() => void act('copy', () => navigator.clipboard.writeText(item.path), '已复制')}><Clipboard /></Button><Button variant="ghost" size="icon" title="打开安装目录" aria-label="打开安装目录" onClick={() => void act('reveal', () => api.reveal(item.path))}><FolderOpen /></Button></div>
      {item.binPaths.length > 0 && <div className="bin-path"><span>PATH</span><code>{item.binPaths.join(' · ')}</code></div>}
    </div>)}</div>}
    {current && tool.repl && <Button variant="outline" size="sm" className="mt-3" disabled={busy === 'terminal'} onClick={() => onTerminal(current.id, true)}>{busy === 'terminal' ? <Loader2 className="animate-spin" /> : <Code2 />}打开 {tool.name} 交互终端</Button>}
    {companion && <section className="companion-section"><div className="detail-section-title">配套工具</div>
      {companion.bundled.map(item => <div className="companion-row" key={item.name}><div><strong>{item.name}</strong><span>{item.purpose} · 随语言提供</span></div><code>{item.command}</code><Button size="icon" variant="ghost" title={`复制 ${item.name} 检查命令`} aria-label={`复制 ${item.name} 检查命令`} onClick={() => void act('copy', () => navigator.clipboard.writeText(item.command), '已复制')}><Clipboard /></Button></div>)}
      {companion.optional.map(id => <div className="companion-row" key={id}><ToolLogo id={id} bare /><div><strong>{toolById(id).name}</strong><span>{toolById(id).category} · 按需安装</span></div><Button size="sm" variant="outline" onClick={() => onSelect(id)}>{state.installations.some(item => item.tool === id) ? '管理' : '选择版本'}</Button></div>)}
      {companion.note && <p className="companion-note">{companion.note}</p>}
    </section>}
    <div className="detail-section-title">安装版本</div>
    {!state.engineReady ? <div className="inline-notice"><Info size={17} /><span>需要先准备管理引擎。</span><Button size="sm" disabled={state.tasks.some(t => t.kind === 'bootstrap' && ['queued', 'running'].includes(t.status))} onClick={() => void act('bootstrap', () => api.bootstrap(), '已加入任务队列')}><Download />准备引擎</Button></div>
      : loading ? <div className="versions-loading"><Loader2 size={17} className="animate-spin" />获取版本列表…</div>
      : error ? <div className="versions-error"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}><RefreshCw />重试</Button></div>
      : <><label className="search-field version-search"><Search size={15} /><Input placeholder="筛选版本…" aria-label="筛选版本" value={filter} onChange={e => { const value = e.target.value; setFilter(value); setVersion(versions.find(v => v.toLowerCase().includes(value.toLowerCase())) ?? ''); }} /></label><div className="version-select-row"><select className="select-input" aria-label="选择安装版本" value={version} onChange={e => setVersion(e.target.value)}>{options.map(value => <option key={value} value={value}>{value}{installed.some(i => i.version === value) ? ' · 已安装' : ''}</option>) }{!options.length && <option value="">无匹配版本</option>}</select><Button disabled={!version || alreadyInstalled || pending || !!dependency || !!busy} onClick={() => void act('install', () => api.install(tool.id, version), '已加入任务队列')}>{pending ? <Loader2 className="animate-spin" /> : alreadyInstalled ? <Check /> : <Download />}{pending ? '安装中' : alreadyInstalled ? '已安装' : '安装版本'}</Button></div>
      {dependency && <p className="dependency-note"><Info size={14} /><span>需要默认 {dependency.name} 环境。</span><Button size="sm" variant="outline" onClick={() => onSelect(dependency.id)}>安装 {dependency.name}</Button></p>}</>}
  </>}</DialogContent></Dialog>;
}
