'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, FolderOpen, Layers } from 'lucide-react';
import type { MemoryEntity, MemorySource } from '@/shared/memory';
import { paginate } from '@/shared/pagination';
import { LanguageLogo } from './library-workspace';
import { Pagination, Segments } from './list-controls';
import { registrationNames } from '@/shared/library';

const categories = [
  { value: 'project', label: '项目', icon: Layers },
  { value: 'knowledge', label: '知识集合', icon: BookOpen },
  { value: 'group', label: '项目分组', icon: FolderOpen },
];
export function MemoryEntities({ entities, sources }: { entities: MemoryEntity[]; sources: MemorySource[] }) {
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page, category]);
  const kind = (entity: MemoryEntity) => entity.metadata.kind === 'project' ? 'project' : sources.find(source => source.id === entity.sourceId)?.kind === 'knowledge' ? 'knowledge' : 'group';
  const filtered = entities.filter(entity => category === 'all' || kind(entity) === category).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.path.localeCompare(b.path));
  const data = paginate(filtered, { page, pageSize: 20 });
  return <div className="memory-entities">
    <div className="memory-controls"><Segments label="元数据分类" value={category} onChange={value => { setCategory(value); setPage(1); }} options={[{ value: 'all', label: `全部 ${entities.length}` }, ...categories.map(({ value, label, icon: Icon }) => ({ value, label: <><Icon size={14} />{label} {entities.filter(entity => kind(entity) === value).length}</> }))]} />
    <Pagination {...data} onChange={setPage} /></div>
    <div ref={content} className="memory-content">{categories.map(({ value, label, icon: Icon }) => {
      const items = data.items.filter(entity => kind(entity) === value);
      if (!items.length) return null;
      return <section className="memory-category" key={value}><h2><Icon size={16} />{label}</h2>{[...new Set(items.map(entity => entity.sourceId))].map(sourceId => {
        const source = sources.find(source => source.id === sourceId);
        return <div className="memory-source-group" key={sourceId}><h3>{source?.name ?? '已移除来源'}</h3><div className="memory-entity-list">{items.filter(entity => entity.sourceId === sourceId).map(entity => <article key={entity.id}>
          <div><strong>{entity.metadata.name}</strong><small>{entity.path || '根目录'}{entity.registration && registrationNames[entity.registration] && <> · {registrationNames[entity.registration]}</>}</small></div>
          <div className="memory-entity-details"><p>{entity.metadata.description || '暂无描述'}</p><div className="language-list">{entity.metadata.languages.map(language => <LanguageLogo key={language} language={language} />)}{entity.metadata.tags.map(tag => <span className="language-chip" key={tag}>#{tag}</span>)}</div>
          {(entity.metadata.git || entity.metadata.launch) && <details><summary>仓库与启动配置</summary>{entity.metadata.git && <p>{entity.metadata.git.provider ?? 'Git'} · {entity.metadata.git.remote}</p>}{entity.metadata.launch && <code>{entity.metadata.launch.command} {entity.metadata.launch.args.join(' ')}</code>}</details>}</div>
        </article>)}</div></div>;
      })}</section>;
    })}
    {!data.total && <p className="library-placeholder">暂无匹配的元数据</p>}
    </div>
  </div>;
}
