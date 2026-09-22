'use client';
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { DesktopAPI } from '@/shared/types';
import type { ApplicationState, Preferences } from '@/shared/application';
import type { SearchIndexStatus } from '@/shared/search';
import { defaultSearchShortcut, searchShortcutSchema, shortcutLabel } from '@/shared/shortcut';
import { Button } from './ui/button';
const accents = [['blue', '海蓝', '#2563eb'], ['violet', '紫罗兰', '#7c3aed'], ['teal', '青绿', '#0d9488'], ['amber', '琥珀', '#b45309'], ['rose', '玫红', '#e11d48'], ['neutral', '石墨', '#52525b']] as const;
export function ApplicationSettings({ api, state, section, mac }: { api: DesktopAPI; state: ApplicationState; section: string; mac: boolean }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const [index, setIndex] = useState<SearchIndexStatus>();
  useEffect(() => {
    if (section !== 'search') return;
    let active = true;
    const refresh = () => { void api.searchStatus().then(value => { if (active) setIndex(value); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 2000); return () => { active = false; clearInterval(timer); };
  }, [api, section]);
  const run = async (name: string, action: () => Promise<unknown>) => { setBusy(name); try { await action(); } catch (error) { toast.error(String(error)); } finally { setBusy(''); } };
  const appearance = (patch: Partial<Preferences>) => void run('appearance', () => api.savePreferences({ ...state.preferences, ...patch }));
  return <>
    <section hidden={section !== 'appearance'} className="settings-section"><h2>外观</h2>
      <div className="appearance-row"><span>明暗模式</span><div className="appearance-options">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} disabled={!!busy} aria-pressed={state.preferences.theme === value} onClick={() => appearance({ theme: value })}>{label}</button>)}</div></div>
      <div className="appearance-row"><span>主题色</span><div className="accent-options">{accents.map(([value, label, color]) => <button key={value} disabled={!!busy} title={label} aria-label={label} aria-pressed={state.preferences.accent === value} style={{ '--swatch': color } as React.CSSProperties} onClick={() => appearance({ accent: value })}><span>{state.preferences.accent === value && <Check size={13} />}</span>{label}</button>)}</div></div>
    </section>
    <section hidden={section !== 'search'} className="settings-section"><h2>快速搜索</h2>
      <div className="application-status"><Button variant="outline" aria-label="设置快速搜索快捷键" aria-pressed={recording} onClick={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={event => {
        if (!recording) return; event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { setRecording(false); return; }
        if (['Meta','Control','Alt','Shift'].includes(event.key)) return;
        if (event.nativeEvent.isComposing || (mac ? event.ctrlKey : event.metaKey)) return;
        const parsed = searchShortcutSchema.safeParse({ code: event.code, modifiers: [...((mac ? event.metaKey : event.ctrlKey) ? ['primary'] : []), ...(event.altKey ? ['alt'] : []), ...(event.shiftKey ? ['shift'] : [])] });
        if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
        appearance({ searchShortcut: parsed.data }); setRecording(false);
      }}>{recording ? '请按快捷键，Esc 取消' : shortcutLabel(state.preferences.searchShortcut, mac)}</Button><Button variant="ghost" disabled={!!busy} onClick={() => appearance({ searchShortcut: defaultSearchShortcut })}>恢复默认</Button></div>
      <p className="settings-description">点击后按下新的组合键，在 DevHaven 窗口内生效。</p>
    </section>
    <section hidden={section !== 'search'} className="settings-section"><h2>本地搜索索引</h2><p className="settings-description">正文和元信息保存在本地索引中，搜索不再遍历目录。启动、应用内修改及每分钟后台刷新；外部改动最迟在下次刷新后可查。</p>
      <div className="application-status"><span>{index?.indexing ? '正在更新索引…' : `${index?.documents ?? 0} 项已索引`}{index?.indexedAt && ` · 更新于 ${new Date(index.indexedAt).toLocaleString('zh-CN')}`}</span><Button variant="outline" size="sm" disabled={!!busy || index?.indexing} onClick={() => void run('index', async () => setIndex(await api.rebuildSearch()))}>{index?.indexing || busy === 'index' ? <Loader2 className="animate-spin" /> : <RefreshCw />}重建索引</Button></div>
      {(index?.error || index?.partial) && <p role="status" className="settings-description">{index.error || '已达到扫描上限，当前索引包含部分内容。'}</p>}
      <p className="settings-description">Agent 可使用 Skill 中的 search 命令或 stdio MCP 服务，复用同一个本地索引。</p>
    </section>
    <section hidden={section !== 'about'} className="settings-section"><h2>应用更新 <small>v{state.version}</small></h2>
      <p className="settings-description">检查 DevHaven 的新版本。</p>
      <label className="release-auto"><input type="checkbox" disabled={!!busy || !state.updatesSupported} checked={state.preferences.updates.automatic} onChange={event => appearance({ updates: { automatic: event.target.checked } })} />启动时及每 6 小时自动检查</label>
      <div className="application-status"><Button size="sm" variant="outline" disabled={!!busy || state.release.status === 'checking' || !state.updatesSupported} onClick={() => void run('check', () => api.checkUpdates())}><RefreshCw className={state.release.status === 'checking' ? 'animate-spin' : ''} />检查更新</Button>
        <span role="status">{!state.updatesSupported ? '暂未开放更新' : state.release.status === 'unconfigured' ? '尚未检查更新' : state.release.status === 'checking' ? '检查中…' : state.release.status === 'available' ? `发现新版本 v${state.release.version}` : state.release.status === 'current' ? '当前已是最新版本' : state.release.error}</span>
        {state.release.status === 'available' && state.release.url && <Button size="sm" variant="outline" onClick={() => void api.openLink(state.release.url!).catch(error => toast.error(String(error)))}><ExternalLink />查看发布</Button>}
      </div>
      {state.release.checkedAt && <p className="settings-description">上次检查：{new Date(state.release.checkedAt).toLocaleString('zh-CN')}</p>}
      {state.release.status === 'available' && state.release.notes && <details className="release-notes"><summary>版本说明</summary><pre>{state.release.notes}</pre></details>}
    </section>
  </>;
}
