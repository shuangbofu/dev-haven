'use client';

import type { DesktopAPI } from '@/shared/types';
import { useEffect, useMemo, useState } from 'react';
import type { ProjectSearchTarget } from '@/shared/search';
import type { MemorySource } from '@/shared/memory';
import { scopedLibrary } from '@/lib/scoped-library';
import { LibraryWorkspace } from './library-workspace';
import { WorkspaceToolbar } from './workspace-toolbar';
import { SourceTabs } from './list-controls';

export function KnowledgeWorkspace({ api, active, sources, target, onTargetHandled }: { api: DesktopAPI; active: boolean; sources: MemorySource[]; target?: ProjectSearchTarget; onTargetHandled: (id: string) => void }) {
  const [id, setId] = useState('');
  const [createdTarget, setCreatedTarget] = useState<{ sourceId: string; path: string }>();
  useEffect(() => { if (target) { setId(target.sourceId); setCreatedTarget(undefined); } }, [target]);
  const available = sources.filter(source => source.kind === 'knowledge');
  const selected = available.find(source => source.id === (target?.sourceId ?? id)) ?? available[0];
  const scoped = useMemo(() => selected ? scopedLibrary(api, selected.id) : undefined, [api, selected?.id, selected?.directory]);
  if (!selected || !scoped) return <section hidden={!active}><WorkspaceToolbar title="知识库" /><p className="library-placeholder">尚未配置知识库目录</p></section>;
  return <LibraryWorkspace key={`${selected.id}:${selected.directory}`} api={scoped} kind="knowledge" active={active} sources={available} sourceId={selected.id} collectionTarget={createdTarget?.sourceId === selected.id ? createdTarget : undefined} documentTarget={target} onDocumentTargetHandled={onTargetHandled} onCollectionCreated={(sourceId, path) => { setId(sourceId); setCreatedTarget({ sourceId, path }); }} sourceControl={navigate => <SourceTabs sources={available} value={selected.id} onChange={value => navigate(() => { setCreatedTarget(undefined); setId(value); })} />} />;
}
