'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DesktopAPI } from '@/shared/types';
import type { MemoryConfig, MemorySnapshot } from '@/shared/memory';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { WorkspaceToolbar } from './workspace-toolbar';

export function MemorySettings({ api, snapshot, onboarding = false, section = 'sources' }: { api: DesktopAPI; snapshot: MemorySnapshot; onboarding?: boolean; section?: string }) {
  const [draft, setDraft] = useState<MemoryConfig>(snapshot.config);
  const [busy, setBusy] = useState(false);
  const [gitEmails, setGitEmails] = useState(snapshot.config.gitAuthorEmails.join(', '));
  const signature = JSON.stringify(snapshot.config);
  useEffect(() => { const config = JSON.parse(signature); setDraft(config); setGitEmails(config.gitAuthorEmails.join(', ')); }, [signature]);
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } catch (error) { toast.error(String(error)); } finally { setBusy(false); } };
  const choose = (purpose: 'memory' | 'reports' | 'agent') => run(async () => { const directory = await api.memoryChoosePath(purpose); if (directory) setDraft(value => purpose === 'agent' ? { ...value, agent: { ...value.agent, executable: directory } } : { ...value, [purpose === 'memory' ? 'directory' : 'reportsDirectory']: directory }); });
  const show = (value: string) => onboarding || section === value;
  return <form className="memory-settings" onSubmit={event => { event.preventDefault(); void run(async () => { await api.memorySaveConfig({ ...draft, gitAuthorEmails: gitEmails.split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean), initialized: true }); toast.success('设置已保存'); }); }}>
    {onboarding && <WorkspaceToolbar title="初始化工作空间" />}
    <div className="settings-save-bar"><Button type="submit" disabled={busy || !draft.sources.length || snapshot.tasks.some(task => ['queued', 'running'].includes(task.status))}><Save />{busy ? '保存中…' : onboarding ? '完成初始化' : '保存设置'}</Button></div>
    <section hidden={!show('sources')} className="settings-section"><h2>记忆与报告</h2>
      <div className="setting-row"><span>记忆目录</span><code>{draft.directory}</code><Button type="button" size="icon" variant="outline" title="选择记忆目录" aria-label="选择记忆目录" disabled={busy} onClick={() => void choose('memory')}><FolderOpen /></Button></div>
      <div className="setting-row"><span>报告目录</span><code>{draft.reportsDirectory}</code><Button type="button" size="icon" variant="outline" title="选择报告目录" aria-label="选择报告目录" disabled={busy} onClick={() => void choose('reports')}><FolderOpen /></Button></div>
    </section>
    {(['projects', 'knowledge'] as const).map(kind => <section hidden={!show('sources')} className="settings-section" key={kind}><div className="memory-section-heading"><h2>{kind === 'projects' ? '项目目录' : '知识库目录'}</h2><Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { const directory = await api.memoryChoosePath('source'); if (directory) setDraft(value => ({ ...value, sources: [...value.sources, { id: crypto.randomUUID(), kind, name: directory.split(/[\\/]/).filter(Boolean).at(-1) || kind, directory, scan: true, excludes: [] }] })); })}><Plus />添加目录</Button></div>
      {!draft.sources.some(source => source.kind === kind) && <p className="project-muted">尚未配置目录</p>}
      {draft.sources.filter(source => source.kind === kind).map(source => <div className="memory-source-setting" key={source.id}>
        <code title={source.directory}>{source.directory}</code>
        <Button type="button" size="icon" variant="ghost" aria-label={`更换 ${source.name} 目录`} title="更换目录" disabled={busy} onClick={() => void run(async () => { const directory = await api.memoryChoosePath('source'); if (directory) setDraft(value => ({ ...value, sources: value.sources.map(item => item.id === source.id ? { ...item, directory } : item) })); })}><FolderOpen /></Button>
        <label className="memory-check"><input type="checkbox" checked={source.scan} onChange={event => setDraft(value => ({ ...value, sources: value.sources.map(item => item.id === source.id ? { ...item, scan: event.target.checked } : item) }))} />参与刮削</label>
        <Button type="button" size="icon" variant="ghost" title="移除来源" aria-label={`移除 ${source.name}`} disabled={busy} onClick={() => setDraft(value => ({ ...value, sources: value.sources.filter(item => item.id !== source.id) }))}><Trash2 /></Button>
        <details className="memory-source-options"><summary>目录选项</summary>
          <label className="memory-source-name">显示名称<Input aria-label={`${source.directory} 显示名称`} value={source.name} maxLength={120} required disabled={busy} onChange={event => setDraft(value => ({ ...value, sources: value.sources.map(item => item.id === source.id ? { ...item, name: event.target.value } : item) }))} /></label>
          <label className="memory-exclusions">排除路径<Input aria-label={`${source.name} 排除路径`} placeholder="相对路径，以逗号分隔" value={source.excludes.join(', ')} disabled={busy} onChange={event => setDraft(value => ({ ...value, sources: value.sources.map(item => item.id === source.id ? { ...item, excludes: event.target.value.split(',').map(item => item.trim()).filter(Boolean) } : item) }))} /></label>
        </details>
      </div>)}
    </section>)}
    <section hidden={!show('sources')} className="settings-section"><h2>本人 Git 身份</h2>
      <label className="setting-row"><span>提交邮箱</span><Input aria-label="本人 Git 提交邮箱" value={gitEmails} placeholder="多个邮箱用逗号分隔" onChange={event => setGitEmails(event.target.value)} /></label>
      <p className="project-muted">仅记录这些邮箱作为作者的提交。留空则使用各仓库的 Git user.email；此设置不修改 Git 配置。</p>
    </section>
    <section hidden={!show('agent')} className="settings-section"><h2>本地图标</h2>
      <div className="setting-row"><span>图标目录</span><code>{snapshot.iconsDirectory}</code></div>
      <p className="project-muted">已保存 {snapshot.icons.length} 个图标。刮削时自动查找缺失的语言与技术图标，下载后离线使用。</p>
    </section>
    <section hidden={!show('agent')} className="settings-section"><h2>Codex 扫描</h2>
      <div className="setting-row"><span>可执行文件</span><Input aria-label="Codex 可执行文件" value={draft.agent.executable} onChange={event => setDraft(value => ({ ...value, agent: { ...value.agent, executable: event.target.value } }))} /><Button type="button" size="icon" variant="outline" title="选择 Codex 可执行文件" aria-label="选择 Codex 可执行文件" disabled={busy} onClick={() => void choose('agent')}><FolderOpen /></Button></div>
      <div className="setting-row"><span>模型</span><Input aria-label="Codex 模型" placeholder="使用 Codex 默认模型" value={draft.agent.model} onChange={event => setDraft(value => ({ ...value, agent: { ...value.agent, model: event.target.value } }))} /></div>
      <div className="setting-row"><span>自动刮削</span><label className="memory-check"><input type="checkbox" checked={draft.autoScan} onChange={event => setDraft(value => ({ ...value, autoScan: event.target.checked }))} />启用</label><label className="memory-check">间隔（分钟）<Input type="number" aria-label="扫描间隔分钟" min={5} max={1440} value={draft.scanIntervalMinutes} onChange={event => setDraft(value => ({ ...value, scanIntervalMinutes: Number(event.target.value) }))} /></label></div>
    </section>
    {!onboarding && <section hidden={!show('agent')} className="settings-section"><h2>Agent Skill</h2><div className="setting-row"><span>规范目录</span><code>{snapshot.skillDirectory}</code><Button type="button" size="icon" variant="outline" title="打开 Skill 目录" aria-label="打开 Skill 目录" onClick={() => void api.memoryReveal('skill')}><FolderOpen /></Button></div><div className="setting-row"><span>记录脚本</span><code>{snapshot.clientFile}</code></div></section>}
  </form>;
}
