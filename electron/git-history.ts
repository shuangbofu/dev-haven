import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
export async function gitRead(directory: string, args: string[], signal?: AbortSignal) {
  return (await exec('git', ['-C', directory, ...args], { signal, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout.trim();
}
export async function ownGitHistory(directory: string, page = 1, pageSize = 20, revision?: string, signal?: AbortSignal, configuredEmails: string[] = []) {
  const marker = await lstat(path.join(directory, '.git')).catch(() => undefined);
  if (!marker || marker.isSymbolicLink()) return { items: [], total: 0, page: 1, pageSize, revision: '', identities: [] };
  const identities = configuredEmails.length ? [...new Set(configuredEmails)] : [(await gitRead(directory, ['config', '--get', 'user.email'], signal).catch(() => '')).trim()].filter(Boolean);
  if (!identities.length) throw new Error('未配置 Git user.email，无法确认本人提交；请在记忆设置中填写本人 Git 邮箱');
  const head = revision ?? await gitRead(directory, ['rev-parse', '--verify', 'HEAD'], signal).catch(async () => { await gitRead(directory, ['rev-parse', '--git-dir'], signal); return ''; });
  if (!head) return { items: [], total: 0, page: 1, pageSize, revision: '', identities };
  // Anchor the complete author email; do not match name, committer or substrings.
  const author = [...identities.map(identity => `--author=<${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>$`), '--extended-regexp', '--no-merges'];
  const total = Number(await gitRead(directory, ['rev-list', '--count', ...author, head, '--'], signal));
  const selectedPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const output = await gitRead(directory, ['log', '--no-show-signature', ...author, `--skip=${(selectedPage - 1) * pageSize}`, `--max-count=${pageSize}`, '--format=%H%x00%aI%x00%an%x00%ae%x00%s', head, '--'], signal);
  const items = output ? output.split('\n').map(line => {
    const [hash, date, author, email, message] = line.split('\0');
    return { hash, date, author, email, message };
  }).filter(item => identities.includes(item.email)) : [];
  return { items, total, page: selectedPage, pageSize, revision: head, identities };
}
