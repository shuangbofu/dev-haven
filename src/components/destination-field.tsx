'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react';
import type { DestinationListing, SelectedDestination } from '@/shared/library';
import type { MemorySource } from '@/shared/memory';
import type { DesktopAPI } from '@/shared/types';
import { scopedLibrary } from '@/lib/scoped-library';
import { Button } from './ui/button';

/** First choose a configured source, then browse only folders inside that source. */
export function DestinationField({ api, sources, preferredSourceId, value, disabled, onChange }: {
  api: DesktopAPI; sources: MemorySource[]; preferredSourceId: string; value?: SelectedDestination;
  disabled?: boolean; onChange: (value: SelectedDestination | undefined) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [listing, setListing] = useState<DestinationListing>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const selected = sources.find(source => source.id === sourceId);
  const signature = JSON.stringify(sources.map(source => [source.id, source.directory, source.excludes]));
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { sequence.current++; setSourceId(''); setListing(undefined); setLoading(false); setError(''); onChangeRef.current(undefined); }, [signature]);
  useEffect(() => () => { sequence.current++; }, []);
  const browse = async (source: MemorySource, path: string) => {
    const token = ++sequence.current; setSourceId(source.id); setLoading(true); setError('');
    try {
      const result = await scopedLibrary(api, source.id).libraryDestinationFolders(source.kind, path);
      if (token === sequence.current) setListing(result);
    } catch (error) { if (token === sequence.current) setError(String(error)); }
    finally { if (token === sequence.current) setLoading(false); }
  };
  const backToRoots = () => { sequence.current++; setSourceId(''); setListing(undefined); setError(''); setLoading(false); onChange(undefined); };
  if (value) return <div className="field-label">目标目录<div className="destination-field"><div><span>{sources.find(source => source.id === value.sourceId)?.name}</span><code>{value.absolutePath}</code></div><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={backToRoots}>更改</Button></div></div>;
  return <div className="destination-picker" aria-label="选择目标目录">
    <div className="destination-picker-heading"><strong>{selected ? '2. 选择具体文件夹' : '1. 选择根目录'}</strong>{loading && <Loader2 size={14} className="animate-spin" />}</div>
    {!selected ? <div className="destination-picker-list">{[...sources].sort((a, b) => Number(b.id === preferredSourceId) - Number(a.id === preferredSourceId)).map(source => <button type="button" key={source.id} disabled={disabled} onClick={() => { setListing(undefined); void browse(source, ''); }}><FolderOpen size={17} /><span><strong>{source.name}</strong><small>{source.directory}</small></span><ChevronRight size={14} /></button>)}</div> : <>
      <div className="destination-picker-path"><Button type="button" size="icon" variant="ghost" disabled={disabled || loading} aria-label={listing?.current.path ? '上一级目录' : '返回根目录选择'} onClick={() => listing?.current.path ? void browse(selected, listing.current.path.split('/').slice(0, -1).join('/')) : backToRoots()}><ArrowLeft /></Button><span>{selected.name}{listing?.current.path && ` / ${listing.current.path}`}</span><Button type="button" size="sm" variant="ghost" disabled={disabled || loading} onClick={backToRoots}>更换根目录</Button></div>
      <div className="destination-picker-list" aria-busy={loading}>{listing?.folders.map(folder => <button type="button" key={folder.path} disabled={disabled || loading} onClick={() => void browse(selected, folder.path)}><Folder size={16} /><span>{folder.name}</span><ChevronRight size={14} /></button>)}{listing && !listing.folders.length && <p>没有可进入的子文件夹</p>}</div>
      {error && <p role="alert" className="library-warning">{error}<Button type="button" size="sm" variant="ghost" disabled={disabled || loading} onClick={() => void browse(selected, listing?.current.path ?? '')}>重试</Button></p>}
      <div className="destination-picker-confirm"><code>{listing?.current.absolutePath ?? selected.directory}</code><Button type="button" size="sm" variant="outline" disabled={disabled || loading || !listing || !!error} onClick={() => onChange({ ...listing!.current, sourceId: selected.id, sourceDirectory: selected.directory })}>选择此文件夹</Button></div>
    </>}
  </div>;
}
