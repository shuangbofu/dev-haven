'use client';

import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { Clipboard, Eraser, Loader2, Plus, Square, Terminal as TerminalIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toolById } from '@/shared/catalog';
import type { DesktopAPI, Installation, TerminalEvent, TerminalSession } from '@/shared/types';
import { WorkspaceToolbar } from './workspace-toolbar';

type Props = { api: DesktopAPI; visible: boolean; sessions: TerminalSession[]; active?: string; installations: Installation[]; busy: boolean; onActive: (id: string) => void; onOpen: (id?: string, interactive?: boolean) => void; onClose: (id: string) => void };
export function TerminalWorkspace({ api, visible, sessions, active, installations, busy, onActive, onOpen, onClose }: Props) {
  const [target, setTarget] = useState('');
  const activeInstallation = sessions.find(session => session.id === active)?.installationId;
  useEffect(() => { setTarget(activeInstallation ?? ''); }, [activeInstallation, active]);
  const selected = installations.find(item => item.id === target);
  return <section className="terminal-workspace" hidden={!visible}>
    <WorkspaceToolbar title="终端" filters={<select className="select-input terminal-target" aria-label="终端环境" value={selected?.id ?? ''} onChange={event => setTarget(event.target.value)}><option value="">默认环境</option>{installations.map(item => <option key={item.id} value={item.id}>{toolById(item.tool).name} {item.version}</option>)}</select>} actions={<>
      <Button variant="outline" disabled={busy} onClick={() => onOpen(selected?.id)}>{busy ? <Loader2 className="animate-spin" /> : <Plus />}新建终端</Button>
      {selected && toolById(selected.tool).repl && <Button variant="outline" disabled={busy} onClick={() => onOpen(selected.id, false)}><TerminalIcon />普通命令行</Button>}
    </>} />
    {!sessions.length ? <div className="empty-state terminal-empty"><TerminalIcon size={28} /><p>暂无终端会话</p><Button disabled={busy} onClick={() => onOpen(selected?.id)}><Plus />新建终端</Button></div> : <div className="terminal-tool">
      <div className="terminal-tabs" role="tablist" aria-label="终端会话">{sessions.map(session => <div key={session.id} className={active === session.id ? 'active' : ''}><button role="tab" aria-selected={active === session.id} aria-controls={`terminal-${session.id}`} onClick={() => onActive(session.id)}><TerminalIcon size={14} /><span>{session.title}</span></button><button title={`关闭 ${session.title}`} aria-label={`关闭 ${session.title}`} onClick={() => onClose(session.id)}><X size={14} /></button></div>)}</div>
      {sessions.map(session => <TerminalPane key={session.id} api={api} session={session} visible={visible && active === session.id} onExit={onClose} />)}
    </div>}
  </section>;
}

function TerminalPane({ api, session, visible, onExit }: { api: DesktopAPI; session: TerminalSession; visible: boolean; onExit: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [exitCode, setExitCode] = useState<number>();
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => {
    let disposed = false;
    let exited = false;
    let cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !host.current) return;
      const scheme = matchMedia('(prefers-color-scheme: dark)');
      const theme = () => ({ background: document.documentElement.dataset.theme === 'dark' ? '#09090b' : '#ffffff', foreground: document.documentElement.dataset.theme === 'dark' ? '#fafafa' : '#18181b', cursor: document.documentElement.dataset.theme === 'dark' ? '#fafafa' : '#18181b', selectionBackground: document.documentElement.dataset.theme === 'dark' ? '#52525b' : '#d4d4d8' });
      const term = new Terminal({
        // Keep xterm cell measurement on a real monospace face; the UI's variable CJK font is proportional.
        fontFamily: 'Menlo, "SFMono-Regular", Monaco, Consolas, "Cascadia Mono", "Liberation Mono", "PingFang SC", "Microsoft YaHei", monospace',
        fontSize: 14,
        lineHeight: 1.25,
        letterSpacing: 0,
        cursorBlink: true,
        scrollback: 5000,
        theme: theme(),
        allowProposedApi: false,
      });
      terminal.current = term;
      const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
      const updateTheme = () => { term.options.theme = theme(); };
      window.addEventListener('devhaven-theme', updateTheme);
      const resize = () => {
        if (exited || !host.current?.clientWidth || !host.current.clientHeight) return;
        fit.fit();
        void api.terminalResize(session.id, Math.max(2, Math.min(500, term.cols)), Math.max(1, Math.min(300, term.rows))).catch(error => { if (!disposed) toast.error(String(error)); });
      };
      const observer = new ResizeObserver(resize); observer.observe(host.current);
      const input = term.onData(data => {
        void (async () => { for (let start = 0; start < data.length; start += 65_536) await api.terminalWrite(session.id, data.slice(start, start + 65_536)); })().catch(error => toast.error(String(error)));
      });
      let attached = false;
      const pending: TerminalEvent[] = [];
      const receive = (event: TerminalEvent) => {
        if (event.type === 'data') term.write(event.data);
        else if (!exited) {
          exited = true;
          setExitCode(event.exitCode); term.options.disableStdin = true;
          onExitRef.current(session.id);
        }
      };
      const unsubscribe = api.onTerminalEvent(event => {
        if (event.id !== session.id || disposed) return;
        if (attached) receive(event); else pending.push(event);
      });
      cleanup = () => { unsubscribe(); input.dispose(); observer.disconnect(); window.removeEventListener('devhaven-theme', updateTheme); term.dispose(); terminal.current = null; };
      const initial = await api.terminalAttach(session.id);
      if (disposed) return;
      term.write(initial.output);
      if (initial.exitCode !== undefined) receive({ id: session.id, type: 'exit', exitCode: initial.exitCode });
      attached = true; pending.forEach(receive); resize();
      if (host.current.clientWidth) term.focus();
    })().catch(error => { if (!disposed) toast.error(String(error)); });
    return () => { disposed = true; cleanup(); };
  }, [api, session.id]);
  useEffect(() => { if (visible) terminal.current?.focus(); }, [visible]);
  return <div role="tabpanel" id={`terminal-${session.id}`} aria-label={session.title} hidden={!visible} className="terminal-pane">
    <div className="terminal-toolbar"><code title={session.cwd}>{session.cwd}</code>{exitCode !== undefined && <span>已退出 ({exitCode})</span>}
      <Button variant="ghost" size="icon" title="复制选中内容" aria-label="复制选中内容" onClick={() => { const selection = terminal.current?.getSelection(); if (selection) void navigator.clipboard.writeText(selection).catch(error => toast.error(String(error))); }}><Clipboard /></Button>
      <Button variant="ghost" size="icon" title="中断命令" aria-label="中断命令" disabled={exitCode !== undefined} onClick={() => void api.terminalWrite(session.id, '\u0003').catch(error => toast.error(String(error)))}><Square /></Button>
      <Button variant="ghost" size="icon" title="清屏" aria-label="清屏" onClick={() => { terminal.current?.clear(); terminal.current?.focus(); }}><Eraser /></Button>
    </div><div className="terminal-canvas" ref={host} />
  </div>;
}
