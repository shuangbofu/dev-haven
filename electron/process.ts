import { spawn } from 'node:child_process';

export function run(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; log?: (line: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: options.env, cwd: options.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    let stdout = ''; let stderr = ''; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, options.timeout ?? 120_000);
    const capture = (buffer: Buffer, isError: boolean) => {
      const value = buffer.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      if (isError) stderr = (stderr + value).slice(-200_000); else stdout = (stdout + value).slice(-4_000_000);
      value.split(/[\r\n]+/).filter(Boolean).forEach(line => options.log?.(line));
    };
    child.stdout.on('data', b => capture(b, false)); child.stderr.on('data', b => capture(b, true));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (expired) reject(new Error('命令执行超时，请检查网络后重试。'));
      else if (code !== 0) reject(new Error(stderr.trim().slice(-3000) || stdout.trim().slice(-3000) || `命令退出，状态码 ${code}`));
      else resolve(stdout.trim());
    });
  });
}
