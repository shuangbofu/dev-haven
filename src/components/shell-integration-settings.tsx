'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DesktopAPI, ShellIntegrationStatus } from '@/shared/types';

export function ShellIntegrationSettings({ api, engineReady }: { api: DesktopAPI; engineReady: boolean }) {
  const [status, setStatus] = useState<ShellIntegrationStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setStatus(await api.shellStatus()); setError(''); }
    catch (error) { setError(String(error)); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  const toggle = async () => {
    if (!status) return;
    setBusy(true); setError('');
    try {
      const next = await api.setShellEnabled(!status.enabled);
      setStatus(next);
      toast.success(next.enabled ? '全局终端环境已开启，请重新打开终端' : '全局终端环境已关闭，请完全退出并重新打开终端应用');
    } catch (error) { setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="settings-section" aria-label="全局终端环境">
    <h2>全局终端环境</h2>
    <div className="setting-row"><span>默认版本生效范围</span><code>{status?.enabled ? 'DevHaven 和当前用户终端' : 'DevHaven 内置终端'}</code><div>
      <Badge variant={status?.enabled ? 'secondary' : 'outline'}>{status ? status.enabled ? '已开启' : '未开启' : '读取中'}</Badge>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={!!status?.enabled} disabled={busy || !status?.supported} onChange={() => void toggle()} />全局生效</label>
      {busy && <Loader2 className="animate-spin" aria-label="正在更新" />}
      <Button variant="ghost" size="icon" aria-label="刷新全局环境状态" disabled={busy} onClick={() => void refresh()}><RefreshCw /></Button>
    </div></div>
    {status?.supported ? <>
      <p className="table-note">开启后，当前用户使用的终端和 IDE 终端共享默认版本。切换默认版本会在下一次命令提示符刷新时生效；项目自己的 mise 配置优先生效。</p>
      <p className="table-note">开启前自动备份，关闭时仅移除 DevHaven 的配置。请重新打开终端；已有终端或 IDE 可能仍保留旧环境，需要完全退出后重开。此功能不修改 Finder 启动的图形应用环境。</p>
      <div className="setting-row"><span>检测到的 Shell</span><code>{status.shell}</code></div>
      <div className="setting-row"><span>配置位置</span><code>{status.configFiles.join('、')}</code></div>
      {status.backupFile && <div className="setting-row"><span>自动备份文件</span><code>{status.backupFile}</code></div>}
      {!engineReady && <p className="dialog-notice">管理引擎尚未就绪。可以先开启集成；准备引擎、安装工具并设置默认版本后，外部终端才会获得对应环境。</p>}
    </> : status && <p className="table-note">当前平台或 Shell（{status.shell}）暂不支持自动配置；DevHaven 内置终端仍可使用。</p>}
    {(error || status?.error) && <p className="dialog-notice" role="alert">{error || status?.error}</p>}
  </section>;
}
