import spawn from 'cross-spawn';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { atomicJSON } from './memory-files';
import { CodexEvents, formatCodexEvent, redactAgentLog } from './codex-events';
import type { AgentEvent } from '../src/shared/agent-event';

export interface AgentRequest { directory: string; executable: string; model: string; prompt: string; schema: Record<string, unknown>; signal: AbortSignal; log: (line: string) => void; event?: (event: AgentEvent) => void; webSearch?: boolean }
export type AgentRunner = (request: AgentRequest) => Promise<unknown>;
export const runCodex: AgentRunner = async request => {
  const schema = path.join(request.directory, 'output-schema.json'), output = path.join(request.directory, 'result.json');
  await atomicJSON(schema, request.schema);
  if (request.signal.aborted) throw new Error('任务已取消');
  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(request.executable, [...(request.webSearch ? ['--search'] : []), 'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-schema', schema, '--output-last-message', output, '-C', request.directory, ...(request.model ? ['--model', request.model] : []), '-'], { env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', errorBuffer = '', settled = false, timedOut = false, skipping = false;
    let turnFailure: string | undefined;
    const decoder = new StringDecoder('utf8'), errorDecoder = new StringDecoder('utf8');
    const events = new CodexEvents(event => request.event?.(event));
    const frame = (line: string) => {
      if (!line.trim()) return;
      try {
        const value = JSON.parse(line);
        if (value?.type === 'turn.failed') turnFailure = redactAgentLog(String(value.error?.message ?? 'Codex 本轮执行失败'));
        if (request.event) events.accept(value); else request.log(formatCodexEvent(value));
      }
      catch { request.log('Codex 输出了无法解析的 JSON 事件'); }
    };
    const stdout = (text: string) => {
      buffer += text;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!skipping && line.length <= 4_194_304) frame(line);
        else if (!skipping) request.log('Codex 单条事件超过 4 MB，已省略');
        skipping = false;
      }
      if (buffer.length > 4_194_304) { if (!skipping) request.log('Codex 单条事件超过 4 MB，已省略'); buffer = ''; skipping = true; }
    };
    const diagnostic = (text: string) => {
      stderr = (stderr + text).slice(-3000); errorBuffer += text;
      let index: number;
      while ((index = errorBuffer.indexOf('\n')) >= 0) {
        const line = errorBuffer.slice(0, index); errorBuffer = errorBuffer.slice(index + 1);
        if (line.trim()) request.log(`stderr · ${redactAgentLog(line)}`);
      }
      if (errorBuffer.length > 65536) { request.log(`stderr · ${redactAgentLog(errorBuffer)}\n[长行已截断]`); errorBuffer = ''; }
    };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
      if (!killTimer) killTimer = setTimeout(() => { try { if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL'); else child.kill(); } catch {} }, 3000);
    };
    const timeout = setTimeout(() => { timedOut = true; stop(); }, 15 * 60_000);
    request.signal.addEventListener('abort', stop, { once: true });
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(killTimer); request.signal.removeEventListener('abort', stop); error ? reject(error) : resolve(); };
    child.stdout?.on('data', chunk => stdout(decoder.write(chunk)));
    child.stderr?.on('data', chunk => diagnostic(errorDecoder.write(chunk)));
    child.on('error', error => finish(new Error(`无法启动 Codex：${error.message}`)));
    child.on('close', code => {
      stdout(decoder.end()); if (buffer && !skipping) frame(buffer);
      diagnostic(errorDecoder.end()); if (errorBuffer.trim()) request.log(`stderr · ${redactAgentLog(errorBuffer)}`);
      finish(request.signal.aborted ? new Error('任务已取消') : timedOut ? new Error('Codex 执行超过 15 分钟，已停止') : turnFailure ? new Error(turnFailure) : code === 0 ? undefined : new Error(`Codex 退出码 ${code}：${redactAgentLog(stderr).slice(-1200)}`));
    });
    if (request.signal.aborted) stop();
    child.stdin?.on('error', () => {}); child.stdin?.end(request.prompt);
  });
  return JSON.parse(await readFile(output, 'utf8'));
};
